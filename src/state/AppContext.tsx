// ---------------------------------------------------------------------
//  Shared app state: who is signed in, what they own, what they have
//  answered, and which dialog is open.
//
//  One context rather than several stores. At this size the cost of
//  splitting (providers nested three deep, values that have to stay in
//  sync anyway) outweighs the re-render savings — `owned` changes exactly
//  once per purchase.
// ---------------------------------------------------------------------

import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { visibleSets } from '../config/catalog.js';
import { CONFIGURED } from '../config/supabase.js';
import { demoData } from '../demo-data.js';
import { fetchOwned, fetchProfile, fetchProgress, fetchSets } from '../lib/api.js';
import { errorMessage } from '../lib/errors.js';
import { mergeOwned } from '../lib/owned.js';
import { db, sb } from '../lib/supabase.js';
import type { Profile, Progress, QuestionSet } from '../types.js';

/**
 * Banner content.
 *
 * The two variants exist so server-supplied strings can never reach
 * innerHTML: anything from Postgres or an Edge Function is `text`, and
 * `html` is only ever literal markup written in this codebase. A Postgres
 * error echoes its input back, so routing one through innerHTML would put
 * user-controlled bytes in the DOM.
 */
export type BannerMessage = { kind: 'text'; value: string } | { kind: 'html'; value: string };

interface AuthDialogState {
  open: boolean;
  reason: string;
}

interface AppContextValue {
  session: Session | null;
  /** Null until the profile row is read, and whenever signed out. */
  profile: Profile | null;
  /** Why the profile could not be read, if it could not. Shown on the
   *  profile page only — see refreshProfile. */
  profileError: string | null;
  sets: QuestionSet[];
  owned: ReadonlySet<string>;
  progress: Record<string, Progress>;
  banner: BannerMessage | null;

  authDialog: AuthDialogState;
  paywallSet: QuestionSet | null;

  isLocked: (set: QuestionSet) => boolean;
  showBanner: (value: string) => void;
  showBannerHtml: (value: string) => void;
  dismissBanner: () => void;

  openAuth: (reason?: string) => void;
  closeAuth: () => void;
  /** Open the auth dialog and replay `then` once sign-in succeeds. */
  requireAuth: (reason: string, then: () => void) => void;

  openPaywall: (set: QuestionSet) => void;
  closePaywall: () => void;

  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
  refreshProgress: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Mark a set owned immediately after purchase, before the server round trip. */
  noteOwned: (setId: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>.');
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sets, setSets] = useState<QuestionSet[]>([]);
  const [owned, setOwned] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [banner, setBanner] = useState<BannerMessage | null>(null);
  const [authDialog, setAuthDialog] = useState<AuthDialogState>({
    open: false,
    reason: '',
  });
  const [paywallSet, setPaywallSet] = useState<QuestionSet | null>(null);

  /**
   * Replayed after a successful sign-in. A ref, not state — changing it
   * must never trigger a render.
   *
   * Callers must pass a callback that only *signals* what to retry (set a
   * flag, record an id), never one that re-runs a guard. Anything checking
   * `session` here would be reading the value captured before sign-in and
   * would loop straight back into the auth dialog.
   */
  const pendingAction = useRef<(() => void) | null>(null);

  /** Whether the last observed auth state was signed in. See the auth
   *  effect below for why this is not derived from `session`. */
  const signedInRef = useRef(false);

  /** Set ids granted locally after PayPal approve, before my_sets()
   *  agrees. Kept out of React state so a stale fetch cannot wipe them. */
  const optimisticOwned = useRef(new Set<string>());
  const ownedRef = useRef(owned);

  const showBanner = useCallback((value: string) => setBanner({ kind: 'text', value }), []);
  const showBannerHtml = useCallback((value: string) => setBanner({ kind: 'html', value }), []);
  const dismissBanner = useCallback(() => setBanner(null), []);

  const refreshAccess = useCallback(async () => {
    if (!CONFIGURED) return;
    try {
      const fromServer = await fetchOwned();
      setOwned(() => {
        const next = mergeOwned(fromServer, optimisticOwned.current);
        for (const id of fromServer) optimisticOwned.current.delete(id);
        ownedRef.current = next;
        return next;
      });
    } catch (err) {
      console.warn('Could not load unlocked sets:', err);
    }
  }, []);

