// ---------------------------------------------------------------------
//  PayPal REST helpers, shared by the three checkout functions.
//
//  Everything here runs server-side in Deno. The client secret and the
//  Supabase service role key are read from Edge Function secrets and
//  must never appear in src/ — anything under src/ is bundled into
//  public/app.js and served to the browser.
//
//  Set them with:
//    supabase secrets set PAYPAL_CLIENT_ID=...
//    supabase secrets set PAYPAL_SECRET=...
//    supabase secrets set PAYPAL_WEBHOOK_ID=...
//    supabase secrets set PAYPAL_ENV=sandbox     # or 'live'
// ---------------------------------------------------------------------

import {
  INSTRUMENT_DECLINED,
  paypalDebugId,
  paypalIssue,
  retryWaitMs,
} from './paypal-protocol.ts';

export {
  INSTRUMENT_DECLINED,
  isJsonObject,
  parseClientRequestId,
  paypalDebugId,
  paypalIssue,
  retryWaitMs,
  scopedPaypalRequestId,
} from './paypal-protocol.ts';

const PAYPAL_ENV = Deno.env.get('PAYPAL_ENV') ?? 'sandbox';

export const PAYPAL_API_BASE =
  PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

/** Throws at startup rather than mid-payment if a secret is missing. */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required secret ${name}. Set it with: supabase secrets set ${name}=...`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429 from PayPal OAuth or Orders — callers must forward this as 429,
 *  not collapse it into a generic 502/500. */
export class PayPalRateLimitError extends Error {
  readonly status = 429 as const;

  constructor(
    readonly retryAfter: string | null,
    readonly debugId: string | null
  ) {
    super('PayPal rate-limited this request.');
    this.name = 'PayPalRateLimitError';
  }
}

export function isPayPalRateLimitError(err: unknown): err is PayPalRateLimitError {
  return err instanceof PayPalRateLimitError;
}

export function retryAfterHeaders(retryAfter: string | null | undefined): Record<string, string> {
  return retryAfter ? { 'Retry-After': retryAfter } : {};
}

export function logPayPalFailure(action: string, res: Response, body?: unknown): void {
  const debugId = paypalDebugId(res.headers, body);
  const detail = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  console.error(`PayPal ${action} failed (${res.status}) debug_id=${debugId ?? 'none'}: ${detail}`);
}

async function sendOnceThenRetry429(label: string, send: () => Promise<Response>): Promise<Response> {
  const first = await send();
  if (first.status !== 429) return first;

  const retryAfter = first.headers.get('Retry-After');
  const wait = retryWaitMs(retryAfter);
  console.warn(
    `PayPal ${label} returned 429; retrying once after ${wait}ms. debug_id=${paypalDebugId(first.headers) ?? 'none'}`
  );
  await sleep(wait);
  return await send();
}

/**
 * OAuth2 client-credentials token for KatSAT's single PayPal app.
 *
 * Not cached on purpose for this teaching demo. Edge Function isolates
 * are short-lived, so a process-local cache rarely pays off, and skipping
 * it keeps the token path easy to read. This is one merchant's
 * client-credentials token, not a per-user token — there is no
 * cross-tenant credential to leak.
 *
 * Production apps should cache until `expires_in` (up to ~9 hours) per
 * PayPal guidance. That is out of scope here.
 *
 * A 429 here is thrown as PayPalRateLimitError so create/capture/webhook
 * can return 429 + Retry-After instead of a generic 502/503.
 */
export async function getAccessToken(): Promise<string> {
  const clientId = requireEnv('PAYPAL_CLIENT_ID');
  const secret = requireEnv('PAYPAL_SECRET');
  const basic = btoa(`${clientId}:${secret}`);

  const send = () =>
    fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

  const res = await sendOnceThenRetry429('oauth', send);

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const text = await res.text();
    logPayPalFailure('oauth', res, text);
    throw new PayPalRateLimitError(retryAfter, paypalDebugId(res.headers));
  }

  if (!res.ok) {
    const text = await res.text();
    logPayPalFailure('oauth', res, text);
    throw new Error(`PayPal auth failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('PayPal auth returned no access_token.');
  return body.access_token;
}

