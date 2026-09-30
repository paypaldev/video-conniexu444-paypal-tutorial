import { useCallback, useEffect, useState } from 'react';

import { AuthDialog } from './components/AuthDialog.js';
import { Banner } from './components/Banner.js';
import { PaywallDialog } from './components/PaywallDialog.js';
import { PracticeView } from './components/PracticeView.js';
import { ProfileView } from './components/ProfileView.js';
import { SetList } from './components/SetList.js';
import { SiteHeader } from './components/SiteHeader.js';
import { CONFIGURED } from './config/supabase.js';
import { fetchAnsweredIds, fetchQuestions } from './lib/api.js';
import { errorMessage } from './lib/errors.js';
import { useApp } from './state/AppContext.js';
import type { Question, QuestionSet } from './types.js';

/** The active practice run. Held here because navigation depends on it. */
interface Run {
  set: QuestionSet;
  questions: Question[];
  /** Bumped on retry so PracticeView remounts with fresh state. */
  attempt: number;
  /** True when every question had already been answered, so this run is
   *  a second pass over the whole set rather than new material. */
  replay: boolean;
}

/**
 * What is on screen.
 *
 * A union rather than a `run` plus a separate `view` flag: those two can
 * disagree, and the first bug that produces is a practice run rendering
 * underneath the profile page.
 */
type Screen = { name: 'sets' } | { name: 'profile' } | { name: 'practice'; run: Run };

const SETS_SCREEN: Screen = { name: 'sets' };

export function App() {
  const {
    isLocked,
    session,
    sets,
    requireAuth,
    openPaywall,
    showBanner,
    refreshProgress,
  } = useApp();
  const [screen, setScreen] = useState<Screen>(SETS_SCREEN);

  /** Set the student tried to open before signing in. Stored as an id and
   *  retried by an effect, not as a closure — a closure would capture the
   *  signed-out session and loop back into the auth dialog. */
  const [pendingSetId, setPendingSetId] = useState<string | null>(null);

  const openSet = useCallback(
    async (set: QuestionSet) => {
      if (isLocked(set)) {
        if (!session) {
          requireAuth('Continue with Google first, then unlock this set.', () =>
            setPendingSetId(set.id)
          );
        } else {
          openPaywall(set);
        }
        return;
      }

      try {
        const questions = await fetchQuestions(set.id);
        if (!questions.length) {
          showBanner('That set has no questions yet.');
          return;
        }

        // Pick up where they left off. Signed out there is no history to
        // read — and no way to answer either, so the full set is right.
        let queue = questions;
        let replay = false;

        if (session) {
          try {
            const answered = await fetchAnsweredIds(set.id);
            const fresh = questions.filter((question) => !answered.has(question.id));

            if (fresh.length > 0) {
              queue = fresh;
            } else {
              // Everything is answered. Serving an empty run would be a
              // dead end, so go round again and say so.
              replay = true;
              showBanner(
                `You have answered every question in ${set.title}. Starting again from the top.`
              );
            }
          } catch (err) {
            // Repeating a question is a far smaller failure than being
            // unable to practise at all, so a history that will not load
            // degrades to the full set rather than blocking the run.
            console.warn('Could not read answered questions; serving the whole set:', err);
          }
        }

        setScreen({ name: 'practice', run: { set, questions: queue, attempt: 0, replay } });
      } catch (err) {
        showBanner('Could not load questions: ' + errorMessage(err));
      }
    },
    [isLocked, session, requireAuth, openPaywall, showBanner]
  );

  // Retry the set once sign-in lands. Re-running openSet rather than
  // resuming a captured closure means it sees the *current* session and
  // entitlements — a student who signs into an account that already owns
  // the set gets the set, not the paywall.
  useEffect(() => {
    if (!pendingSetId || !session) return;
    const set = sets.find((candidate) => candidate.id === pendingSetId);
    setPendingSetId(null);
    if (set) void openSet(set);
  }, [pendingSetId, session, sets, openSet]);

  const goHome = useCallback(() => {
    setScreen(SETS_SCREEN);
    if (session) void refreshProgress();
  }, [session, refreshProgress]);
  const openProfile = useCallback(() => setScreen({ name: 'profile' }), []);

  const retryRun = useCallback(() => {
    setScreen((current) =>
      current.name === 'practice'
        ? { name: 'practice', run: { ...current.run, attempt: current.run.attempt + 1 } }
        : current
    );
  }, []);

  return (
    <>
      <Banner />
      <SiteHeader onHome={goHome} onProfile={openProfile} />

      <main>
        {screen.name === 'practice' && (
          <PracticeView
            // Remounting is the point: a new set or a retry should reset
            // every counter, not merge with the previous run.
            key={`${screen.run.set.id}:${screen.run.attempt}`}
            set={screen.run.set}
            questions={screen.run.questions}
            replay={screen.run.replay}
            onExit={goHome}
            onRetry={retryRun}
          />
        )}
        {screen.name === 'profile' && <ProfileView onBack={goHome} />}
        {screen.name === 'sets' && <SetList onOpen={(set) => void openSet(set)} />}
      </main>

      <footer className="site-footer">
        <span>{CONFIGURED ? 'KatSAT · katsat.org' : 'Demo mode. Not connected to a database.'}</span>
      </footer>

      <AuthDialog />
      <PaywallDialog onUnlocked={(set) => void openSet(set)} />
    </>
  );
}
