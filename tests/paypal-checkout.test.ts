// ---------------------------------------------------------------------
//  PayPal JavaScript SDK v6 checkout wiring.
//
//  The hosted v6 script cannot run here, and we do not have PayPal
//  credentials in CI, so these tests pin the contract the browser code
//  must keep: load /web-sdk/v6/core, createInstance, return { orderId }
//  from createOrder, and capture from onApprove.orderId. A regression
//  back to classic sdk/js Buttons would be silent in the UI.
// ---------------------------------------------------------------------

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { paypalConfig } from '../src/config/paypal.js';
import {
  confirmCapturedPurchase,
  createPayPalCheckoutSession,
  detachApprove,
  orderIdFromCreateResponse,
  PAYPAL_V6_COMPONENTS,
  toV6CreateOrderResult,
} from '../src/lib/paypal-checkout.js';
import {
  loadPayPalSdk,
  paypalV6CoreUrl,
  resetPayPalSdkCache,
  type PayPalPaymentSessionOptions,
  type PayPalSdkHost,
  type PayPalSdkInstance,
  type PayPalScriptElement,
  type PayPalV6CreateInstanceOptions,
  type PayPalV6Namespace,
} from '../src/lib/paypal-sdk.js';

afterEach(() => {
  resetPayPalSdkCache();
});

function fakeHost(paypal?: PayPalV6Namespace): {
  host: PayPalSdkHost;
  scripts: PayPalScriptElement[];
  setPaypal: (next: PayPalV6Namespace | undefined) => void;
} {
  let current = paypal;
  const scripts: PayPalScriptElement[] = [];
  const host: PayPalSdkHost = {
    getPaypal: () => current,
    createScript: () => ({
      src: '',
      async: false,
      onload: null,
      onerror: null,
    }),
    appendScript: (script) => {
      scripts.push(script);
    },
  };
  return {
    host,
    scripts,
    setPaypal: (next) => {
      current = next;
    },
  };
}

function mockSdk(options?: { eligible?: boolean; hasReturned?: boolean; paypalOnly?: boolean }) {
  const calls: {
    createInstance?: PayPalV6CreateInstanceOptions;
    eligibility?: { currencyCode?: string };
    startOptions?: { presentationMode?: string };
    order?: { orderId: string };
    sessionOptions?: PayPalPaymentSessionOptions;
    eligibilityChecks: string[];
    resumed: boolean;
  } = { eligibilityChecks: [], resumed: false };

  const instance: PayPalSdkInstance = {
    findEligibleMethods: async (opts) => {
      calls.eligibility = opts;
      return {
        isEligible: (method: string) => {
          calls.eligibilityChecks.push(method);
          if (method === 'paypal') return options?.eligible ?? true;
          return options?.paypalOnly === false;
        },
      };
    },
    createPayPalOneTimePaymentSession: (sessionOptions) => {
      calls.sessionOptions = sessionOptions;
      return {
        start: async (startOptions, orderPromise) => {
          calls.startOptions = startOptions;
          calls.order = await orderPromise;
        },
        hasReturned: () => options?.hasReturned ?? false,
        resume: async () => {
          calls.resumed = true;
        },
      };
    },
  };

  const sdk: PayPalV6Namespace = {
    createInstance: async (opts) => {
      calls.createInstance = opts;
      return instance;
    },
  };

  return { sdk, calls };
}

describe('paypalV6CoreUrl', () => {
  it('loads the v6 core script, not classic sdk/js', () => {
    assert.equal(paypalV6CoreUrl('sandbox'), 'https://www.sandbox.paypal.com/web-sdk/v6/core');
    assert.equal(paypalV6CoreUrl('live'), 'https://www.paypal.com/web-sdk/v6/core');
    assert.ok(!paypalV6CoreUrl(paypalConfig.PAYPAL_ENV).includes('/sdk/js'));
  });
});

