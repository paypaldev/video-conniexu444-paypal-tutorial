// ---------------------------------------------------------------------
//  CORS + JSON response helpers + the two Supabase clients.
// ---------------------------------------------------------------------

// Fully-qualified on purpose. The deploy bundler uploads only the .ts
// files and does not read deno.json, so a bare specifier that resolves
// fine locally fails at deploy time with "Relative import path not
// prefixed with / or ./ or ../".
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@^2.112.2';

/**
 * Origins allowed to call the checkout functions.
 *
 * An explicit list rather than '*'. These endpoints act on a signed-in
 * user's behalf, so a wildcard would let any page on the internet drive
 * them with a borrowed token.
 */
const ALLOWED_ORIGINS = [
  'https://katsat.org',
  'https://www.katsat.org',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
];

export function corsHeaders(origin: string | null): Record<string, string> {
  // Echo the origin only when it is one of ours; otherwise send a value
  // that will never match, so the browser blocks the response.
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // So the browser can read Retry-After on a 429 and wait before retrying.
    'Access-Control-Expose-Headers': 'Retry-After',
    Vary: 'Origin',
  };
}

export function json(
  body: unknown,
  status: number,
  origin: string | null,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

/** Standard preflight reply. */
export function preflight(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

/**
 * Service-role client. Bypasses RLS — this is what writes entitlements.
 * Never construct this from anything the caller supplied.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Resolve the calling user from their Authorization header.
 *
 * The user id ALWAYS comes from here, never from the request body. A
 * body-supplied user_id would let any signed-in student buy a set for
 * themselves and have it granted to someone else — or, worse, claim
 * another student's completed order.
 */
export async function getCallerId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}
