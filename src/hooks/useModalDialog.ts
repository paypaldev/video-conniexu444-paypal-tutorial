// ---------------------------------------------------------------------
//  Drive a native <dialog> from React state.
//
//  Keeping the real element rather than hand-rolling a modal preserves
//  what the browser gives free: focus trapping, Esc to close, inert
//  background, and the ::backdrop styling already in styles.css.
// ---------------------------------------------------------------------

import { useEffect, useRef } from 'react';

export function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Esc and the backdrop close the dialog without going through React,
  // so state has to be told after the fact or it desyncs and the dialog
  // cannot be reopened.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleClose = () => onClose();
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [onClose]);

  return ref;
}
