// ---------------------------------------------------------------------
//  Turning server errors into sentences a student can act on.
// ---------------------------------------------------------------------

/** Message off an unknown thrown value, without assuming it is an Error. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Supabase's raw auth messages are accurate but read like server logs.
 * Translate the ones a student will actually hit.
 *
 * Deliberately does not say whether it was the email or the password that
 * was wrong — that difference tells an attacker which accounts exist.
 */
export function friendlyAuthError(error: unknown): string {
  const source = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof source.code === 'string' ? source.code : '';
  const raw = typeof source.message === 'string' ? source.message : '';
  const msg = raw.toLowerCase();

  if (code === 'invalid_credentials' || msg.includes('invalid login')) {
    return 'That email and password do not match. Check both and try again.';
  }
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) {
    return 'Confirm your email first — check your inbox for the link.';
  }
  if (code === 'user_already_exists' || msg.includes('already registered')) {
    return 'You already have an account with this email. Sign in instead.';
  }
  if (code === 'weak_password' || msg.includes('password should be')) {
    return 'Use a password of at least 8 characters.';
  }
  if (code === 'validation_failed' || msg.includes('unable to validate email')) {
    return 'That does not look like a valid email address.';
  }
  if (code === 'over_request_rate_limit' || msg.includes('rate limit')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return 'Could not reach the server. Check your connection.';
  }
  return raw || 'Something went wrong. Try again.';
}

/**
 * Pull a useful message out of a supabase-js FunctionsHttpError.
 *
 * Edge Functions return { error: "..." } bodies; supabase-js wraps the
 * Response rather than reading it, so the useful text is one await away.
 */
export async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.json()) as { error?: unknown };
      if (typeof body.error === 'string') return body.error;
    } catch {
      // Fall through to the generic message.
    }
  }
  return fallback;
}
