-- =====================================================================
--  RLS audit — run this whenever a table is added, and before a launch.
--
--  Reads nothing but the catalog, changes nothing. Safe to run any time.
--
--  What you want to see:
--    * rls_enabled = true on EVERY row.
--    * policies = 0 on question_keys only. That table is sealed on
--      purpose: RLS on with no policy means no browser session can read
--      it, and only SECURITY DEFINER functions (submit_attempt) can see
--      the answers. The Supabase advisor flags it as "RLS Enabled No
--      Policy" — that finding is the design working, not a bug.
--    * question_sets is the one table with a read-everything policy.
--      Set titles and prices are public so a locked set can advertise
--      itself; the questions inside it are not.
--
--  Note what RLS does NOT cover: the service_role key bypasses RLS
--  entirely, by design — that is how the PayPal Edge Functions write
--  entitlements. That key must never appear anywhere under src/.
-- =====================================================================

select
  c.relname                                   as table_name,
  c.relrowsecurity                            as rls_enabled,
  -- Table owners bypass their own RLS unless it is FORCED. Only worth
  -- turning on if you ever query as the owning role and want the
  -- policies to apply to you too.
  c.relforcerowsecurity                       as rls_forced,
  count(p.polname)                            as policies,
  coalesce(string_agg(p.polname, ', ' order by p.polname), '—') as policy_names
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'          -- ordinary tables; views have no RLS
group by c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relrowsecurity, c.relname;


-- Every policy and what it actually gates on.
--
-- Read the using_expression, not the row's presence: policies written
-- without a TO clause apply to PUBLIC, so they all appear here whether
-- or not an anonymous caller can use them. `auth.uid() = user_id` is
-- NULL for anon and lets nothing through. `true` is the one to look
-- twice at — question_sets should be the only policy with it.
--
-- Check the `command` column too. Every row should read `r` (SELECT):
-- no table in this schema has an INSERT, UPDATE or DELETE policy, so
-- every write goes through a SECURITY DEFINER function or service_role.
-- A `w`, `a` or `d` appearing here is a real change in posture.
select
  c.relname as table_name,
  p.polname as policy,
  p.polcmd  as command,
  pg_get_expr(p.polqual, p.polrelid)      as using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression
from pg_policy p
join pg_class c     on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (p.polroles = '{0}'::oid[]                 -- applies to PUBLIC
       or 'anon' = any (select rolname
                        from pg_roles
                        where oid = any (p.polroles)))
order by c.relname, p.polname;
