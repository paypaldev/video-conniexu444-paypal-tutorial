// ---------------------------------------------------------------------
//  Light 429 handling for create-order / capture-order.
//
//  The Edge Functions already retry PayPal once. If they still return
//  429, the browser waits at most a couple of seconds and tries the
//  function once more, then tells the student to try again in N seconds.
//  INSTRUMENT_DECLINED is deliberately not special-cased here.
// ---------------------------------------------------------------------

import { edgeErrorMessage } from './errors.js';

export const CLIENT_RETRY_AFTER_CAP_MS = 3_000;
export const CLIENT_RETRY_AFTER_DEFAULT_MS = 1_000;

export function functionsHttpStatus(error: unknown): number | null {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) return context.status;
  return null;
}

export function retryAfterHeaderFromError(error: unknown): string | null {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  return context.headers.get('Retry-After');
}

/**
 * Retry-After is either a delay in seconds or an HTTP-date.
 * Same rules as the Edge Function helper — kept here so the browser
 * bundle does not import supabase/functions/.
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

export function busyTryAgainMessage(retryAfterMs: number | null): string {
  if (retryAfterMs == null || retryAfterMs <= 0) {
    return 'PayPal is busy. Try again in a few seconds.';
  }
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `PayPal is busy. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
}

export function checkoutErrorMessageFromStatus(error: unknown): string | null {
  if (functionsHttpStatus(error) !== 429) return null;
  return busyTryAgainMessage(parseRetryAfterMs(retryAfterHeaderFromError(error)));
}

export async function messageFromCheckoutError(error: unknown, fallback: string): Promise<string> {
  return checkoutErrorMessageFromStatus(error) ?? (await edgeErrorMessage(error, fallback));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface InvokeResult<T> {
  data: T;
  error: unknown;
}

export interface CreateOrderRequest {
  set_id: string;
  /** Same UUID on the one 429 retry of this click, so PayPal sees one create. */
  request_id: string;
}

export function newCheckoutRequestId(): string {
  return crypto.randomUUID();
}

/**
 * One extra try when the Edge Function forwards PayPal's 429.
 * Cap the wait so the paywall cannot freeze on a long Retry-After.
 */
export async function invokeWithOneRetryAfter<T>(
  invoke: () => Promise<InvokeResult<T>>,
  options?: {
    sleep?: (ms: number) => Promise<void>;
    capMs?: number;
    now?: () => number;
  }
): Promise<InvokeResult<T>> {
  const first = await invoke();
  if (!first.error || functionsHttpStatus(first.error) !== 429) return first;

  const wait = Math.min(
    parseRetryAfterMs(retryAfterHeaderFromError(first.error), options?.now) ??
      CLIENT_RETRY_AFTER_DEFAULT_MS,
    options?.capMs ?? CLIENT_RETRY_AFTER_CAP_MS
  );
  await (options?.sleep ?? sleep)(wait);
  return invoke();
}

/**
 * create-order retry must send the same request_id both times. A new
 * UUID per invoke would mint a second PayPal order if the first POST
 * actually landed before the 429 reached us.
 */
export async function invokeCreateOrderWithOneRetryAfter<T>(
  invoke: (body: CreateOrderRequest) => Promise<InvokeResult<T>>,
  setId: string,
  options?: {
    sleep?: (ms: number) => Promise<void>;
    capMs?: number;
    now?: () => number;
    requestId?: string;
  }
): Promise<InvokeResult<T>> {
  const requestId = options?.requestId ?? newCheckoutRequestId();
  return invokeWithOneRetryAfter(
    () => invoke({ set_id: setId, request_id: requestId }),
    options
  );
}
