// ---------------------------------------------------------------------
//  The contribution chart — a year of practice, one square per day.
//
//  Built as a <table> rather than a grid of divs. The shape is genuinely
//  tabular (weekdays down, weeks across), and it is the one structure
//  that gives a screen reader something navigable: row headers name the
//  weekday, and every cell carries a full sentence in its label. A wall
//  of <div>s would be 371 unlabelled boxes.
// ---------------------------------------------------------------------

import { useEffect, useMemo, useRef } from 'react';

import {
  ACTIVITY_DAYS,
  activeDayCount,
  buildCalendar,
  totalAnswered,
  type CalendarCell,
} from '../lib/streaks.js';
import type { ActivityDay } from '../types.js';

/** Rows are Sunday-first to match the week columns the calendar builds. */
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Only every other row is labelled, exactly as GitHub does — seven
 *  stacked labels would be taller than the squares they annotate. */
const LABELLED_WEEKDAYS = new Set([1, 3, 5]);

const LEVELS = [0, 1, 2, 3, 4];

function describe(cell: CalendarCell, dateFormat: Intl.DateTimeFormat): string {
  const when = dateFormat.format(cell.date);
  if (cell.answered === 0) return `No questions answered on ${when}`;
  const noun = cell.answered === 1 ? 'question' : 'questions';
  return `${cell.answered} ${noun} answered on ${when}, ${cell.correct} correct`;
}

export function ActivityChart({ days }: { days: readonly ActivityDay[] }) {
  // Rebuilding the grid means 371 date allocations, and the profile page
  // re-renders on every keystroke in the name field.
  const calendar = useMemo(() => buildCalendar(days), [days]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }),
    []
  );

  const total = totalAnswered(days);
  const activeDays = activeDayCount(days);

  // On a narrow screen the grid is wider than its box. Start it at the
  // right-hand end: this week is the part anyone actually came to see,
  // and last August is not worth a swipe to get past.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [calendar]);

  return (
    <section className="activity" aria-labelledby="activity-heading">
      <div className="activity-head">
        <h2 id="activity-heading" className="section-heading">
          {total.toLocaleString()} {total === 1 ? 'question' : 'questions'} in the last year
        </h2>
        <p className="activity-sub">
          {activeDays === 0
            ? 'Answer a question and the first square lights up.'
            : `Practised on ${activeDays} ${activeDays === 1 ? 'day' : 'days'}.`}
        </p>
      </div>

      {/* The grid is wider than a phone. It scrolls inside this box
          rather than stretching the page. */}
      <div className="activity-scroll" ref={scrollRef}>
        <table className="activity-grid">
          <caption className="visually-hidden">
            Questions answered each day over the last {ACTIVITY_DAYS} days.
          </caption>

          <thead>
            <tr>
              {/* The corner above the weekday column. The cover is a real
                  element rather than a background on the cell: in a table,
                  every cell background paints *beneath* every cell's
                  content, so the pinned column's background alone cannot
                  hide a month label scrolling past underneath it. */}
              <th scope="col" className="activity-corner">
                <span className="activity-cover" aria-hidden="true" />
                <span className="visually-hidden">Day of the week</span>
              </th>
              {calendar.weeks.map((week, column) => {
                const label = calendar.monthLabels.find((month) => month.column === column);
                return (
                  <th scope="col" key={week[0]!.key} className="activity-month">
                    {label ? (
                      <span className="activity-month-label">{label.label}</span>
                    ) : (
                      <span className="visually-hidden">
                        Week of {dateFormat.format(week[0]!.date)}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {WEEKDAY_NAMES.map((weekday, row) => (
              <tr key={weekday}>
                <th scope="row" className="activity-weekday">
                  {LABELLED_WEEKDAYS.has(row) ? (
                    <span aria-hidden="true">{weekday.slice(0, 3)}</span>
                  ) : null}
                  <span className="visually-hidden">{weekday}</span>
                </th>

                {calendar.weeks.map((week) => {
                  const cell = week[row]!;

                  // Days after today keep the column rectangular but are
                  // not squares — there is nothing to report about them.
                  if (cell.isFuture) {
                    return <td key={cell.key} className="activity-cell is-future" />;
                  }

                  const summary = describe(cell, dateFormat);

                  return (
                    // The sentence lives in real text inside the cell
                    // rather than in an aria-label on the square: a
                    // <span> with no role is not reliably announced, and
                    // a reader moving through the table by cell should
                    // hear the day it landed on. `title` is the same
                    // sentence for the mouse.
                    <td key={cell.key} className="activity-cell" title={summary}>
                      <span className="activity-day" data-level={cell.level} aria-hidden="true" />
                      <span className="visually-hidden">{summary}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="activity-legend" aria-hidden="true">
        <span>Less</span>
        {LEVELS.map((level) => (
          <span key={level} className="activity-day" data-level={level} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}
