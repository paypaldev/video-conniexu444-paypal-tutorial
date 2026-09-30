// ---------------------------------------------------------------------
//  Streaks and the contribution calendar.
//
//  All of this is local wall-clock date arithmetic, which is where the
//  bugs hide: a streak that resets because the browser is west of UTC,
//  or a calendar that shifts a day across a DST boundary. Every case
//  below is one of those, and the suite is run under several timezones
//  in CI-by-hand (TZ=... npm test) rather than trusting the machine's.
// ---------------------------------------------------------------------

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIVITY_DAYS,
  addDays,
  buildCalendar,
  dayKey,
  levelFor,
  parseDayKey,
  summariseStreaks,
} from '../src/lib/streaks.js';
import type { ActivityDay } from '../src/types.js';

/** A fixed Monday, so the tests do not drift with the calendar. */
const TODAY = new Date(2026, 7, 17);

const day = (offset: number, answered = 3, correct = 2): ActivityDay => ({
  day: dayKey(addDays(TODAY, offset)),
  answered,
  correct,
});

describe('levelFor', () => {
  it('gives nothing a level of 0', () => {
    assert.equal(levelFor(0), 0);
  });

  it('lights up on a single answer', () => {
    // A day the student practised must never look like a day they did not.
    assert.equal(levelFor(1), 1);
  });

  it('steps at 5, 10 and 20', () => {
    assert.equal(levelFor(4), 1);
    assert.equal(levelFor(5), 2);
    assert.equal(levelFor(10), 3);
    assert.equal(levelFor(20), 4);
  });

  it('caps at the darkest shade', () => {
    assert.equal(levelFor(500), 4);
  });
});

describe('summariseStreaks', () => {
  it('reports nothing for an empty history', () => {
    assert.deepEqual(summariseStreaks([], TODAY), {
      current: 0,
      longest: 0,
      activeToday: false,
    });
  });

  it('counts consecutive days ending today', () => {
    assert.deepEqual(summariseStreaks([day(0), day(-1), day(-2)], TODAY), {
      current: 3,
      longest: 3,
      activeToday: true,
    });
  });

  it('survives a day that has not been used yet', () => {
    // Someone thirty days in, opening the page over breakfast, has not
    // missed anything. Showing 0 until they answer would be a lie.
    assert.deepEqual(summariseStreaks([day(-1), day(-2), day(-3)], TODAY), {
      current: 3,
      longest: 3,
      activeToday: false,
    });
  });

  it('breaks once a whole day is skipped', () => {
    assert.deepEqual(summariseStreaks([day(-2), day(-3)], TODAY), {
      current: 0,
      longest: 2,
      activeToday: false,
    });
  });

  it('remembers a longer run from earlier', () => {
    const history = [day(0), day(-5), day(-6), day(-7), day(-8)];
    assert.deepEqual(summariseStreaks(history, TODAY), {
      current: 1,
      longest: 4,
      activeToday: true,
    });
  });

  it('does not count a day with zero answers', () => {
    const history = [day(0), day(-1, 0, 0), day(-2)];
    assert.deepEqual(summariseStreaks(history, TODAY), {
      current: 1,
      longest: 1,
      activeToday: true,
    });
  });

  it('carries a streak across new year', () => {
    const history: ActivityDay[] = [
      { day: '2026-01-02', answered: 1, correct: 1 },
      { day: '2026-01-01', answered: 1, correct: 1 },
      { day: '2025-12-31', answered: 1, correct: 1 },
      { day: '2025-12-30', answered: 1, correct: 1 },
    ];
    assert.equal(summariseStreaks(history, new Date(2026, 0, 2)).current, 4);
  });
});

describe('date helpers', () => {
  it('round-trips a day key without shifting timezone', () => {
    // new Date('2026-03-08') would parse as UTC midnight and land on the
    // 7th for anyone west of Greenwich. parseDayKey must not do that.
    assert.equal(dayKey(parseDayKey('2026-03-08')), '2026-03-08');
  });

  it('advances exactly one day across a DST boundary', () => {
    // 8 March 2026 is a spring-forward date in US timezones; that day is
    // 23 hours long, so millisecond arithmetic drifts here.
    assert.equal(dayKey(addDays(new Date(2026, 2, 7), 1)), '2026-03-08');
    assert.equal(dayKey(addDays(new Date(2026, 2, 8), -1)), '2026-03-07');
  });

  it('rolls over month and year ends', () => {
    assert.equal(dayKey(addDays(new Date(2026, 0, 31), 1)), '2026-02-01');
    assert.equal(dayKey(addDays(new Date(2026, 11, 31), 1)), '2027-01-01');
  });
});

describe('buildCalendar', () => {
  const calendar = buildCalendar([day(0), day(-1)], TODAY);
  const cells = calendar.weeks.flat();

  it('builds full Sunday-to-Saturday columns', () => {
    assert.ok(calendar.weeks.every((week) => week.length === 7));
    assert.equal(calendar.weeks[0]![0]!.date.getDay(), 0);
  });

  it('fits a year without exceeding 53 columns', () => {
    assert.ok(calendar.weeks.length <= 53);
    assert.ok(cells.length >= 365);
  });

  it('ends on today, with only the rest of this week ahead', () => {
    const past = cells.filter((cell) => !cell.isFuture);
    assert.equal(dayKey(past.at(-1)!.date), dayKey(TODAY));

    const future = cells.filter((cell) => cell.isFuture);
    assert.ok(future.length <= 6);
    assert.ok(future.every((cell) => cell.date > TODAY));
  });

  it('places counts on the right day and no other', () => {
    assert.equal(cells.find((cell) => cell.key === dayKey(TODAY))!.answered, 3);
    assert.equal(cells.filter((cell) => cell.level > 0).length, 2);
  });

  it('never repeats a day', () => {
    assert.equal(new Set(cells.map((cell) => cell.key)).size, cells.length);
  });

  it('labels every month once, in order', () => {
    assert.ok(calendar.monthLabels.length >= 12);
    const columns = calendar.monthLabels.map((label) => label.column);
    assert.deepEqual(columns, [...columns].sort((a, b) => a - b));
    assert.equal(new Set(columns).size, columns.length);
  });

  it('asks the server for at least what it draws', () => {
    // If ACTIVITY_DAYS ever drops below the grid, the oldest column
    // silently renders as empty rather than as missing.
    assert.ok(ACTIVITY_DAYS >= cells.filter((cell) => !cell.isFuture).length);
  });
});
