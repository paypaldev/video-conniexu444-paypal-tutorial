import { useApp } from '../state/AppContext.js';
import type { QuestionSet } from '../types.js';

export function priceLabel(set: QuestionSet): string {
  if (set.is_free) return 'Free';
  const cents = set.price_cents || 0;
  return cents % 100 === 0 ? '$' + cents / 100 : '$' + (cents / 100).toFixed(2);
}

function SetCard({ set, onOpen }: { set: QuestionSet; onOpen: (set: QuestionSet) => void }) {
  const { isLocked, progress } = useApp();
  const locked = isLocked(set);
  const prog = progress[set.id];

  // my_progress() counts distinct questions, so this is questions never
  // seen — not attempts remaining. Floored at zero because question_count
  // is denormalised and could lag a question being moved between sets.
  const remaining = Math.max(0, set.question_count - (prog?.answered ?? 0));

  return (
    <button
      type="button"
      className={'set-card' + (locked ? ' locked' : '')}
      onClick={() => onOpen(set)}
    >
      <div className="set-card-top">
        <span className="set-title">{set.title}</span>
        {set.is_free ? (
          <span className="tag tag-free">Free</span>
        ) : locked ? (
          // Show the price rather than the word "Locked" — it answers the
          // question the student is actually asking.
          <span className="tag tag-locked">{priceLabel(set)}</span>
        ) : (
          <span className="tag tag-free">Unlocked</span>
        )}
      </div>

      <p className="set-desc">{set.description ?? ''}</p>

      {prog && prog.answered > 0 && (
        <div className="set-meta">
          {prog.correct} of {prog.answered} correct so far
          {/* What is left to see, not just what is done — answered
              questions are skipped when the set is opened, so this is
              the number that decides whether it is worth opening. */}
          {' · '}
          {remaining > 0
            ? `${remaining} new ${remaining === 1 ? 'question' : 'questions'} left`
            : 'every question answered'}
        </div>
      )}
    </button>
  );
}

export function SetList({ onOpen }: { onOpen: (set: QuestionSet) => void }) {
  const { sets } = useApp();

  return (
    <section className="view">
      <div className="hero">
        <h1>SAT Practice Questions</h1>
        <p className="hero-sub">Practice for the SAT</p>
      </div>

      <div className="set-list">
        {sets.length === 0 ? (
          <p className="hero-sub">No question sets yet. Run supabase/seed.sql to load the samples.</p>
        ) : (
          sets.map((set) => <SetCard key={set.id} set={set} onOpen={onOpen} />)
        )}
      </div>

      {/* Deliberately not the <Banner> component — that strip is for
          transient errors, so an error would wipe this out. This sits at
          the end of the list, where it reads as what comes after the
          sets above rather than as an alert. */}
      <div className="upcoming">
        <span className="tag tag-locked">Coming soon</span>
        <p className="upcoming-text">
          <strong>Reading &amp; Writing.</strong> Every set on KatSAT is math for now — reading
          and writing practice is on the way.
        </p>
      </div>
    </section>
  );
}