describe('loadPayPalSdk', () => {
  it('injects the v6 core script and resolves createInstance', async () => {
    const { host, scripts, setPaypal } = fakeHost();
    const pending = loadPayPalSdk(host);

    assert.equal(scripts.length, 1);
    assert.equal(scripts[0]!.src, paypalV6CoreUrl(paypalConfig.PAYPAL_ENV));
    assert.equal(scripts[0]!.async, true);

    const namespace: PayPalV6Namespace = {
      createInstance: async () => {
        throw new Error('not used');
      },
    };
    setPaypal(namespace);
    scripts[0]!.onload?.call(scripts[0]!);

    assert.equal(await pending, namespace);
  });

  it('reuses the in-flight load so the paywall does not add a second script', () => {
    const { host, scripts } = fakeHost();
    const first = loadPayPalSdk(host);
    const second = loadPayPalSdk(host);
    assert.equal(first, second);
    assert.equal(scripts.length, 1);
  });

  it('does not cache a failed load', async () => {
    const first = fakeHost();
    const failed = loadPayPalSdk(first.host);
    first.scripts[0]!.onerror?.call(first.scripts[0]!);
    await assert.rejects(failed, /Could not reach PayPal/);

    const second = fakeHost();
    const retried = loadPayPalSdk(second.host);
    assert.equal(second.scripts.length, 1);
    second.scripts[0]!.onerror?.call(second.scripts[0]!);
    await assert.rejects(retried, /Could not reach PayPal/);
  });
});

describe('orderIdFromCreateResponse', () => {
  it('reads the Orders v2 id the Edge Function already returns', () => {
    assert.equal(orderIdFromCreateResponse({ id: '5O190127TN364715T' }), '5O190127TN364715T');
  });

  it('refuses a missing or empty id', () => {
    assert.throws(() => orderIdFromCreateResponse({}), /did not return an order/);
    assert.throws(() => orderIdFromCreateResponse(null), /did not return an order/);
    assert.throws(() => orderIdFromCreateResponse({ id: '' }), /did not return an order/);
  });
});

describe('toV6CreateOrderResult', () => {
  it('wraps the order id in the object v6 start() requires', () => {
    assert.deepEqual(toV6CreateOrderResult('ORDER-1'), { orderId: 'ORDER-1' });
  });
});

describe('createPayPalCheckoutSession', () => {
  it('creates a one-time PayPal session with the public client id', async () => {
    const { sdk, calls } = mockSdk();
    await createPayPalCheckoutSession({
      sdk,
      clientId: 'test-client-id',
      createOrder: async () => ({ orderId: 'ORDER-1' }),
      onApprove: async () => undefined,
    });

    assert.deepEqual(calls.createInstance, {
      clientId: 'test-client-id',
      components: [...PAYPAL_V6_COMPONENTS],
      pageType: 'checkout',
    });
    assert.deepEqual(calls.eligibility, { currencyCode: 'USD' });
    assert.deepEqual(calls.eligibilityChecks, ['paypal']);
  });

  it('does not create the order until start() — v6 wants the promise, not the function', async () => {
    const { sdk, calls } = mockSdk();
    let created = 0;
    const session = await createPayPalCheckoutSession({
      sdk,
      clientId: 'test-client-id',
      createOrder: async () => {
        created += 1;
        return { orderId: 'ORDER-1' };
      },
      onApprove: async () => undefined,
    });

    assert.equal(created, 0);
    await session.start();
    assert.equal(created, 1);
    assert.deepEqual(calls.startOptions, { presentationMode: 'auto' });
    assert.deepEqual(calls.order, { orderId: 'ORDER-1' });
  });

  it('captures from onApprove.orderId, not the classic orderID field', async () => {
    const { sdk, calls } = mockSdk();
    const captured: string[] = [];
    await createPayPalCheckoutSession({
      sdk,
      clientId: 'test-client-id',
      createOrder: async () => ({ orderId: 'ORDER-1' }),
      onApprove: async ({ orderId }) => {
        captured.push(orderId);
      },
    });

    await calls.sessionOptions!.onApprove({ orderId: 'ORDER-1' });
    await Promise.resolve();
    assert.deepEqual(captured, ['ORDER-1']);
  });

  it('reports when PayPal itself is not eligible', async () => {
    const { sdk } = mockSdk({ eligible: false });
    const session = await createPayPalCheckoutSession({
      sdk,
      clientId: 'test-client-id',
      createOrder: async () => ({ orderId: 'ORDER-1' }),
      onApprove: async () => undefined,
    });
    assert.equal(session.eligible, false);
  });

  it('resumes a redirect return and otherwise leaves the session alone', async () => {
    const returned = mockSdk({ hasReturned: true });
    const returning = await createPayPalCheckoutSession({
      sdk: returned.sdk,
      clientId: 'test-client-id',
      createOrder: async () => ({ orderId: 'ORDER-1' }),
      onApprove: async () => undefined,
    });
    await returning.resumeIfReturned();
    assert.equal(returned.calls.resumed, true);

    const fresh = mockSdk({ hasReturned: false });
    const next = await createPayPalCheckoutSession({
      sdk: fresh.sdk,
      clientId: 'test-client-id',
      createOrder: async () => ({ orderId: 'ORDER-1' }),
      onApprove: async () => undefined,
    });
    await next.resumeIfReturned();
    assert.equal(fresh.calls.resumed, false);
  });

  it('does not hand PayPal a promise that waits on capture', async () => {
    let finished = false;
    const wrapped = detachApprove(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      finished = true;
    });
    const returned = wrapped({ orderId: 'ORDER-1' });
    assert.equal(returned, undefined);
    assert.equal(finished, false);
  });
});

