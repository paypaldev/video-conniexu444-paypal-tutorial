// ---------------------------------------------------------------------
//  Every call that leaves the browser, in one place.
//
//  Components never talk to Supabase directly — they call these. Keeps
//  the "what does the client actually send?" question answerable by
//  reading one file, which matters most for checkout: the browser sends
//  a set id and an order id, and never a price or a user id.
// ---------------------------------------------------------------------

import { CONFIGURED } from '../config/supabase.js';
import { demoData } from '../demo-data.js';
import type {
  ActivityDay,
  Choice,
  Profile,
  Progress,
  Question,
  QuestionSet,
  SubmitAttemptResult,
} from '../types.js';
import { ACTIVITY_DAYS } from './streaks.js';
import { db } from './supabase.js';

export async function fetchSets(): Promise<QuestionSet[]> {
  const { data, error } = await db()
    .from('question_sets')
    .select('id, title, description, subject, is_free, price_cents, question_count, sort_order')
    .order('sort_order');

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchOwned(): Promise<Set<string>> {
  const { data, error } = await db().rpc('my_sets');
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.set_id));
}

export async function fetchProgress(): Promise<Record<string, Progress>> {
  const { data, error } = await db().rpc('my_progress');
  if (error) throw new Error(error.message);

  const progress: Record<string, Progress> = {};
  (data ?? []).forEach((row) => {
    progress[row.set_id] = {
      answered: Number(row.answered),
      correct: Number(row.correct),
    };
  });
  return progress;
}

export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await db().rpc('my_profile');
  if (error) throw new Error(error.message);
  // Returns a set of rows; there is only ever one, for the caller.
  return data?.[0] ?? null;
}

/** Returns the name as stored, which is the trimmed version of the input. */
export async function updateUsername(username: string): Promise<string> {
  const { data, error } = await db().rpc('set_my_username', { p_username: username });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Day-by-day answer counts for the contribution chart.
 *
 * The timezone is read from the browser and sent to Postgres, so a day
 * boundary means the student's midnight rather than UTC's. A browser
 * that cannot report one falls back to UTC on the server.
 */
export async function fetchActivity(days = ACTIVITY_DAYS): Promise<ActivityDay[]> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const { data, error } = await db().rpc('my_activity', { p_tz: timeZone, p_days: days });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    day: row.day,
    answered: Number(row.answered),
    correct: Number(row.correct),
  }));
}

export async function fetchQuestions(setId: string): Promise<Question[]> {
  if (!CONFIGURED) return demoData.questions[setId] ?? [];

  const { data, error } = await db()
    .from('questions')
    .select('id, passage, stem, choices, sort_order')
    .eq('set_id', setId)
    .order('sort_order');

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Ids of the questions in a set this student has already answered.
 *
 * Empty for a signed-out student rather than an error: they have no
 * history to skip, and the caller should not have to special-case that.
 */
export async function fetchAnsweredIds(setId: string): Promise<Set<string>> {
  if (!CONFIGURED) return new Set<string>();

  const { data, error } = await db().rpc('my_answered', { p_set_id: setId });
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.question_id));
}

/**
 * Grade one answer.
 *
 * The correct choice is only ever revealed by this call's return value —
 * question_keys is unreadable from the browser, so a student cannot see
 * the answer before committing to one.
 */
export async function submitAttempt(
  questionId: string,
  choice: string
): Promise<SubmitAttemptResult> {
  const { data, error } = await db().rpc('submit_attempt', {
    p_question_id: questionId,
    p_choice: choice,
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error('No result returned.');
  return data;
}

/** choices is jsonb; a hand-seeded row can still hand back a string. */
export function parseChoices(raw: Choice[] | string): Choice[] {
  return Array.isArray(raw) ? raw : (JSON.parse(raw) as Choice[]);
}
