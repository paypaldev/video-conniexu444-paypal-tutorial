// ---------------------------------------------------------------------
//  Turning a list of active days into a streak count and a calendar grid.
//
//  Pure functions over plain data, deliberately: this is the part with
//  the fiddly edge cases (a streak that has not been extended *yet*
//  today, the ragged week at either end of the year), and none of them
//  need React or a network call to reason about.
//
//  Dates here are handled as local wall-clock, never as UTC instants.
//  my_activity() already grouped the rows in the student's timezone, so
//  a key of '2026-08-17' means their August 17th. Parsing that with
//  `new Date('2026-08-17')` would read it as UTC midnight and shift the
//  whole chart back a day for anyone west of Greenwich.
// ---------------------------------------------------------------------

import type { ActivityDay } from '../types.js';

/**
 * How much history to ask for and draw.
 *
 * 371 = 53 weeks. The grid starts on the Sunday on or before "a year
 * ago", so it needs up to six days more than 365 to fill that first
 * column instead of leaving it half empty.
 */
export const ACTIVITY_DAYS = 371;

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

/** Answers in a day, and the shade that earns. Index is the level. */
const LEVEL_THRESHOLDS = [1, 5, 10, 20] as const;

export interface CalendarCell {
  /** 'YYYY-MM-DD', local. Also the React key. */
  key: string;
  date: Date;
  answered: number;
  correct: number;
  /** 0 (nothing) to 4 (most), mapped to the five shades in the CSS. */
  level: number;
  /**
   * A day after today. The grid is a rectangle, so the last column
   * usually runs past today — those cells are held open rather than
   * drawn, which keeps the columns aligned without pretending the
   * student failed to practise on a day that has not happened.
   */
  isFuture: boolean;
}

export interface MonthLabel {
  /** Index into the weeks array — which column the label sits above. */
  column: number;
  label: string;
}

export interface Calendar {
  /** Columns, oldest first. Each is a Sunday-to-Saturday week. */
  weeks: CalendarCell[][];
  monthLabels: MonthLabel[];
}

export interface StreakSummary {
  /** Consecutive active days ending today, or ending yesterday if today
   *  has not been used yet. */
  current: number;
  /** Longest run anywhere in the window. */
  longest: number;
  /** Whether today itself has an answer on it. */
  activeToday: boolean;
}

/** Local 'YYYY-MM-DD'. Not toISOString(), which converts to UTC first. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Midnight local on the same calendar day. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Add days to a date.
 *
 * Built through the Date constructor rather than by adding milliseconds:
 * a DST boundary makes some local days 23 or 25 hours long, and
 * arithmetic on the timestamp drifts across one. The constructor
 * normalises overflow (day 32 of a month becomes the 1st of the next),
 * so this stays correct across month and year ends too.
 */
export function addDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

/** How many whole local days separate two dates. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** Day keys to their counts, for O(1) lookup while walking the calendar. */
export function indexActivity(days: readonly ActivityDay[]): Map<string, ActivityDay> {
  return new Map(days.map((day) => [day.day, day]));
}

/**
 * Which of the five shades a day earns.
 *
 * The lowest threshold is 1, so a single answer always shows up. Nobody
 * should look at the chart and see an empty square on a day they did
 * practise.
 */
export function levelFor(answered: number): number {
  if (answered <= 0) return 0;
  return LEVEL_THRESHOLDS.filter((threshold) => answered >= threshold).length;
}

/**
 * Current and longest streaks.
 *
 * A streak survives the whole of today. Someone who practised for thirty
 * days straight and opens the page over breakfast should see 30, not 0 —
 * they have not missed a day, they just have not gone yet. So the walk
 * starts at today if today is active, and at yesterday otherwise; only a
 * fully skipped day breaks it.
 */
export function summariseStreaks(
  days: readonly ActivityDay[],
  today: Date = new Date()
): StreakSummary {
  const index = indexActivity(days);
  const isActive = (date: Date) => (index.get(dayKey(date))?.answered ?? 0) > 0;

  const activeToday = isActive(today);

  let current = 0;
  let cursor = activeToday ? startOfDay(today) : addDays(today, -1);
  while (isActive(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  // Longest walks the rows themselves rather than every date in the
  // window: the server only returns days with activity, so a gap in the
  // sequence is a gap in the streak.
  const sorted = [...days]
    .filter((day) => day.answered > 0)
    .sort((a, b) => a.day.localeCompare(b.day));

  let longest = 0;
  let run = 0;
  let previous: Date | null = null;

  for (const day of sorted) {
    const date = parseDayKey(day.day);
    run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }

  return { current, longest: Math.max(longest, current), activeToday };
}

/** '2026-08-17' as local midnight, not UTC midnight. */
export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/**
 * The grid itself: Sunday-to-Saturday columns ending with the week that
 * contains today.
 */
export function buildCalendar(
  days: readonly ActivityDay[],
  today: Date = new Date(),
  locale?: string
): Calendar {
  const index = indexActivity(days);
  const end = startOfDay(today);

  // Back a year, then back further to that week's Sunday so every column
  // is a full week and the weekday rows line up.
  const yearAgo = addDays(end, -(ACTIVITY_DAYS - DAYS_PER_WEEK));
  const start = addDays(yearAgo, -yearAgo.getDay());

  const weeks: CalendarCell[][] = [];
  const monthLabels: MonthLabel[] = [];
  const monthFormat = new Intl.DateTimeFormat(locale, { month: 'short' });

  let previousMonth = -1;
  let cursor = start;

  while (cursor <= end) {
    const week: CalendarCell[] = [];

    for (let weekday = 0; weekday < DAYS_PER_WEEK; weekday += 1) {
      const date = addDays(cursor, weekday);
      const key = dayKey(date);
      const entry = index.get(key);
      const answered = entry?.answered ?? 0;

      week.push({
        key,
        date,
        answered,
        correct: entry?.correct ?? 0,
        level: levelFor(answered),
        isFuture: date > end,
      });
    }

    // Label a column when its month differs from the previous column's.
    // Reading the first cell rather than the first non-future one keeps
    // the label attached to where the month visually begins.
    const columnMonth = week[0]!.date.getMonth();
    if (columnMonth !== previousMonth) {
      monthLabels.push({ column: weeks.length, label: monthFormat.format(week[0]!.date) });
      previousMonth = columnMonth;
    }

    weeks.push(week);
    cursor = addDays(cursor, DAYS_PER_WEEK);
  }

  // The first column is usually a few days of the previous month, which
  // would put two labels side by side at the left edge. Drop the first
  // if the second is right next to it.
  if (monthLabels.length > 1 && monthLabels[1]!.column <= 1) {
    monthLabels.shift();
  }

  return { weeks, monthLabels };
}

/** Total answers across the window. */
export function totalAnswered(days: readonly ActivityDay[]): number {
  return days.reduce((sum, day) => sum + day.answered, 0);
}

/** How many distinct days had any activity. */
export function activeDayCount(days: readonly ActivityDay[]): number {
  return days.filter((day) => day.answered > 0).length;
}
