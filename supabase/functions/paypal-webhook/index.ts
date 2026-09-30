// ---------------------------------------------------------------------
//  POST /paypal-webhook   <- PayPal, not the browser
//
//  The backstop. If a student closes the tab between approving and
//  capturing, this is what still unlocks their set. It also handles
//  refunds and chargebacks, which only ever arrive this way.
//
//  MUST be deployed with JWT verification OFF — PayPal has no Supabase
//  token to send:
//
//    supabase functions deploy paypal-webhook --no-verify-jwt
//
//  That makes the endpoint publicly callable, so the signature check
//  below is the entire security boundary. Anyone who learns this URL can
//  POST to it; only PayPal can produce a payload that verifies.
// ---------------------------------------------------------------------

import {
  decodeCustomId,
  getAccessToken,
  isJsonObject,
  isPayPalRateLimitError,
  retryAfterHeaders,
  verifyWebhookSignature,
} from '../_shared/paypal.ts';
import { serviceClient } from '../_shared/http.ts';

/** Shape of the bits of a PayPal webhook event we actually read. */
interface PayPalEvent {
  event_type?: string;
  resource?: {
    custom_id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
}

/** No CORS headers here on purpose — this endpoint is not for browsers. */
function reply(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);

  const rawBody = await req.text();

  // Parse once. Malformed JSON used to throw inside signature verify
  // and come back as 503; that is the wrong signal — PayPal should not
  // retry a body we will never accept.
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return reply({ error: 'Malformed event.' }, 400);
  }
  if (!isJsonObject(event)) {
    return reply({ error: 'Malformed event.' }, 400);
  }

  // ---- prove it came from PayPal -------------------------------------
  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    // Cannot verify without a token. 429 if PayPal rate-limited OAuth;
    // 503 for missing secrets / other outages so PayPal retries.
    if (isPayPalRateLimitError(err)) {
      return reply(
        { error: 'Verification unavailable.' },
        429,
        retryAfterHeaders(err.retryAfter)
      );
    }
    console.error('PayPal auth failed during webhook verification:', err);
    return reply({ error: 'Verification unavailable.' }, 503);
  }

  // A missing PAYPAL_WEBHOOK_ID throws in here. Catching it keeps an
  // unconfigured deployment from answering with an opaque 500 — the
  // event is still discarded either way, which is the safe outcome.
  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(req.headers, event, token);
  } catch (err) {
    if (isPayPalRateLimitError(err)) {
      return reply(
        { error: 'Verification unavailable.' },
        429,
        retryAfterHeaders(err.retryAfter)
      );
    }
    console.error('Webhook verification could not run:', err);
    return reply({ error: 'Webhook verification is not configured.' }, 503);
  }

  if (!verified) {
    console.error('Webhook signature verification FAILED — event discarded.');
    return reply({ error: 'Invalid signature.' }, 401);
  }

  // Parsed above; safe to read only after the signature check.
  const paypalEvent = event as PayPalEvent;
  const eventType = paypalEvent.event_type ?? '';
  const resource = paypalEvent.resource ?? {};
  const orderId = resource.supplementary_data?.related_ids?.order_id ?? null;
  const identity = decodeCustomId(resource.custom_id);

  const db = serviceClient();

  switch (eventType) {
    case 'PAYMENT.CAPTURE.COMPLETED': {
      // Two ways to resolve who this payment belongs to. custom_id is
      // authoritative because PayPal echoes back exactly what we set at
      // order creation; the orders table is the fallback for events that
      // omit it.
      let userId = identity?.userId ?? null;
      let setId = identity?.setId ?? null;

      if ((!userId || !setId) && orderId) {
        const { data: order } = await db
          .from('orders')
          .select('user_id, set_id')
          .eq('paypal_order_id', orderId)
          .maybeSingle();
        userId = order?.user_id ?? null;
        setId = order?.set_id ?? null;
      }

      if (!userId || !setId || !orderId) {
        // Nothing actionable. 200 so PayPal stops retrying an event we
        // will never be able to resolve.
        console.error(
          `Unresolvable capture event. order=${orderId} custom_id=${resource.custom_id ?? 'none'}`
        );
        return reply({ ok: true, ignored: 'unresolvable' }, 200);
      }

      const { data: granted, error } = await db.rpc('grant_entitlement', {
        p_user_id: userId,
        p_set_id: setId,
        p_order_ref: orderId,
      });

      if (error) {
        // 5xx so PayPal redelivers — grant_entitlement is idempotent, so
        // a retry cannot double-grant.
        console.error(`Grant failed for order ${orderId}:`, error.message);
        return reply({ error: 'Grant failed.' }, 500);
      }

      console.log(`Order ${orderId}: ${granted ? 'granted' : 'already owned'} ${setId} to ${userId}.`);
      return reply({ ok: true, granted }, 200);
    }

    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED': {
      let ref = orderId;

      // Refund events often omit related_ids.order_id. Fall back to the
      // ledger via custom_id.
      if (!ref && identity) {
        const { data: order } = await db
          .from('orders')
          .select('paypal_order_id')
          .eq('user_id', identity.userId)
          .eq('set_id', identity.setId)
          .eq('status', 'captured')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        ref = order?.paypal_order_id ?? null;
      }

      if (!ref) {
        console.error(`Unresolvable refund event: ${eventType}`);
        return reply({ ok: true, ignored: 'unresolvable' }, 200);
      }

      const { data: removed, error } = await db.rpc('revoke_entitlement', { p_order_ref: ref });

      if (error) {
        console.error(`Revoke failed for order ${ref}:`, error.message);
        return reply({ error: 'Revoke failed.' }, 500);
      }

      console.log(`Order ${ref}: access ${removed ? 'revoked' : 'already absent'} after ${eventType}.`);
      return reply({ ok: true, revoked: removed }, 200);
    }

    default:
      // Subscribed to more than we handle, or PayPal added an event type.
      // 200 keeps it out of the retry queue.
      return reply({ ok: true, ignored: eventType }, 200);
  }
});
