-- =====================================================================
--  Dev helper — wipe one account's answer history.
--
--  For testing the "skip what you have already answered" flow: run this,
--  reload the site, and the free set serves all 50 again from question 1.
--
--  THIS DELETES DATA AND CANNOT BE UNDONE. It also resets everything
--  derived from attempts:
--    * the current and longest streak
--    * every square on the contribution chart
--    * the per-set "x of y correct" counts
--
--  Local/admin helper, scoped to a single email so it cannot take the
--  whole table with it. Put your account email in both places below
--  (the c_email constant and the verification SELECT) before running
--  this in the SQL editor.
-- =====================================================================

do $$
declare
  -- Local/admin helper: put your account email here before running
  -- in the SQL editor.
  c_email constant text := 'you@example.com';
  v_user  uuid;
  v_gone  int;
begin
  select id into v_user from auth.users where email = c_email;

  if v_user is null then
    raise exception 'No account found for %. Nothing deleted.', c_email;
  end if;

  delete from public.attempts where user_id = v_user;
  get diagnostics v_gone = row_count;

  raise notice 'Deleted % attempts for %.', v_gone, c_email;
end;
$$;


-- Should be 0 rows for that account, and the free set back to 50 unseen.
-- Use the same address as c_email above.
select
  (select count(*) from public.attempts a
   join auth.users u on u.id = a.user_id
   where u.email = 'you@example.com')                                   as attempts_left,
  (select count(*) from public.questions where set_id = 'free-sampler') as free_questions;
