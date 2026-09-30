import { useEffect, useRef, useState } from 'react';

import { CalculatorPane } from './CalculatorPane.js';
import { MathText } from './MathText.js';
import { CONFIGURED } from '../config/supabase.js';
import { celebrate, pickPraise } from '../lib/celebrate.js';
import { parseChoices, submitAttempt } from '../lib/api.js';
import { errorMessage } from '../lib/errors.js';
import { useApp } from '../state/AppContext.js';
import type { Question, QuestionSet, SubmitAttemptResult } from '../types.js';

interface PracticeViewProps {
  set: QuestionSet;
  questions: Question[];
  /** This run is a second pass over questions already answered. */
  replay: boolean;
  onExit: () => void;
  onRetry: () => void;
}

export function PracticeView({ set, questions, replay, onExit, onRetry }: PracticeViewProps) {
  const { session, requireAuth, showBanner, showBannerHtml, refreshProgress } = useApp();

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [finished, setFinished] = useState(false);
  /** Set when the student hit submit while signed out. An effect retries
   *  once the session arrives — replaying a captured handleSubmit would
   *  re-read the signed-out session and reopen the auth dialog forever. */
  const [pendingSubmit, setPendingSubmit] = useState(false);
  /** Calculator pane. Held here rather than inside the pane so the iframe
   *  survives moving between questions — remounting it would wipe whatever
   *  the student had graphed. */
  const [calcOpen, setCalcOpen] = useState(false);

  const choicesRef = useRef<HTMLDivElement>(null);

  const question = questions[index];
  const locked = result !== null;
  // The site is math-only, so the calculator link always applies. Kept as
  // a named flag rather than inlined so re-gating it is one line if a
  // non-math subject is ever added back.
  const showCalculator = set.subject === 'math';

  // The celebration needs the DOM node of the correct choice, which only
  // exists after the result has rendered — so it fires in an effect
  // rather than inline in the submit handler.
  useEffect(() => {
    if (!result?.is_correct) return;
    const el = choicesRef.current?.querySelector<HTMLButtonElement>(
      `[data-label="${CSS.escape(result.correct_choice)}"]`
    );
    celebrate(el ?? null);
  }, [result]);

  useEffect(() => {
    if (!pendingSubmit || !session) return;
    setPendingSubmit(false);
    void handleSubmit();
    // handleSubmit is redefined every render and closes over the current
    // session, which is the point — depending on it would defeat the fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit, session]);

  if (!question) {
    return (
      <section className="view">
        <p className="hero-sub">That set has no questions yet.</p>
      </section>
    );
  }

  async function handleSubmit() {
    if (locked || !selected || submitting) return;

    // Login gate. The server enforces this too — this is just a nicer
    // experience than watching the request fail.
    if (!session) {
      requireAuth(
        'Continue with Google to check your answer and save your progress.',
        () => setPendingSubmit(true)
      );
      return;
    }

    if (!CONFIGURED) {
      showBannerHtml('Demo mode — connect Supabase in <code>config/supabase.ts</code> to submit answers.');
      return;
    }

    setSubmitting(true);
    try {
      const outcome = await submitAttempt(question!.id, selected);
      setResult(outcome);
      setAnsweredCount((n) => n + 1);
      if (outcome.is_correct) {
        setCorrectCount((n) => n + 1);
        setStreak((n) => n + 1);
      } else {
        setStreak(0);
      }
    } catch (err) {
      showBanner('Could not submit: ' + errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleNext() {
    if (index + 1 >= questions.length) {
      setFinished(true);
      void refreshProgress();
      return;
    }
    setIndex((i) => i + 1);
    setSelected(null);
    setResult(null);
  }

  const choices = parseChoices(question.choices);
  const isLastQuestion = index + 1 >= questions.length;

  return (
    <section className={'view' + (calcOpen ? ' view-split' : '')}>
      <div className="practice-main">
      <div className="practice-top">
        <button className="btn btn-ghost btn-back" onClick={onExit}>
          ← All sets
        </button>

        {/* Splits the screen with the real Desmos rather than shipping a
            lookalike — it is the calculator students actually get in
            Bluebook on test day. */}
        {showCalculator && !calcOpen && (
          <button
            type="button"
            className="btn btn-ghost btn-calc"
            onClick={() => setCalcOpen(true)}
            title="Show the graphing calculator beside the question"
          >
            Calculator
          </button>
        )}

        <div className="progress">
          <span className="q-counter">
            {finished ? 'Complete' : `Question ${index + 1} of ${questions.length}`}
          </span>
          <div className="progress-track">
            <div
              className="progress-bar"
              style={{ width: finished ? '100%' : `${(index / questions.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {!finished && (
        <article className="question-card">
          {question.passage && (
            <p className="q-passage">
              <MathText>{question.passage}</MathText>
            </p>
          )}
          <h2 className="q-stem">
            <MathText>{question.stem}</MathText>
          </h2>

          <div className="q-choices" ref={choicesRef}>
            {choices.map((choice) => {
              const classes = ['choice'];
              if (!locked && selected === choice.label) classes.push('selected');
              if (result) {
                if (choice.label === result.correct_choice) classes.push('is-correct');
                else if (choice.label === selected && !result.is_correct) classes.push('is-wrong');
              }

              return (
                <button
                  key={choice.label}
                  type="button"
                  className={classes.join(' ')}
                  data-label={choice.label}
                  disabled={locked}
                  onClick={() => !locked && setSelected(choice.label)}
                >
                  <span className="choice-label">{choice.label}</span>
                  <span>
                    <MathText>{choice.text}</MathText>
                  </span>
                </button>
              );
            })}
          </div>

          {result && <Feedback result={result} streak={streak} />}

          <div className="question-actions">
            {!locked ? (
              <button
                className="btn btn-primary"
                disabled={!selected || submitting}
                onClick={() => void handleSubmit()}
              >
                {submitting ? 'Checking…' : 'Submit answer'}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={handleNext}>
                {isLastQuestion ? 'Finish set →' : 'Next question →'}
              </button>
            )}
          </div>

          {!session && (
            <p className="signin-nudge">
              You need an account to submit answers — it is how your progress gets saved.
            </p>
          )}
        </article>
      )}

      {finished && (
        <div className="set-complete">
          <h2>{replay ? 'Second pass complete' : 'All caught up'}</h2>
          <p className="set-score">
            You got {correctCount} of {answeredCount} right in {set.title}.
          </p>
          {!replay && (
            <p className="set-score">
              That is every new question in this set — come back for another pass any time.
            </p>
          )}
          <div className="set-complete-actions">
            <button className="btn btn-primary" onClick={onExit}>
              Back to all sets
            </button>
            <button className="btn btn-ghost" onClick={onRetry}>
              Practise these again
            </button>
          </div>
        </div>
      )}
      </div>

      {showCalculator && calcOpen && <CalculatorPane onClose={() => setCalcOpen(false)} />}
    </section>
  );
}

function Feedback({ result, streak }: { result: SubmitAttemptResult; streak: number }) {
  // Praise is picked once per result, not on every render — otherwise the
  // word changes underneath the student on unrelated state updates.
  const [praise] = useState(() => pickPraise(streak));

  return (
    <div className={'feedback ' + (result.is_correct ? 'correct' : 'wrong')}>
      {result.is_correct ? (
        <p className="feedback-verdict verdict-line">
          <span className="check-badge">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 6.2 L5 8.7 L9.5 3.6" />
            </svg>
          </span>
          <span>{praise}</span>
          {streak >= 2 && <span className="streak-chip">{streak} in a row</span>}
        </p>
      ) : (
        <p className="feedback-verdict">Not quite — the answer is {result.correct_choice}.</p>
      )}
      <p className="feedback-explanation">
        <MathText>{result.explanation ?? ''}</MathText>
      </p>
    </div>
  );
}