describe('confirmCapturedPurchase', () => {
  it('unlocks from a successful capture without waiting on ownership', async () => {
    const result = await confirmCapturedPurchase({
      setId: 'algebra',
      capture: async () => ({ data: { unlocked: true, set_id: 'algebra' }, error: null }),
      readError: async () => 'unused',
      isOwned: async () => false,
      timeoutMs: 50,
      pollMs: 10,
    });
    assert.deepEqual(result, { status: 'unlocked', setId: 'algebra' });
  });

  it('unlocks when the webhook grants even if capture never returns', async () => {
    let owned = false;
    const timer = setTimeout(() => {
      owned = true;
    }, 20);
    try {
      const result = await confirmCapturedPurchase({
        setId: 'advanced-math',
        capture: () => new Promise(() => undefined),
        readError: async () => 'unused',
        isOwned: async () => owned,
        timeoutMs: 200,
        pollMs: 10,
      });
      assert.deepEqual(result, { status: 'unlocked', setId: 'advanced-math' });
    } finally {
      clearTimeout(timer);
    }
  });

  it('unlocks from ownership when capture reports a failure', async () => {
    const result = await confirmCapturedPurchase({
      setId: 'algebra',
      capture: async () => ({ data: null, error: { message: 'timeout' } }),
      readError: async () => 'Payment went through but unlocking failed.',
      isOwned: async () => true,
      timeoutMs: 50,
      pollMs: 10,
    });
    assert.deepEqual(result, { status: 'unlocked', setId: 'algebra' });
  });

  it('surfaces a capture error when the set is still locked', async () => {
    const result = await confirmCapturedPurchase({
      setId: 'algebra',
      capture: async () => ({ data: null, error: { message: 'Unknown order.' } }),
      readError: async () => 'Unknown order.',
      isOwned: async () => false,
      timeoutMs: 50,
      pollMs: 10,
    });
    assert.deepEqual(result, { status: 'failed', message: 'Unknown order.' });
  });

  it('asks the student to refresh when neither path confirms in time', async () => {
    const result = await confirmCapturedPurchase({
      setId: 'algebra',
      capture: () => new Promise(() => undefined),
      readError: async () => 'unused',
      isOwned: async () => false,
      timeoutMs: 30,
      pollMs: 10,
    });
    assert.equal(result.status, 'pending');
  });

  it('does not hang when both capture and ownership never return', async () => {
    const result = await confirmCapturedPurchase({
      setId: 'algebra',
      capture: () => new Promise(() => undefined),
      readError: async () => 'unused',
      isOwned: () => new Promise(() => undefined),
      timeoutMs: 40,
      pollMs: 10,
    });
    assert.equal(result.status, 'pending');
  });
});
