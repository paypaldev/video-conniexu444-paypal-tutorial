/* =====================================================================
   KatSAT — entry point

   React 19, bundled by esbuild into public/app.js and loaded as a plain
   <script>.

   The rules this app implements on the client are conveniences. The real
   enforcement lives in Postgres (see supabase/schema.sql):
     - locked sets return zero rows from RLS, not just a hidden card
     - answer keys are unreadable until submit_attempt() returns one
     - submit_attempt() has no EXECUTE grant for anon, so a signed-out
       user cannot record an attempt no matter what the UI does

   And for checkout (see supabase/functions/):
     - the price is read from the database, never sent by the browser
     - the buyer is derived from the JWT, never sent by the browser
   ===================================================================== */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { AppProvider } from './state/AppContext.js';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root — is it still in index.html?');

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);
