import { useEffect, useRef, useState } from 'react';

import { paypalConfig } from '../config/paypal.js';
import { fetchOwned } from '../lib/api.js';
import { alreadyOwnsSet } from '../lib/owned.js';
import {
  CAPTURE_CONFIRM_TIMEOUT_MS,
  confirmCapturedPurchase,
  createPayPalCheckoutSession,
  orderIdFromCreateResponse,
} from '../lib/paypal-checkout.js';
import { invokeCreateOrderWithOneRetryAfter, invokeWithOneRetryAfter, messageFromCheckoutError } from '../lib/paypal-retry.js';
import { loadPayPalSdk } from '../lib/paypal-sdk.js';
import { db } from '../lib/supabase.js';
import type { QuestionSet } from '../types.js';

interface PayPalCheckoutProps {
  set: QuestionSet;
  /** PayPal approved — close the dialog immediately, before capture. */
  onApproved: (setId: string) => void;
  onUnlocked: (setId: string) => void;
}

export function PayPalCheckout({ set, onApproved, onUnlocked }: PayPalCheckoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('Loading checkout…');
  const setRef = useRef(set);
  const onApprovedRef = useRef(onApproved);
  const onUnlockedRef = useRef(onUnlocked);
  useEffect(() => {
    setRef.current = set;
    onApprovedRef.current = onApproved;
    onUnlockedRef.current = onUnlocked;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      let paypal;
      try {
        paypal = await loadPayPalSdk();
      } catch {
        if (!cancelled) setNote('Could not load PayPal. Check your connection and try again.');
        return;
      }
      if (cancelled) return;

      let session;
      try {
        session = await createPayPalCheckoutSession({
          sdk: paypal,
          clientId: paypalConfig.PAYPAL_CLIENT_ID,
          createOrder: async () => {
            const { data, error } = await invokeCreateOrderWithOneRetryAfter(
              (body) => db().functions.invoke('create-order', { body }),
              setRef.current.id
            );
            if (error) {
              const message = await messageFromCheckoutError(error, 'Could not start checkout.');
              if (alreadyOwnsSet(message)) {
                const setId = setRef.current.id;
                onApprovedRef.current(setId);
                onUnlockedRef.current(setId);
              }
              throw new Error(message);
            }
            return { orderId: orderIdFromCreateResponse(data) };
          },
          onApprove: ({ orderId }) => {
            // Close the paywall now. Capture can hang on PayPal after the
            // webhook has already granted; the student should not sit on
            // "Confirming payment…" while the set is already unlocked.
            onApprovedRef.current(setRef.current.id);
            void (async () => {
              try {
                const result = await confirmCapturedPurchase({
                  setId: setRef.current.id,
                  capture: () =>
                    invokeWithOneRetryAfter(() =>
                      db().functions.invoke('capture-order', {
                        body: { paypal_order_id: orderId },
                        timeout: CAPTURE_CONFIRM_TIMEOUT_MS,
                      })
                    ),
                  readError: (error) =>
                    messageFromCheckoutError(
                      error,
                      `Payment went through but unlocking failed. Contact support and quote order ${orderId}.`
                    ),
                  isOwned: async () => {
                    try {
                      return (await fetchOwned()).has(setRef.current.id);
                    } catch {
                      return false;
                    }
                  },
                });
                if (result.status === 'unlocked') {
                  onUnlockedRef.current(result.setId);
                }
              } catch (err) {
                console.error('PayPal capture after approve failed:', err);
              }
            })();
          },
          onCancel: () => setNote('Checkout cancelled — nothing was charged.'),
          onError: (err) => {
            console.error('PayPal checkout error:', err);
            setNote(
              err instanceof Error && err.message
                ? err.message
                : 'Something went wrong with checkout. Nothing was charged.'
            );
          },
        });
      } catch (err) {
        if (!cancelled) {
          console.error('Could not start PayPal checkout:', err);
          setNote('Could not display checkout. Try again.');
        }
        return;
      }
      if (cancelled) return;

      if (!session.eligible) {
        setNote('PayPal is not available for this purchase.');
        return;
      }

      try {
        await session.resumeIfReturned();
      } catch (err) {
        console.error('Could not resume PayPal checkout:', err);
      }
      if (cancelled) return;

      const button = document.createElement('paypal-button');
      button.setAttribute('type', 'pay');
      button.className = 'paypal-gold';

      const onClick = () => {
        void session.start().catch((err: unknown) => {
          console.error('PayPal payment start error:', err);
          if (cancelled) return;
          setNote(
            err instanceof Error && err.message
              ? err.message
              : 'Something went wrong with checkout. Nothing was charged.'
          );
        });
      };
      button.addEventListener('click', onClick);
      cleanup = () => {
        button.removeEventListener('click', onClick);
        button.remove();
      };
      if (cancelled) {
        cleanup();
        return;
      }

      container.replaceChildren(button);
      setNote('');
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [set.id]);

  return (
    <>
      <div ref={containerRef} />
      <p className="dialog-foot">{note}</p>
    </>
  );
}
