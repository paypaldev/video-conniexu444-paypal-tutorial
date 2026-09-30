import { useCallback, useEffect, useRef } from 'react';

import { PAYMENTS_ENABLED } from '../config/paypal.js';
import { useModalDialog } from '../hooks/useModalDialog.js';
import { useApp } from '../state/AppContext.js';
import { PayPalCheckout } from './PayPalCheckout.js';
import { priceLabel } from './SetList.js';
import type { QuestionSet } from '../types.js';

/** question_count is denormalised onto question_sets by a trigger, because
 *  RLS hides the rows themselves from anyone who has not unlocked the set
 *  — the browser cannot count what it cannot read. */
function questionCountLabel(set: QuestionSet): string {
  const n = set.question_count;
  return n
    ? `${n} questions, each with a worked explanation`
    : 'Every question comes with a worked explanation';
}

export function PaywallDialog({ onUnlocked }: { onUnlocked: (set: QuestionSet) => void }) {
  const { paywallSet, closePaywall, refreshAccess, refreshProgress, noteOwned, isLocked } =
    useApp();

  const handleClose = useCallback(() => closePaywall(), [closePaywall]);
  const ref = useModalDialog(paywallSet !== null, handleClose);
  const purchasingRef = useRef<QuestionSet | null>(null);
  const dismissedRef = useRef(false);
  if (paywallSet) purchasingRef.current = paywallSet;

  const dismissPaywall = useCallback(
    (setId: string) => {
      const purchased = purchasingRef.current;
      if (!purchased) return;
      // Close first so a later noteOwned render cannot keep the dialog
      // mounted on "Confirming payment…" while the card already says Unlocked.
      closePaywall();
      noteOwned(setId || purchased.id);
      void Promise.all([refreshAccess(), refreshProgress()]);
    },
    [noteOwned, closePaywall, refreshAccess, refreshProgress]
  );

  const openPurchased = useCallback(
    (setId?: string) => {
      const purchased = purchasingRef.current;
      if (!purchased) return;
      noteOwned(setId || purchased.id);
      onUnlocked(purchased);
    },
    [noteOwned, onUnlocked]
  );

  useEffect(() => {
    if (!paywallSet) {
      dismissedRef.current = false;
      return;
    }
    if (isLocked(paywallSet) || dismissedRef.current) return;
    dismissedRef.current = true;
    dismissPaywall(paywallSet.id);
    openPurchased();
  }, [paywallSet, isLocked, dismissPaywall, openPurchased]);

  return (
    <dialog ref={ref} className="dialog">
      {paywallSet && (
        <div className="dialog-body">
          <h2>Unlock {paywallSet.title}</h2>
          <p className="dialog-sub">{paywallSet.description ?? ''}</p>

          <ul className="perk-list">
            <li>{questionCountLabel(paywallSet)}</li>
            <li>Yours permanently — no subscription</li>
            <li>Progress tracked across every set you own</li>
          </ul>

          <p className="price">{priceLabel(paywallSet)}</p>

          {PAYMENTS_ENABLED ? (
            <PayPalCheckout
              key={paywallSet.id}
              set={paywallSet}
              onApproved={dismissPaywall}
              onUnlocked={openPurchased}
            />
          ) : (
            <>
              <button className="btn btn-primary btn-block" disabled>
                Unlock for {priceLabel(paywallSet)}
              </button>
              <p className="dialog-foot">
                Checkout is not connected yet — add your PayPal client id to src/config/paypal.ts.
              </p>
            </>
          )}

          <button type="button" className="dialog-close" aria-label="Close" onClick={handleClose}>
            ×
          </button>
        </div>
      )}
    </dialog>
  );
}
