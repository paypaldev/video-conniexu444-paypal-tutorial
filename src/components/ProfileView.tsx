// ---------------------------------------------------------------------
//  The profile page: who you are, how you are doing, and how often you
//  actually show up.
//
//  The streak numbers and the chart are the point of the page, so they
//  sit above the per-set breakdown rather than below it.
// ---------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { ActivityChart } from './ActivityChart.js';
import { CONFIGURED } from '../config/supabase.js';
import { fetchActivity, updateUsername } from '../lib/api.js';
import { errorMessage } from '../lib/errors.js';
import { summariseStreaks } from '../lib/streaks.js';
import { useApp } from '../state/AppContext.js';
import type { ActivityDay } from '../types.js';

const USERNAME_MAX = 20;

export function ProfileView({ onBack }: { onBack: () => void }) {
  const { session, progress, sets, refreshProfile, profileError } = useApp();

  const [activity, setActivity] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!CONFIGURED || !session) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const days = await fetchActivity();
        if (!cancelled) {
          setActivity(days);
          setLoadError('');
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const streaks = useMemo(() => summariseStreaks(activity), [activity]);

  // Lifetime totals, summed from the per-set progress the app already
  // holds. The activity window only goes back a year; these do not.
  const totals = useMemo(() => {
    const rows = Object.values(progress);
    const answered = rows.reduce((sum, row) => sum + row.answered, 0);
    const correct = rows.reduce((sum, row) => sum + row.correct, 0);
    return { answered, correct };
  }, [progress]);

  const accuracy =
    totals.answered > 0 ? Math.round((totals.correct / totals.answered) * 100) : null;

  if (!session) {
    return (
      <section className="view">
        <BackLink onBack={onBack} />
        <div className="hero">
          <h1>Your profile</h1>
          <p className="hero-sub">Sign in to see your streak and your practice history.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <BackLink onBack={onBack} />

      <NameCard onSaved={refreshProfile} />

      {profileError && (
        <p className="form-error">Could not load your display name: {profileError}</p>
      )}

      <div className="stat-row">
        <Stat
          label="Current streak"
          value={streaks.current}
          unit={streaks.current === 1 ? 'day' : 'days'}
          note={
            streaks.current === 0
              ? 'Answer one question to start it'
              : streaks.activeToday
                ? 'Counted today'
                : 'Practise today to keep it'
          }
          emphasis={streaks.current > 0}
        />
        <Stat
          label="Longest streak"
          value={streaks.longest}
          unit={streaks.longest === 1 ? 'day' : 'days'}
        />
        <Stat label="Questions answered" value={totals.answered} />
        <Stat
          label="Accuracy"
          value={accuracy ?? 0}
          unit={accuracy === null ? '' : '%'}
          note={accuracy === null ? 'No answers yet' : `${totals.correct} correct`}
        />
      </div>

      {loadError && <p className="form-error">Could not load your activity: {loadError}</p>}
      {loading && !loadError && <p className="hero-sub">Loading your activity…</p>}
      {!loading && !loadError && <ActivityChart days={activity} />}

      {sets.length > 0 && (
        <section className="profile-sets">
          <h2 className="section-heading">By set</h2>
          <ul className="progress-list">
            {sets.map((set) => {
              const row = progress[set.id];
              return (
                <li key={set.id} className="progress-row">
                  <span className="progress-row-title">{set.title}</span>
                  <span className="progress-row-count">
                    {row && row.answered > 0
                      ? `${row.correct} of ${row.answered} correct`
                      : 'Not started'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <div className="practice-top">
      <button className="btn btn-ghost btn-back" onClick={onBack}>
        ← All sets
      </button>
    </div>
  );
}

/**
 * Display name, and the form to change it.
 *
 * Reads as a heading until you press Edit, because the name is something
 * you look at far more often than you change.
 */
function NameCard({ onSaved }: { onSaved: () => Promise<void> }) {
  const { session, profile } = useApp();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Same rule as the header: the name slot never falls back to the
  // email. Until the profile row lands there is simply no name yet.
  const displayName = profile?.username ?? '';

  const startEditing = useCallback(() => {
    setDraft(profile?.username ?? '');
    setError('');
    setNotice('');
    setEditing(true);
  }, [profile]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setError('');
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!CONFIGURED) {
      setError('Demo mode — connect Supabase to change your name.');
      return;
    }

    const next = draft.trim();
    if (next === profile?.username) {
      setEditing(false);
      return;
    }

    setBusy(true);
    setError('');
    try {
      await updateUsername(next);
      // Postgres owns the stored value, so re-read rather than assuming
      // the draft is what landed.
      await onSaved();
      setNotice('Saved.');
      setEditing(false);
    } catch (err) {
      // set_my_username() raises sentences, not constraint dumps, so the
      // message is already fit to show.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-card">
      <div className={'profile-identity' + (editing ? ' is-editing' : '')}>
        <span className="profile-avatar" aria-hidden="true">
          {displayName.slice(0, 1).toUpperCase()}
        </span>

        <div className="profile-names">
          {editing ? (
            <form className="name-form" onSubmit={(event) => void handleSubmit(event)}>
              <label className="field">
                <span>Display name</span>
                <input
                  type="text"
                  value={draft}
                  autoFocus
                  required
                  minLength={3}
                  maxLength={USERNAME_MAX}
                  // Mirrors the check in set_my_username(). The server is
                  // the one that decides; this just fails faster.
                  pattern="[A-Za-z0-9][A-Za-z0-9_]*"
                  title="3 to 20 letters, numbers or underscores, starting with a letter or number."
                  autoComplete="nickname"
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>

              <p className="field-hint">
                3–20 characters. Letters, numbers and underscores.
                <span className="field-count">
                  {draft.trim().length}/{USERNAME_MAX}
                </span>
              </p>

              {error && <p className="form-error">{error}</p>}

              <div className="name-form-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save name'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={cancelEditing}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1 className="profile-name">{displayName || 'Your profile'}</h1>
              <p className="profile-email">{session?.user.email}</p>
              {notice && <p className="form-notice">{notice}</p>}
            </>
          )}
        </div>

        {!editing && (
          <button type="button" className="btn btn-ghost" onClick={startEditing}>
            Edit name
          </button>
        )}
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: number;
  unit?: string;
  note?: string;
  emphasis?: boolean;
}

function Stat({ label, value, unit, note, emphasis = false }: StatProps) {
  return (
    <div className={'stat' + (emphasis ? ' stat-live' : '')}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value.toLocaleString()}
        {unit && <span className="stat-unit">{unit}</span>}
      </span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}
