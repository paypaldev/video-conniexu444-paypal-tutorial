// ---------------------------------------------------------------------
//  v6 one-time PayPal checkout, minus the DOM.
//
//  Classic Buttons took createOrder/onApprove inline and returned a
//  bare order-id string. v6 creates a payment session, starts it with
//  a promise of { orderId }, and captures from onApprove.data.orderId.
//  Pay Later and PayPal Credit are never mounted — a $5 question set
//  should not offer financing.
// ---------------------------------------------------------------------

import type {
  PayPalOnApproveData,
  PayPalPaymentSession,
  PayPalV6Namespace,
} from './paypal-sdk.js';

export const PAYPAL_V6_COMPONENTS = ['paypal-payments'] as const;

export function orderIdFromCreateResponse(data: unknown): string {
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('Checkout did not return an order.');
  }
  return id;
}

export function toV6CreateOrderResult(orderId: string): { orderId: string } {
  return { orderId };
}

export const CAPTURE_CONFIRM_TIMEOUT_MS = 8_000;
export const CAPTURE_CONFIRM_POLL_MS = 400;

export type CaptureConfirmResult =
  | { status: 'unlocked'; setId: string }
  | { status: 'failed'; message: string }
  | { status: 'pending'; message: string };

export interface ConfirmCapturedPurchaseInput {
  setId: string;
  capture: () => Promise<{ data: unknown; error: unknown }>;
  readError: (error: unknown) => Promise<string>;
  isOwned: () => Promise<boolean>;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Wait until either capture-order says the set is unlocked, or the
 * entitlements table does. Capture and the ownership RPC can both hang
 * (the webhook may already have granted), so every wait is raced against
 * a wall clock — the dialog must never sit on "Confirming payment…"
 * forever.
 */
export async function confirmCapturedPurchase(
  input: ConfirmCapturedPurchaseInput
): Promise<CaptureConfirmResult> {
  const timeoutMs = input.timeoutMs ?? CAPTURE_CONFIRM_TIMEOUT_MS;
  const pollMs = input.pollMs ?? CAPTURE_CONFIRM_POLL_MS;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pendingMessage = 'Payment is still processing. Refresh in a moment.';

  type CaptureOutcome = {
    unlocked: boolean;
    setId: string;
    errorMessage?: string;
  };

  let captureResult: CaptureOutcome | undefined;
  let settled!: (result: CaptureConfirmResult) => void;
  const done = new Promise<CaptureConfirmResult>((resolve) => {
    settled = resolve;
  });
  let finished = false;
  const finish = (result: CaptureConfirmResult) => {
    if (finished) return;
    finished = true;
    settled(result);
  };

  void input
    .capture()
    .then(async ({ data, error }): Promise<CaptureOutcome> => {
      if (error) {
        return {
          unlocked: false,
          setId: input.setId,
          errorMessage: await Promise.race([
            input.readError(error),
            sleep(timeoutMs).then(() => pendingMessage),
          ]),
        };
      }
      const outcome = data as { unlocked?: boolean; set_id?: string } | null;
      return {
        unlocked: outcome?.unlocked === true,
        setId: outcome?.set_id ?? input.setId,
      };
    })
    .catch((err: unknown): CaptureOutcome => ({
      unlocked: false,
      setId: input.setId,
      errorMessage: err instanceof Error && err.message ? err.message : 'Could not confirm payment.',
    }))
    .then((result) => {
      captureResult = result;
      if (result.unlocked) finish({ status: 'unlocked', setId: result.setId });
    });

  void (async () => {
    const now = input.now ?? Date.now;
    const deadline = now() + timeoutMs;
    while (!finished && now() < deadline) {
      if (captureResult?.unlocked) {
        finish({ status: 'unlocked', setId: captureResult.setId });
        return;
      }
      const remaining = Math.max(0, deadline - now());
      const owned = await Promise.race([
        input.isOwned().then((value) => value, () => false),
        sleep(Math.min(pollMs, remaining)).then(() => false),
      ]);
      if (owned) {
        finish({ status: 'unlocked', setId: input.setId });
        return;
      }
      if (finished) return;
      await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
    }
    if (finished) return;
    if (captureResult?.unlocked) {
      finish({ status: 'unlocked', setId: captureResult.setId });
      return;
    }
    if (captureResult?.errorMessage) {
      finish({ status: 'failed', message: captureResult.errorMessage });
      return;
    }
    finish({ status: 'pending', message: pendingMessage });
  })();

  void sleep(timeoutMs).then(() => {
    if (captureResult?.unlocked) {
      finish({ status: 'unlocked', setId: captureResult.setId });
      return;
    }
    finish({
      status: captureResult?.errorMessage ? 'failed' : 'pending',
      message: captureResult?.errorMessage ?? pendingMessage,
    });
  });

  return done;
}

export interface PayPalCheckoutSessionInput {
  sdk: PayPalV6Namespace;
  clientId: string;
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (data: PayPalOnApproveData) => void | Promise<void>;
  onCancel?: (data?: { orderId?: string }) => void;
  onError?: (error: unknown) => void;
}

export interface PayPalCheckoutSession {
  eligible: boolean;
  start: () => Promise<void>;
  resumeIfReturned: () => Promise<void>;
}

/**
 * Hand onApprove to v6 without returning its promise. If the session
 * waits on capture, PayPal's overlay stays up, the opener is backgrounded,
 * and timers that should unblock "Confirming payment…" never run.
 */
export function detachApprove(
  onApprove: (data: PayPalOnApproveData) => void | Promise<void>
): (data: PayPalOnApproveData) => void {
  return (data) => {
    void Promise.resolve(onApprove(data));
  };
}

/**
 * Authenticate the loaded v6 SDK, check PayPal eligibility, and return
 * a session whose start() both creates the order and opens checkout.
 *
 * createOrder is invoked at click time, not at setup time — passing the
 * function by reference is a v6 footgun the official samples warn about.
 */
export async function createPayPalCheckoutSession(
  input: PayPalCheckoutSessionInput
): Promise<PayPalCheckoutSession> {
  const instance = await input.sdk.createInstance({
    clientId: input.clientId,
    components: [...PAYPAL_V6_COMPONENTS],
    pageType: 'checkout',
  });

  const paymentMethods = await instance.findEligibleMethods({
    currencyCode: 'USD',
  });

  const session: PayPalPaymentSession = instance.createPayPalOneTimePaymentSession({
    onApprove: detachApprove(input.onApprove),
    ...(input.onCancel ? { onCancel: input.onCancel } : {}),
    ...(input.onError ? { onError: input.onError } : {}),
  });

  return {
    eligible: paymentMethods.isEligible('paypal'),
    start: () => session.start({ presentationMode: 'auto' }, input.createOrder()),
    resumeIfReturned: async () => {
      if (session.hasReturned?.()) await session.resume?.();
    },
  };
}
