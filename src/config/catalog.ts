// ---------------------------------------------------------------------
//  What the catalogue shows.
//
//  Paid sets stay off katsat.org until SHOW_PAID_SETS is forced true.
//  Localhost still lists them so sandbox checkout can be exercised
//  without shipping the paywall. This is presentation, not enforcement
//  — the paywall is RLS on public.questions, and it is still in force.
//  Checkout, entitlements and the Edge Functions are untouched.
// ---------------------------------------------------------------------

import type { QuestionSet } from '../types.js';

function isLocalHost(): boolean {
  return (
    typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  );
}

/** True on localhost so sandbox checkout can be exercised. False on katsat.org. */
export const SHOW_PAID_SETS = isLocalHost();

/** The sets a student is allowed to see listed. */
export function visibleSets(sets: readonly QuestionSet[]): QuestionSet[] {
  if (SHOW_PAID_SETS) return [...sets];
  return sets.filter((set) => set.is_free);
}
