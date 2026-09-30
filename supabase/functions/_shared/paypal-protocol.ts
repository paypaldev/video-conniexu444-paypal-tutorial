// ---------------------------------------------------------------------
//  Pure PayPal HTTP helpers — no Deno, no fetch.
//
//  Kept free of runtime APIs so tests/paypal-protocol.test.ts can pin
//  Retry-After parsing, debug_id extraction, and INSTRUMENT_DECLINED
//  detection without Edge Function secrets.
// ---------------------------------------------------------------------

/** Cap the one automatic 429 wait so a demo-scale Edge Function cannot
 *  sleep away most of its wall clock on PayPal's Retry-After. */
export const PAYPAL_RETRY_WAIT_CAP_MS = 2_000;

/** Used when PayPal returns 429 with no Retry-After header. */
export const PAYPAL_RETRY_WAIT_DEFAULT_MS = 1_000;

export const INSTRUMENT_DECLINED = 'INSTRUMENT_DECLINED';

/** True for a plain object (PayPal events, error bodies). Arrays, null
 *  and primitives are not. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Retry-After is either a delay in seconds or an HTTP-date.
 * Returns milliseconds, or null if the header is missing/unusable.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now: () => number = Date.now
): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.ceil(ms);
  }

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now());
}

export function capRetryWaitMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(ms, PAYPAL_RETRY_WAIT_CAP_MS);
}

/** How long to sleep before the single automatic retry. */
export function retryWaitMs(header: string | null | undefined, now: () => number = Date.now): number {
  return capRetryWaitMs(parseRetryAfterMs(header, now) ?? PAYPAL_RETRY_WAIT_DEFAULT_MS);
}

/**
 * PayPal puts debug_id on the response header and sometimes on the JSON
 * body. The header is the one support asks for; the body is a fallback.
 */
export function paypalDebugId(
  headers: { get(name: string): string | null },
  body?: unknown
): string | null {
  const fromHeader = headers.get('paypal-debug-id') ?? headers.get('PayPal-Debug-Id');
  if (fromHeader && fromHeader.trim()) return fromHeader.trim();

  if (isJsonObject(body) && typeof body.debug_id === 'string' && body.debug_id) {
    return body.debug_id;
  }
  return null;
}

export function paypalIssue(body: unknown, issue: string): boolean {
  if (!isJsonObject(body) || !Array.isArray(body.details)) return false;
  return body.details.some(
    (detail) => isJsonObject(detail) && detail.issue === issue
  );
}

const CLIENT_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Optional idempotency key from the browser for one create-order click
 * (including its 429 retry). Not identity and not a price — junk is ignored.
 */
export function parseClientRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!CLIENT_REQUEST_ID.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Fold the signed-in user into the PayPal-Request-Id so a borrowed UUID
 * cannot collide with another student's create. Same user + same client
 * key → same PayPal header, which is what the 429 retry needs.
 */
export async function scopedPaypalRequestId(userId: string, clientRequestId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`katsat-create:${userId}:${clientRequestId}`)
  );
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
