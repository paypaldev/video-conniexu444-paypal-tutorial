import { useCallback, useState } from 'react';

import { CONFIGURED } from '../config/supabase.js';
import { friendlyAuthError } from '../lib/errors.js';
import { db } from '../lib/supabase.js';
import { useModalDialog } from '../hooks/useModalDialog.js';
import { useApp } from '../state/AppContext.js';

export function AuthDialog() {
  const { authDialog, closeAuth } = useApp();
  const { open, reason } = authDialog;

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleClose = useCallback(() => {
    closeAuth();
    setError('');
  }, [closeAuth]);

  const ref = useModalDialog(open, handleClose);

  async function handleGoogle() {
    if (!CONFIGURED) {
      setError('Demo mode — add your Supabase URL and anon key to config/supabase.ts first.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const { error: authError } = await db().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });

      if (authError) {
        setError(friendlyAuthError(authError));
        setBusy(false);
      }
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog">
      <div className="dialog-body">
        <h2>Sign in to KatSAT</h2>
        <p className="dialog-sub">
          {reason || 'Use your Google account to save your progress across devices.'}
        </p>

        {error && <p className="form-error">{error}</p>}

        <button
          type="button"
          className="btn btn-google btn-block"
          disabled={busy}
          onClick={() => void handleGoogle()}
        >
          <span className="google-mark" aria-hidden="true">G</span>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>

        <button type="button" className="dialog-close" aria-label="Close" onClick={handleClose}>
          ×
        </button>
      </div>
    </dialog>
  );
}