  const refreshProgress = useCallback(async () => {
    if (!CONFIGURED) return;
    try {
      setProgress(await fetchProgress());
    } catch (err) {
      console.warn('Could not load progress:', err);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!CONFIGURED) return;
    try {
      setProfile(await fetchProfile());
      setProfileError(null);
    } catch (err) {
      // Deliberately not a banner: a student who never opens the profile
      // page should not be interrupted by this. But it is recorded rather
      // than only logged — a swallowed failure here looks identical to
      // "you have not set a name yet", which is a maddening thing to
      // debug from the outside.
      setProfileError(errorMessage(err));
      console.warn('Could not load profile:', err);
    }
  }, []);

  const loadSets = useCallback(async () => {
    try {
      setSets(visibleSets(await fetchSets()));
    } catch (err) {
      setBanner({ kind: 'text', value: 'Could not load question sets: ' + String(err) });
      setSets([]);
    }
  }, []);

  // ---- boot ----------------------------------------------------------
  useEffect(() => {
    if (!CONFIGURED) {
      setBanner({
        kind: 'html',
        value:
          'Demo mode — the free set below is local sample data. ' +
          'Add your project URL and anon key to <code>config/supabase.ts</code> ' +
          'to turn on accounts and the paid sets.',
      });
      setSets(visibleSets(demoData.sets));
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data } = await db().auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      signedInRef.current = !!data.session;

      await loadSets();
      if (cancelled) return;
      if (data.session) {
        await Promise.all([refreshAccess(), refreshProgress(), refreshProfile()]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadSets, refreshAccess, refreshProgress, refreshProfile]);

  // ---- auth changes --------------------------------------------------
  useEffect(() => {
    if (!sb) return;

    const { data } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next);

      // Tracked in a ref rather than read from the state updater: React
      // may invoke an updater twice (StrictMode does so deliberately),
      // and scheduling work from inside one would fire the refresh twice
      // per sign-in.
      const previouslySignedIn = signedInRef.current;
      signedInRef.current = !!next;

      // supabase-js holds an internal lock for the duration of this
      // callback. Calling back into the client from inside it (.rpc,
      // .from, getSession) waits on that same lock, so the sign-in
      // promise never settles and the button sticks on "Working…".
      // Anything that touches the client must be deferred out of here.
      setTimeout(() => {
        if (next && !previouslySignedIn) {
          void (async () => {
            await Promise.all([loadSets(), refreshAccess(), refreshProgress(), refreshProfile()]);
            const action = pendingAction.current;
            pendingAction.current = null;
            action?.();
          })();
        } else if (!next && previouslySignedIn) {
          optimisticOwned.current = new Set();
          ownedRef.current = new Set();
          setOwned(new Set<string>());
          setProgress({});
          setProfile(null);
          setProfileError(null);
        }
      }, 0);
    });

    return () => data.subscription.unsubscribe();
  }, [loadSets, refreshAccess, refreshProgress, refreshProfile]);

  const isLocked = useCallback(
    (set: QuestionSet) => !set.is_free && !ownedRef.current.has(set.id),
    [owned]
  );

  const openAuth = useCallback((reason = '') => {
    setAuthDialog({ open: true, reason });
  }, []);

  const closeAuth = useCallback(() => {
    setAuthDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const requireAuth = useCallback(
    (reason: string, then: () => void) => {
      pendingAction.current = then;
      openAuth(reason);
    },
    [openAuth]
  );

  const openPaywall = useCallback((set: QuestionSet) => setPaywallSet(set), []);
  const closePaywall = useCallback(() => setPaywallSet(null), []);

  const noteOwned = useCallback((setId: string) => {
    optimisticOwned.current.add(setId);
    if (ownedRef.current.has(setId)) return;
    const next = new Set(ownedRef.current);
    next.add(setId);
    ownedRef.current = next;
    setOwned(next);
  }, []);

  const signOut = useCallback(async () => {
    if (!CONFIGURED) return;
    await db().auth.signOut();
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      session,
      profile,
      profileError,
      sets,
      owned,
      progress,
      banner,
      authDialog,
      paywallSet,
      isLocked,
      showBanner,
      showBannerHtml,
      dismissBanner,
      openAuth,
      closeAuth,
      requireAuth,
      openPaywall,
      closePaywall,
      signOut,
      refreshAccess,
      refreshProgress,
      refreshProfile,
      noteOwned,
    }),
    [
      session,
      profile,
      profileError,
      sets,
      owned,
      progress,
      banner,
      authDialog,
      paywallSet,
      isLocked,
      showBanner,
      showBannerHtml,
      dismissBanner,
      openAuth,
      closeAuth,
      requireAuth,
      openPaywall,
      closePaywall,
      signOut,
      refreshAccess,
      refreshProgress,
      refreshProfile,
      noteOwned,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
