// ---------------------------------------------------------------------
//  Supabase connection — katsat.org
//
//  Fill these in from Supabase Dashboard -> Project Settings -> Data API
//
//  Until you do, the site runs in DEMO MODE: the free set renders from
//  local sample data so you can see the UI, and anything that touches
//  the server tells you to configure this file.
//
//  Both values below are public by design. The anon key ships in the
//  browser — Row Level Security is what protects your data, not secrecy
//  of this key. Never put the *service role* key in here, or anywhere
//  else under src/, because everything here is bundled into public/.
// ---------------------------------------------------------------------

export interface SupabaseConfig {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export const supabaseConfig: SupabaseConfig = {
  SUPABASE_URL: 'https://pbcavxhqpnqnasscmedc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_6V243Y1uXnzPbXIleTuxYA_9_2_0JaN',
};

/**
 * True once the values above are real rather than the shipped
 * placeholders. Demo mode is the fallback, so a fresh clone renders
 * something instead of erroring against a project that does not exist.
 */
export const CONFIGURED: boolean =
  supabaseConfig.SUPABASE_URL.startsWith('https://') &&
  !supabaseConfig.SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  !supabaseConfig.SUPABASE_ANON_KEY.includes('YOUR-');