export type PayPalFetchInit = RequestInit & {
  token: string;
  /** When set (Orders create/capture), sent as PayPal-Request-Id and
   *  reused on the automatic 429 retry so PayPal treats it as one call. */
  paypalRequestId?: string;
};

/** Authenticated call against the PayPal REST API. */
export async function paypalFetch(path: string, init: PayPalFetchInit): Promise<Response> {
  const { token, paypalRequestId, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const requestId =
    paypalRequestId ??
    (method === 'POST' || method === 'PUT' || method === 'PATCH' ? crypto.randomUUID() : undefined);

  const headers = new Headers(rest.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (requestId) headers.set('PayPal-Request-Id', requestId);

  const send = () =>
    fetch(`${PAYPAL_API_BASE}${path}`, {
      ...rest,
      headers,
    });

  return await sendOnceThenRetry429(`${method} ${path}`, send);
}

/**
 * Verify a webhook actually came from PayPal.
 *
 * This is the load-bearing check in the whole feature. The webhook
 * endpoint is public and unauthenticated — it has to be, PayPal has no
 * Supabase JWT — so without this anyone who learns the URL can POST a
 * fake PAYMENT.CAPTURE.COMPLETED and unlock any set for free.
 *
 * `webhookEvent` must already be parsed JSON (the caller parses once).
 * Returns true only on a literal "SUCCESS" verification_status. A
 * rejected signature returns false. Network / API / config failures
 * throw so the caller can 503 and let PayPal retry.
 */
export async function verifyWebhookSignature(
  headers: Headers,
  webhookEvent: unknown,
  token: string
): Promise<boolean> {
  const webhookId = requireEnv('PAYPAL_WEBHOOK_ID');

  // PayPal sends these unprefixed and lowercase; Headers.get is
  // case-insensitive, so read them by their documented names.
  const transmissionId = headers.get('paypal-transmission-id');
  const transmissionTime = headers.get('paypal-transmission-time');
  const transmissionSig = headers.get('paypal-transmission-sig');
  const certUrl = headers.get('paypal-cert-url');
  const authAlgo = headers.get('paypal-auth-algo');

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    console.error('Webhook rejected: missing PayPal signature headers.');
    return false;
  }

  const res = await paypalFetch('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    token,
    body: JSON.stringify({
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      transmission_sig: transmissionSig,
      cert_url: certUrl,
      auth_algo: authAlgo,
      webhook_id: webhookId,
      // Must be the parsed event, not the raw string — PayPal's verifier
      // re-serialises it on their side.
      webhook_event: webhookEvent,
    }),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const text = await res.text();
    logPayPalFailure('verify-webhook-signature', res, text);
    throw new PayPalRateLimitError(retryAfter, paypalDebugId(res.headers));
  }

  if (!res.ok) {
    const text = await res.text();
    logPayPalFailure('verify-webhook-signature', res, text);
    throw new Error(`Webhook verification call failed (${res.status})`);
  }

  const body = (await res.json()) as { verification_status?: string };
  return body.verification_status === 'SUCCESS';
}

export function isInstrumentDeclined(body: unknown): boolean {
  return paypalIssue(body, INSTRUMENT_DECLINED);
}

/**
 * custom_id carries (user, set) through PayPal and back to the webhook,
 * so the webhook never has to trust the browser for either.
 * PayPal caps custom_id at 127 characters; a uuid + ':' + a set id fits.
 */
export function encodeCustomId(userId: string, setId: string): string {
  return `${userId}:${setId}`;
}

export function decodeCustomId(customId: string | null | undefined): {
  userId: string;
  setId: string;
} | null {
  if (!customId) return null;
  const separator = customId.indexOf(':');
  if (separator <= 0) return null;

  const userId = customId.slice(0, separator);
  const setId = customId.slice(separator + 1);
  if (!userId || !setId) return null;

  return { userId, setId };
}
