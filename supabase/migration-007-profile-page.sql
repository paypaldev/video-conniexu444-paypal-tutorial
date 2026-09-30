-- =====================================================================
--  Migration 007 — display names + the activity calendar
--
--  Adds what the profile page needs:
--    * profiles.username — the name a student sees and can change. Unique
--      case-insensitively, so "Kat" and "kat" cannot both exist.
--    * set_my_username()  — the only way to write it, so validation and
--      the "that name is taken" message live in one place.
--    * my_profile()       — read your own row, creating it if an account
--      predates the signup trigger.
--    * my_activity()      — one row per day you answered anything, for
--      the contribution chart. Grouped in the student's own timezone.
--
--  Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
--  profiles.username
--
--  Nullable in the column definition on purpose: adding a NOT NULL to a
--  table that already has rows would fail before the backfill below has
--  a chance to run. The trigger and the backfill together mean every row
--  ends up with one.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists username text;

-- Shape is enforced here as well as in set_my_username(), because the
-- function is not the only thing that writes this column — the signup
-- trigger does too, and a generated name has to obey the same rules.
alter table public.profiles
  drop constraint if exists profiles_username_shape;
alter table public.profiles
  add constraint profiles_username_shape
  check (
    username is null
    or (char_length(username) between 3 and 20
        and username ~ '^[A-Za-z0-9][A-Za-z0-9_]*$')
  );

-- Case-insensitive uniqueness. A plain UNIQUE would let "Kat" and "kat"
-- coexist, which reads as two students but is one name.
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));


-- ---------------------------------------------------------------------
--  default_username()  — a starting name derived from the email
--
--  Students should land on the profile page with something already in
--  the field rather than a blank they are obliged to fill in. The local
--  part of the email is the best guess available at signup.
--
--  Collisions are resolved by appending digits rather than by failing:
--  this runs inside the signup trigger, and a name clash must never be
--  the reason an account cannot be created.
-- ---------------------------------------------------------------------
create or replace function public.default_username(p_email text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_base      text;
  v_candidate text;
  v_suffix    int := 0;
begin
  -- Strip the domain, then everything the shape constraint would reject.
  v_base := regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[^A-Za-z0-9_]', '', 'g');
  v_base := regexp_replace(v_base, '^_+', '');
  v_base := left(v_base, 16);

  -- An email like "___@x.com" leaves nothing usable, and a two-character
  -- local part is too short for the constraint.
  if char_length(v_base) < 3 then
    v_base := 'student';
  end if;

  v_candidate := v_base;

  while exists (
    select 1 from public.profiles p where lower(p.username) = lower(v_candidate)
  ) loop
    v_suffix := v_suffix + 1;
    -- Bounded so the result cannot outgrow the 20-character limit.
    v_candidate := left(v_base, 16) || v_suffix::text;
  end loop;

  return v_candidate;
end;
$$;

revoke execute on function public.default_username(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
--  handle_new_user()  — now seeds a username too
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, username)
  values (new.id, new.email, public.default_username(new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
--  Backfill: every existing student gets a name.
--
--  Row by row rather than one UPDATE, because default_username() checks
--  the table for collisions and a set-based update would not see the
--  names being assigned in the same statement.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
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


-- ---------------------------------------------------------------------
--  my_profile()  — your own row, created on demand
--
--  Volatile, not stable: an account created before the signup trigger
--  existed has no profile row, and the profile page should show that
--  student a name rather than an empty state they cannot fix.
-- ---------------------------------------------------------------------
create or replace function public.my_profile()
returns table (id uuid, email text, username text, created_at timestamptz)
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

  insert into public.profiles (id, email, username)
  values (v_user, v_email, public.default_username(v_email))
  on conflict (id) do nothing;

  return query
    select p.id, p.email, p.username, p.created_at
    from public.profiles p
    where p.id = v_user;
end;
$$;

revoke execute on function public.my_profile() from public, anon;
grant   execute on function public.my_profile() to authenticated;


-- ---------------------------------------------------------------------
--  set_my_username()  — the only write path
--
--  There is deliberately no UPDATE policy on public.profiles. Going
--  through a function means the browser cannot touch `email` or `id`,
--  and the three ways a name can be rejected all come back as sentences
--  the profile page can show verbatim.
-- ---------------------------------------------------------------------
create or replace function public.set_my_username(p_username text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_username, ''));
begin
  if v_user is null then
    raise exception 'You must be signed in to change your name.' using errcode = '42501';
  end if;

  if char_length(v_name) < 3 or char_length(v_name) > 20 then
    raise exception 'Your display name has to be 3 to 20 characters.' using errcode = '22023';
  end if;

  if v_name !~ '^[A-Za-z0-9][A-Za-z0-9_]*$' then
    raise exception 'Use letters, numbers and underscores only, starting with a letter or number.'
      using errcode = '22023';
  end if;

  update public.profiles
  set username = v_name
  where id = v_user;

  -- No row means the account predates the signup trigger.
  if not found then
    insert into public.profiles (id, email, username)
    select v_user, u.email, v_name
    from auth.users u
    where u.id = v_user;
  end if;

  return v_name;
exception
  -- The check above is racy by nature; the unique index is what actually
  -- decides. Catching it here turns a Postgres constraint dump into
  -- something a student can act on.
  when unique_violation then
    raise exception 'That name is already taken. Try another one.' using errcode = '23505';
end;
$$;

revoke execute on function public.set_my_username(text) from public, anon;
grant   execute on function public.set_my_username(text) to authenticated;


-- ---------------------------------------------------------------------
--  my_activity()  — one row per day, for the contribution chart
--
--  Timezone comes from the browser rather than being assumed, because
--  "did I practise today?" is a question about the student's midnight,
--  not UTC's. Someone in Los Angeles answering at 8pm would otherwise
--  see the square light up on tomorrow's date.
--
--  Counts every attempt, not distinct questions: this measures how often
--  they show up and answer, so a second pass at a question they got
--  wrong is more activity, not less.
-- ---------------------------------------------------------------------
create or replace function public.my_activity(p_tz text default 'UTC', p_days int default 365)
returns table (day date, answered bigint, correct bigint)
language plpgsql
security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_tz    text := coalesce(nullif(btrim(p_tz), ''), 'UTC');
  -- Clamped: the chart draws a fixed window, and an unbounded p_days
  -- would let a caller ask for a full-table scan.
  v_days  int  := least(greatest(coalesce(p_days, 365), 1), 400);
  v_start timestamptz;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- An unknown zone name raises rather than defaulting, so fall back
  -- instead of failing the whole page over a browser we do not know.
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'UTC';
  end;

  v_start := (date_trunc('day', now() at time zone v_tz)
              - make_interval(days => v_days - 1)) at time zone v_tz;

  return query
    select (a.created_at at time zone v_tz)::date as day,
           count(*)::bigint                       as answered,
           count(*) filter (where a.is_correct)::bigint as correct
    from public.attempts a
    where a.user_id = v_user
      and a.created_at >= v_start
    group by 1
    order by 1;
end;
$$;

revoke execute on function public.my_activity(text, int) from public, anon;
grant   execute on function public.my_activity(text, int) to authenticated;


-- ---------------------------------------------------------------------
--  Tell PostgREST about the new functions.
--
--  It serves the REST API from a cached copy of the schema and only
--  refreshes on its own schedule. Until it reloads, calling one of the
--  functions above fails with "Could not find the function ... in the
--  schema cache" even though the function exists.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
