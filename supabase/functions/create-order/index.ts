// ---------------------------------------------------------------------
//  POST /create-order   { set_id, request_id? }  ->  { id: string }
//
//  Creates a PayPal order for one question set and records it in the
//  orders ledger. Returns the PayPal order id for the browser to hand to
//  the v6 SDK as { orderId }. Still Orders v2 REST — v6 did not change that.
//
//  Deploy with JWT verification ON (the default):
//    supabase functions deploy create-order
// ---------------------------------------------------------------------

import {
  encodeCustomId,
  getAccessToken,
  isPayPalRateLimitError,
  logPayPalFailure,
  parseClientRequestId,
  paypalFetch,
  retryAfterHeaders,
  scopedPaypalRequestId,
} from '../_shared/paypal.ts';
import { getCallerId, json, preflight, serviceClient } from '../_shared/http.ts';

interface CreateOrderBody {
  set_id?: unknown;
  /** Client idempotency key for this checkout click. Not identity. */
  request_id?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') return preflight(origin);
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

  // ---- who is asking -------------------------------------------------
  // From the JWT, never from the body.
  const userId = await getCallerId(req);
  if (!userId) return json({ error: 'You must be signed in to buy a set.' }, 401, origin);

  // ---- what they asked for -------------------------------------------
  let body: CreateOrderBody;
  try {
    body = (await req.json()) as CreateOrderBody;
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400, origin);
  }

  const setId = typeof body.set_id === 'string' ? body.set_id.trim() : '';
  if (!setId) return json({ error: 'set_id is required.' }, 400, origin);
  const clientRequestId = parseClientRequestId(body.request_id);

  const db = serviceClient();

  // ---- price comes from the database, full stop ----------------------
  // The browser sends a set id and an optional request_id. request_id is
  // only an idempotency key for this click's 429 retry. If the amount
  // came from the request body, a student would edit it to 1 cent in
  // devtools and buy every set for a penny.
  const { data: set, error: setError } = await db
    .from('question_sets')
    .select('id, title, is_free, price_cents')
    .eq('id', setId)
    .maybeSingle();

  if (setError) {
    console.error('Set lookup failed:', setError.message);
    return json({ error: 'Could not load that set.' }, 500, origin);
  }
  if (!set) return json({ error: 'No such set.' }, 404, origin);
  if (set.is_free) return json({ error: 'That set is already free.' }, 400, origin);
  if (!set.price_cents || set.price_cents <= 0) {
    return json({ error: 'That set has no price set.' }, 409, origin);
  }

  // ---- do not sell what they already own -----------------------------
  const { data: owned, error: ownedError } = await db
    .from('entitlements')
    .select('set_id')
    .eq('user_id', userId)
    .eq('set_id', setId)
    .maybeSingle();

  if (ownedError) {
    console.error('Entitlement check failed:', ownedError.message);
    return json({ error: 'Could not verify your access.' }, 500, origin);
  }
  if (owned) return json({ error: 'You already own this set.' }, 409, origin);

  // ---- create the PayPal order ---------------------------------------
  const currency = 'USD';
  const amount = (set.price_cents / 100).toFixed(2);

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    if (isPayPalRateLimitError(err)) {
      return json(
        { error: 'PayPal is busy. Try again shortly.' },
        429,
        origin,
        retryAfterHeaders(err.retryAfter)
      );
    }
    console.error('PayPal auth failed:', err);
    return json({ error: 'Payments are temporarily unavailable.' }, 502, origin);
  }

  // Same PayPal-Request-Id on the browser's one 429 retry of this click.
  // Folded with the JWT user so a borrowed UUID cannot collide with
  // another student's create. Missing/junk request_id → a fresh UUID.
  const paypalRequestId = clientRequestId
    ? await scopedPaypalRequestId(userId, clientRequestId)
    : crypto.randomUUID();
  const res = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    token,
    paypalRequestId,
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          // Carries (user, set) through PayPal so the webhook can resolve
          // the payment even if the browser never comes back.
          custom_id: encodeCustomId(userId, setId),
          description: `KatSAT — ${set.title}`.slice(0, 127),
          amount: { currency_code: currency, value: amount },
        },
      ],
      application_context: {
        brand_name: 'KatSAT',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    logPayPalFailure('create order', res, await res.text());
    return json(
      { error: 'PayPal is busy. Try again shortly.' },
      429,
      origin,
      retryAfterHeaders(retryAfter)
    );
  }

  if (!res.ok) {
    logPayPalFailure('create order', res, await res.text());
    return json({ error: 'Could not start checkout.' }, 502, origin);
  }

  const order = (await res.json()) as { id?: string };
  if (!order.id) {
    console.error(
      `PayPal create order returned no id. debug_id=${res.headers.get('paypal-debug-id') ?? 'none'}`
    );
    return json({ error: 'Could not start checkout.' }, 502, origin);
  }

  // ---- record it before handing the id to the browser ----------------
  // If this insert fails the order still exists at PayPal, so the webhook
  // can still resolve it from custom_id. Log loudly and continue.
  const { error: recordError } = await db.rpc('record_order', {
    p_paypal_order_id: order.id,
    p_user_id: userId,
    p_set_id: setId,
    p_amount_cents: set.price_cents,
    p_currency: currency,
  });

  if (recordError) {
    console.error(`Could not record order ${order.id}:`, recordError.message);
  }

  return json({ id: order.id }, 200, origin);
});
