-- =====================================================================
--  Migration 006 — cap signups at 500 students
--
--  Creating the function is only half the job: it does nothing until it
--  is attached in the Dashboard under
--      Authentication -> Hooks -> Before User Created
--  See the note at the bottom.
--
--  Safe to re-run.
-- =====================================================================

create or replace function public.enforce_user_cap(event jsonb)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_count int;
begin
  -- deleted_at is null matters: without it, deleted accounts keep
  -- counting and the site silently caps below 500 real students.
  select count(*) into v_count
  from auth.users
  where deleted_at is null;

  if v_count >= 500 then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'KatSAT is at capacity (500 students) right now. Check back soon!'
      )
    );
  end if;

  return event;
end;
$$;

-- Only the auth service may run this. Anything else calling it would be
-- a way to probe how many accounts exist.
grant execute on function public.enforce_user_cap(jsonb) to supabase_auth_admin;
revoke execute on function public.enforce_user_cap(jsonb) from public, anon, authenticated;

-- Supabase Auth runs the hook as supabase_auth_admin, which needs to see
-- the schema the function lives in.
grant usage on schema public to supabase_auth_admin;


-- ---------------------------------------------------------------------
--  Confirm it exists and show where you stand.
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'enforce_user_cap') as function_installed,
  (select count(*) from auth.users where deleted_at is null)        as current_users,
  500 - (select count(*) from auth.users where deleted_at is null)  as seats_left;


-- ---------------------------------------------------------------------
--  STILL TO DO — the function is inert until you attach it:
--
--    Dashboard -> Authentication -> Hooks (Beta)
--      -> Before User Created
--      -> Enable, choose "Postgres Function"
--      -> schema: public, function: enforce_user_cap
--      -> Save
--
--  To raise or lower the cap later, change the 500 above and re-run
--  this file. No dashboard change needed.
--
--  To switch it off entirely, disable the hook in the Dashboard — do
--  not drop the function, or a still-attached hook will error on every
--  signup.
-- ---------------------------------------------------------------------
