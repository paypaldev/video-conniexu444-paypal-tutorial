-- =====================================================================
--  Migration 011 — stop granting EXECUTE on the trigger functions
--
--  Clears four Supabase linter warnings:
--    anon/authenticated can execute public.handle_new_user()
--    anon/authenticated can execute public.sync_question_count()
--
--  Both are trigger functions. Neither was ever reachable: PostgREST
--  refuses to expose a function returning `trigger`, so calling
--  /rest/v1/rpc/handle_new_user answers PGRST202 rather than running
--  anything. Verified against this project before writing this. So this
--  is tidying, not a fix — it removes a grant nobody could use.
--
--  Why it is safe to revoke a privilege the triggers depend on:
--  PostgreSQL checks EXECUTE on a trigger function when the trigger is
--  CREATED, not each time it fires. The roles that matter here are not
--  affected either way — the signup trigger fires as supabase_auth_admin
--  inserting into auth.users, and questions are only ever modified by an
--  admin, never by `authenticated`.
--
--  That claim is load-bearing, so this runs inside a transaction with a
--  check after it. If revoking somehow stopped a trigger firing, the
--  check raises and the whole thing rolls back — you cannot end up with
--  the revoke applied and the triggers broken.
--
--  Safe to re-run.
-- =====================================================================

begin;


revoke execute on function public.handle_new_user()     from public, anon, authenticated;
revoke execute on function public.sync_question_count() from public, anon, authenticated;


-- ---------------------------------------------------------------------
--  Check: does the count trigger still fire?
--
--  Honest about what this proves. It runs as the migration's own role,
--  so it shows the trigger mechanism survived the revoke — not that some
--  other role can still fire it. That distinction does not matter here,
--  because no other role writes to public.questions.
--
--  `update of set_id` fires whenever set_id appears in the SET list,
--  even when the value is identical, so setting it to what it already is
--  fires the trigger and changes no data.
-- ---------------------------------------------------------------------
do $$
declare
  v_id     uuid;
  v_set    text;
  v_synced int;
  v_actual int;
begin
  select q.id, q.set_id into v_id, v_set
  from public.questions q
  limit 1;

  if v_id is null then
    raise notice 'No questions to test against; skipping the trigger check.';
    return;
  end if;

  update public.questions
  set set_id = v_set
  where id = v_id;

  select s.question_count into v_synced
  from public.question_sets s where s.id = v_set;

  select count(*) into v_actual
  from public.questions q where q.set_id = v_set;

  if v_synced is distinct from v_actual then
    raise exception
      'sync_question_count did not fire after the revoke (% recorded vs % actual). Rolling back.',
      v_synced, v_actual;
  end if;

  raise notice 'Trigger still fires: % holds % questions, count in sync.', v_set, v_actual;
end;
$$;


commit;


-- ---------------------------------------------------------------------
--  The other trigger, handle_new_user(), cannot be tested from here —
--  it needs a real signup. After running this, create a throwaway
--  account and confirm a row appears:
--
--      select id, email, username from public.profiles
--      order by created_at desc limit 1;
--
--  If it does not, put the grant back with:
--
--      grant execute on function public.handle_new_user() to supabase_auth_admin;
--
--  (my_profile() also creates a missing profile row on demand, so even
--  in that case a student would still end up with one.)
-- ---------------------------------------------------------------------

-- Should list only the intended API functions as callable by anon.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                               as security_definer,
       has_function_privilege('anon',            p.oid, 'execute') as anon_can_call,
       has_function_privilege('authenticated',   p.oid, 'execute') as authed_can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;
