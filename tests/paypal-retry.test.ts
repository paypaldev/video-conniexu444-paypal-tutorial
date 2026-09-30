import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  busyTryAgainMessage,
  checkoutErrorMessageFromStatus,
  functionsHttpStatus,
  invokeCreateOrderWithOneRetryAfter,
  invokeWithOneRetryAfter,
  messageFromCheckoutError,
  parseRetryAfterMs,
} from '../src/lib/paypal-retry.js';

function httpError(status: number, retryAfter?: string, body?: unknown): { context: Response } {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (retryAfter !== undefined) headers.set('Retry-After', retryAfter);
  return {
    context: new Response(JSON.stringify(body ?? { error: 'busy' }), { status, headers }),
  };
}

describe('parseRetryAfterMs (browser helper)', () => {
  it('reads seconds and HTTP-dates', () => {
    assert.equal(parseRetryAfterMs('3'), 3_000);
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
    assert.equal(
      parseRetryAfterMs('Wed, 21 Oct 2015 07:28:05 GMT', () => now),
      5_000
    );
  });
});

describe('busyTryAgainMessage', () => {
  it('rounds up to whole seconds', () => {
    assert.equal(busyTryAgainMessage(1), 'PayPal is busy. Try again in 1 second.');
    assert.equal(busyTryAgainMessage(2_400), 'PayPal is busy. Try again in 3 seconds.');
    assert.equal(busyTryAgainMessage(null), 'PayPal is busy. Try again in a few seconds.');
  });
});

describe('checkoutErrorMessageFromStatus', () => {
  it('only special-cases 429 — not INSTRUMENT_DECLINED 422', () => {
    const busy = httpError(429, '4');
    assert.equal(functionsHttpStatus(busy), 429);
    assert.equal(
      checkoutErrorMessageFromStatus(busy),
      'PayPal is busy. Try again in 4 seconds.'
    );

    const declined = httpError(422, undefined, {
      error: 'That payment method was declined. Choose a different way to pay.',
    });
    assert.equal(checkoutErrorMessageFromStatus(declined), null);
  });
});

describe('invokeWithOneRetryAfter', () => {
  it('retries once on 429, honoring Retry-After, then returns the second result', async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await invokeWithOneRetryAfter(
      async () => {
        calls += 1;
        if (calls === 1) return { data: null, error: httpError(429, '2') };
        return { data: { id: 'ORDER-1' }, error: null };
      },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        capMs: 3_000,
      }
    );

    assert.equal(calls, 2);
    assert.deepEqual(waits, [2_000]);
    assert.deepEqual(result, { data: { id: 'ORDER-1' }, error: null });
  });

  it('does not retry a 422', async () => {
    let calls = 0;
    const declined = httpError(422);
    const result = await invokeWithOneRetryAfter(async () => {
      calls += 1;
      return { data: null, error: declined };
    });
    assert.equal(calls, 1);
    assert.equal(result.error, declined);
  });

  it('caps a long Retry-After', async () => {
    const waits: number[] = [];
    await invokeWithOneRetryAfter(
      async () => ({ data: null, error: httpError(429, '30') }),
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        capMs: 3_000,
      }
    );
    assert.deepEqual(waits, [3_000]);
  });
});

describe('invokeCreateOrderWithOneRetryAfter', () => {
  it('sends the same request_id on the 429 retry', async () => {
    const bodies: { set_id: string; request_id: string }[] = [];
    const result = await invokeCreateOrderWithOneRetryAfter(
      async (body) => {
        bodies.push(body);
        if (bodies.length === 1) return { data: null, error: httpError(429, '1') };
        return { data: { id: 'ORDER-1' }, error: null };
      },
      'algebra',
      { sleep: async () => undefined, requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
    );

    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0], {
      set_id: 'algebra',
      request_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
    assert.deepEqual(bodies[1], bodies[0]);
    assert.deepEqual(result, { data: { id: 'ORDER-1' }, error: null });
  });
});

describe('messageFromCheckoutError', () => {
  it('prefers the Retry-After sentence on 429 and the JSON error otherwise', async () => {
    assert.equal(
      await messageFromCheckoutError(httpError(429, '2'), 'fallback'),
      'PayPal is busy. Try again in 2 seconds.'
    );
    assert.equal(
      await messageFromCheckoutError(
        httpError(422, undefined, {
          error: 'That payment method was declined. Choose a different way to pay.',
        }),
        'fallback'
      ),
      'That payment method was declined. Choose a different way to pay.'
    );
  });
});
