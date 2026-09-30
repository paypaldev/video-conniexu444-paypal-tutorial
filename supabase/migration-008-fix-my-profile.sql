-- =====================================================================
--  Migration 008 — fix my_profile()
--
--  Symptom: the profile page shows "Your profile" and the header shows
--  "Profile" instead of the student's display name, while the streaks
--  and the activity chart work perfectly.
--
--  Cause: migration 007 declared
--
--      returns table (id uuid, email text, username text, ...)
--
--  which creates plpgsql variables called `id`, `email` and `username`.
--  The same function then runs
--
--      insert into public.profiles (id, email, username) ...
--      on conflict (id) do nothing
--
--  and `on conflict (id)` is an expression plpgsql tries to resolve.
--  `id` is both a variable and a column there, so with the default
--  plpgsql.variable_conflict = error the call fails at runtime with
--  "column reference id is ambiguous". my_activity() was never affected
--  because it refers to its columns by ordinal (group by 1) and never
--  names one in an expression.
--
--  Fix: `returns setof public.profiles`. A composite return type declares
--  no variables at all, so the collision cannot happen — and because the
--  row type is the table's, PostgREST still sends exactly the same JSON
--  keys the app already expects.
--
--  Safe to re-run.
-- =====================================================================


-- The signature changes from a table type to a composite type, and
-- CREATE OR REPLACE cannot change a function's return type.
drop function if exists public.my_profile();

create function public.my_profile()
returns setof public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;

  -- Creates the row for an account that predates the signup trigger.
  insert into public.profiles (id, email, username)
  values (v_user, v_email, public.default_username(v_email))
  on conflict (id) do nothing;

  -- A row that exists but never got a name — the 007 backfill only saw
  -- accounts that already had a profiles row.
  update public.profiles p
  set username = public.default_username(v_email)
  where p.id = v_user
    and p.username is null;

  return query
    select p.* from public.profiles p where p.id = v_user;
end;
$$;

revoke execute on function public.my_profile() from public, anon;
grant   execute on function public.my_profile() to authenticated;


-- ---------------------------------------------------------------------
--  Catch up anyone missing a profile row entirely.
--
--  007's backfill joined profiles to auth.users, so it could only fix
--  rows that already existed. This starts from auth.users instead.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select u.id, u.email
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
  loop
    insert into public.profiles (id, email, username)
    values (r.id, r.email, public.default_username(r.email))
    on conflict (id) do nothing;
  end loop;

  for r in
    select p.id, coalesce(p.email, u.email) as email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.username is null
  loop
    update public.profiles
    set username = public.default_username(r.email)
    where id = r.id;
  end loop;
end;
$$;


notify pgrst, 'reload schema';


-- Should list one row per account, every username filled in.
select id, email, username from public.profiles order by created_at;
