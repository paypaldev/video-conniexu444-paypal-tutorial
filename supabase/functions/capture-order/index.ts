// ---------------------------------------------------------------------
//  POST /capture-order   { paypal_order_id }  ->  { unlocked, set_id }
//
//  Captures an approved PayPal order and grants the entitlement. This is
//  what makes unlocking feel instant — the webhook is the backstop for
//  when the browser never makes it back here.
//
//  Both paths call grant_entitlement(), which is idempotent, so whichever
//  arrives second is a no-op rather than a double grant.
//
//  Deploy with JWT verification ON (the default):
//    supabase functions deploy capture-order
// ---------------------------------------------------------------------

import {
  getAccessToken,
  isInstrumentDeclined,
  isJsonObject,
  isPayPalRateLimitError,
  logPayPalFailure,
  paypalIssue,
  paypalFetch,
  retryAfterHeaders,
} from '../_shared/paypal.ts';
import { getCallerId, json, preflight, serviceClient } from '../_shared/http.ts';

interface CaptureBody {
  paypal_order_id?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') return preflight(origin);
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

  const userId = await getCallerId(req);
  if (!userId) return json({ error: 'You must be signed in.' }, 401, origin);

  let body: CaptureBody;
  try {
    body = (await req.json()) as CaptureBody;
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400, origin);
  }

  const orderId = typeof body.paypal_order_id === 'string' ? body.paypal_order_id.trim() : '';
  if (!orderId) return json({ error: 'paypal_order_id is required.' }, 400, origin);

  const db = serviceClient();

  // ---- the order must be one WE created, for THIS user ---------------
  // Without this check a student could pass someone else's order id and
  // claim the entitlement from a payment they did not make.
  const { data: order, error: orderError } = await db
    .from('orders')
    .select('paypal_order_id, user_id, set_id, status')
    .eq('paypal_order_id', orderId)
    .maybeSingle();

  if (orderError) {
    console.error('Order lookup failed:', orderError.message);
    return json({ error: 'Could not verify that order.' }, 500, origin);
  }
  if (!order) return json({ error: 'Unknown order.' }, 404, origin);
  if (order.user_id !== userId) {
    console.warn(`User ${userId} tried to capture order ${orderId} belonging to ${order.user_id}.`);
    return json({ error: 'That order is not yours.' }, 403, origin);
  }

  // Already settled by the webhook — report success rather than
  // capturing twice.
  if (order.status === 'captured') {
    return json({ unlocked: true, set_id: order.set_id, already: true }, 200, origin);
  }

  // ---- capture -------------------------------------------------------
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

  // Unique per capture invocation; reused on the automatic 429 retry
  // inside paypalFetch. A browser 429 retry of capture-order mints a
  // new id — that is fine: PayPal returns ORDER_ALREADY_CAPTURED and
  // grant_entitlement is idempotent. Create-order is the one that must
  // reuse a client request_id so we do not orphan a second order.
  const paypalRequestId = crypto.randomUUID();
  const res = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    token,
    paypalRequestId,
    body: '{}',
  });

  if (res.status === 429) {
    // Do not mark the order failed — PayPal did not decline the instrument.
    const retryAfter = res.headers.get('Retry-After');
    logPayPalFailure('capture', res, await res.text());
    return json(
      { error: 'PayPal is busy. Try again shortly.' },
      429,
      origin,
      retryAfterHeaders(retryAfter)
    );
  }

  const raw = await res.text();
  let captureBody: unknown = null;
  try {
    captureBody = raw ? JSON.parse(raw) : null;
  } catch {
    captureBody = null;
  }

  if (!res.ok) {
    // ORDER_ALREADY_CAPTURED means the webhook beat us here. That is a
    // success from the student's point of view, not an error.
    if (paypalIssue(captureBody, 'ORDER_ALREADY_CAPTURED')) {
      // Fall through to grant_entitlement, which is idempotent.
    } else if (isInstrumentDeclined(captureBody)) {
      // Server-only: do not auto-retry the same instrument. The browser
      // has no dedicated restart UX on purpose.
      logPayPalFailure('capture', res, captureBody ?? raw);
      await db
        .from('orders')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('paypal_order_id', orderId);
      return json(
        { error: 'That payment method was declined. Choose a different way to pay.' },
        422,
        origin
      );
    } else {
      logPayPalFailure('capture', res, captureBody ?? raw);
      await db
        .from('orders')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('paypal_order_id', orderId);
      return json({ error: 'Payment could not be completed.' }, 502, origin);
    }
  } else {
    const status = isJsonObject(captureBody) && typeof captureBody.status === 'string'
      ? captureBody.status
      : undefined;
    if (status !== 'COMPLETED') {
      // PENDING, DECLINED, anything else — do not grant access.
      logPayPalFailure('capture', res, captureBody ?? raw);
      return json({ error: 'Payment is not complete yet.', status }, 409, origin);
    }
  }

  // ---- grant ---------------------------------------------------------
  const { data: granted, error: grantError } = await db.rpc('grant_entitlement', {
    p_user_id: order.user_id,
    p_set_id: order.set_id,
    p_order_ref: orderId,
  });

  if (grantError) {
    // The money moved but the grant did not. Loud, because this is the
    // one failure that needs a human — the webhook will retry it, but if
    // it does not, this log is the only record.
    console.error(`PAID BUT NOT GRANTED — order ${orderId}, user ${order.user_id}:`, grantError.message);
    return json({ error: 'Payment succeeded but unlocking failed. Contact support.' }, 500, origin);
  }

  return json({ unlocked: true, set_id: order.set_id, already: granted === false }, 200, origin);
});
