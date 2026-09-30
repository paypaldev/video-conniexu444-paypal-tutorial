import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INSTRUMENT_DECLINED,
  capRetryWaitMs,
  isJsonObject,
  parseRetryAfterMs,
  parseClientRequestId,
  paypalDebugId,
  paypalIssue,
  retryWaitMs,
  scopedPaypalRequestId,
  PAYPAL_RETRY_WAIT_CAP_MS,
  PAYPAL_RETRY_WAIT_DEFAULT_MS,
} from '../supabase/functions/_shared/paypal-protocol.ts';

describe('isJsonObject', () => {
  it('accepts plain objects and rejects arrays, null, and primitives', () => {
    assert.equal(isJsonObject({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }), true);
    assert.equal(isJsonObject([]), false);
    assert.equal(isJsonObject(null), false);
    assert.equal(isJsonObject('{"event_type":"x"}'), false);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads a delay-seconds value', () => {
    assert.equal(parseRetryAfterMs('2'), 2_000);
    assert.equal(parseRetryAfterMs('0'), 0);
    assert.equal(parseRetryAfterMs('1.5'), 1_500);
  });

  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
    assert.equal(
      parseRetryAfterMs('Wed, 21 Oct 2015 07:28:02 GMT', () => now),
      2_000
    );
    assert.equal(
      parseRetryAfterMs('Wed, 21 Oct 2015 07:27:00 GMT', () => now),
      0
    );
  });

  it('returns null for missing or unusable headers', () => {
    assert.equal(parseRetryAfterMs(null), null);
    assert.equal(parseRetryAfterMs(''), null);
    assert.equal(parseRetryAfterMs('nope'), null);
  });
});

describe('retryWaitMs', () => {
  it('caps a long Retry-After so the Edge Function does not sleep most of its budget', () => {
    assert.equal(retryWaitMs('30'), PAYPAL_RETRY_WAIT_CAP_MS);
    assert.equal(capRetryWaitMs(5_000), PAYPAL_RETRY_WAIT_CAP_MS);
  });

  it('defaults when PayPal omits Retry-After', () => {
    assert.equal(retryWaitMs(null), PAYPAL_RETRY_WAIT_DEFAULT_MS);
  });
});

describe('paypalDebugId', () => {
  it('prefers the PayPal-Debug-Id header', () => {
    const headers = new Headers({ 'PayPal-Debug-Id': 'hdr-1' });
    assert.equal(paypalDebugId(headers, { debug_id: 'body-1' }), 'hdr-1');
  });

  it('falls back to the JSON body', () => {
    assert.equal(paypalDebugId(new Headers(), { debug_id: 'body-1' }), 'body-1');
    assert.equal(paypalDebugId(new Headers(), {}), null);
  });
});

describe('paypalIssue', () => {
  it('detects INSTRUMENT_DECLINED on a capture error body', () => {
    const body = {
      name: 'UNPROCESSABLE_ENTITY',
      details: [{ issue: INSTRUMENT_DECLINED }],
    };
    assert.equal(paypalIssue(body, INSTRUMENT_DECLINED), true);
    assert.equal(paypalIssue(body, 'ORDER_ALREADY_CAPTURED'), false);
    assert.equal(paypalIssue({ details: [] }, INSTRUMENT_DECLINED), false);
  });
});

describe('parseClientRequestId', () => {
  it('accepts a UUID and ignores junk', () => {
    assert.equal(parseClientRequestId('3fa85f64-5717-4562-b3fc-2c963f66afa6'), '3fa85f64-5717-4562-b3fc-2c963f66afa6');
    assert.equal(parseClientRequestId('  3FA85F64-5717-4562-B3FC-2C963F66AFA6  '), '3fa85f64-5717-4562-b3fc-2c963f66afa6');
    assert.equal(parseClientRequestId('not-a-uuid'), null);
    assert.equal(parseClientRequestId(''), null);
    assert.equal(parseClientRequestId(123), null);
    assert.equal(parseClientRequestId(undefined), null);
  });
});

describe('scopedPaypalRequestId', () => {
  it('is stable for one user and differs across users', async () => {
    const key = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const first = await scopedPaypalRequestId('user-a', key);
    const again = await scopedPaypalRequestId('user-a', key);
    const other = await scopedPaypalRequestId('user-b', key);
    assert.equal(first, again);
    assert.notEqual(first, other);
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
