// ---------------------------------------------------------------------
//  The Supabase client.
// ---------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

import { CONFIGURED, supabaseConfig } from '../config/supabase.js';
import type { Database } from '../types.js';

// Deliberately not annotated. createClient returns SupabaseClient with
// three generic parameters, two of which are inferred; writing
// `SupabaseClient<Database>` by hand supplies only the first and quietly
// collapses every .rpc() return type to never.
export const sb = CONFIGURED
  ? createClient<Database>(supabaseConfig.SUPABASE_URL, supabaseConfig.SUPABASE_ANON_KEY)
  : null;

/**
 * The client, for paths already guarded by CONFIGURED.
 *
 * Making the assertion explicit means an unguarded call site fails with a
 * sentence instead of "cannot read properties of null".
 */
export function db() {
  if (!sb) throw new Error('Supabase is not configured — this path requires CONFIGURED.');
  return sb;
}
