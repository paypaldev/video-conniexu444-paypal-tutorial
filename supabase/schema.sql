-- =====================================================================
--  KatSAT — database schema (source of truth for a fresh project)
--  Run this once in the Supabase Dashboard -> SQL Editor.
--
--  If your project predates per-set unlocks, do NOT run this file —
--  run supabase/migration-002-per-set-unlocks.sql instead.
--
--  Design notes:
--   * Access is per set. A student owns a row in `entitlements` for each
--     set they have unlocked; there is no account-wide "pro" flag.
--   * Answer keys live in their own table with NO RLS policies, so they
--     are unreachable from the browser. Grading happens server-side in
--     submit_attempt(). A student cannot read the key before answering.
--   * The paywall is enforced by RLS on public.questions, not by the UI.
--     Hiding a locked set in JavaScript is decoration; this is the lock.
--   * Submitting an answer requires auth: anon has no EXECUTE grant on
--     submit_attempt(), and attempts has no INSERT policy at all.
-- =====================================================================


-- ---------------------------------------------------------------------
--  profiles  — one row per auth user
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  email      text,
  -- The name a student sees and can change. Shape is enforced here as
  -- well as in set_my_username(), because the signup trigger writes this
  -- column too and a generated name obeys the same rules.
  username   text,
  created_at timestamptz not null default now(),
  constraint profiles_username_shape check (
    username is null
    or (char_length(username) between 3 and 20
        and username ~ '^[A-Za-z0-9][A-Za-z0-9_]*$')
  )
);

-- Case-insensitive uniqueness. A plain UNIQUE would let "Kat" and "kat"
-- coexist, which reads as two students but is one name.
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- There is deliberately no UPDATE policy. Names are changed through
-- set_my_username() below, so the browser can never touch id or email.


-- ---------------------------------------------------------------------
--  default_username()  — a starting name derived from the email
--
--  Students land on the profile page with something already in the
--  field rather than a blank they are obliged to fill in. Collisions
--  append digits rather than failing: this runs inside the signup
--  trigger, and a name clash must never block creating an account.
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
  v_base := regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[^A-Za-z0-9_]', '', 'g');
  v_base := regexp_replace(v_base, '^_+', '');
  v_base := left(v_base, 16);

  if char_length(v_base) < 3 then
    v_base := 'student';
  end if;

  v_candidate := v_base;

  while exists (
    select 1 from public.profiles p where lower(p.username) = lower(v_candidate)
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := left(v_base, 16) || v_suffix::text;
  end loop;

  return v_candidate;
end;
$$;

revoke execute on function public.default_username(text) from public, anon, authenticated;


-- Create the profile row automatically when someone signs up.
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
--  question_sets  — metadata is public so locked sets can be advertised
-- ---------------------------------------------------------------------
create table if not exists public.question_sets (
  id          text primary key,
  title       text not null,
  description text,
  subject     text not null check (subject in ('math', 'reading-writing', 'mixed')),
  is_free     boolean not null default false,
  price_cents int not null default 0,
  -- Denormalised so a locked set can advertise its size. RLS hides the
  -- question rows themselves, so the browser cannot count them.
  question_count int not null default 0,
  sort_order  int not null default 0,
  constraint question_sets_price_check
    check (price_cents >= 0 and (is_free or price_cents > 0))
);

alter table public.question_sets enable row level security;

-- Anyone, signed in or not, can see that a set exists and what it costs.
-- They simply cannot read the questions inside one they do not own.
drop policy if exists "set metadata is public" on public.question_sets;
create policy "set metadata is public"
  on public.question_sets for select
  using (true);


-- ---------------------------------------------------------------------
--  entitlements  — one row per (student, set) they have unlocked
-- ---------------------------------------------------------------------
create table if not exists public.entitlements (
  user_id    uuid not null references auth.users on delete cascade,
  set_id     text not null references public.question_sets(id) on delete cascade,
  granted_at timestamptz not null default now(),
  -- how they got it: 'purchase' once PayPal is live, 'manual' for comps
  source     text not null default 'purchase',
  -- PayPal order id, for reconciliation and refunds. Unique so the same
  -- order can never be redeemed twice.
  order_ref  text,
  primary key (user_id, set_id)
);

create unique index if not exists entitlements_order_ref_idx
  on public.entitlements (order_ref)
  where order_ref is not null;

alter table public.entitlements enable row level security;

-- Students may see what they own. There is deliberately no INSERT or
-- UPDATE policy: only the service role (the PayPal webhook) writes here,
-- so nobody can grant themselves a set from the browser.
drop policy if exists "read own entitlements" on public.entitlements;
create policy "read own entitlements"
  on public.entitlements for select
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
--  questions  — stem + choices only, never the answer
-- ---------------------------------------------------------------------
create table if not exists public.questions (
  id         uuid primary key default gen_random_uuid(),
  set_id     text not null references public.question_sets(id) on delete cascade,
  sort_order int not null default 0,
  passage    text,
  -- [{"label": "A", "text": "..."}, ...]
  stem       text not null,
  choices    jsonb not null,
  difficulty text
);

create index if not exists questions_set_idx on public.questions (set_id, sort_order);

alter table public.questions enable row level security;

-- THE PAYWALL. A row is readable if its set is free, or if the current
-- user holds an entitlement for that set. Everything else returns zero
-- rows — not a hidden card, an empty result.
drop policy if exists "read free sets, or sets the user owns" on public.questions;
create policy "read free sets, or sets the user owns"
  on public.questions for select
  using (
    exists (
      select 1
      from public.question_sets s
      where s.id = questions.set_id
        and (
          s.is_free
          or exists (
            select 1 from public.entitlements e
            where e.user_id = auth.uid()
              and e.set_id  = questions.set_id
          )
        )
    )
  );


-- Keep question_sets.question_count accurate automatically.
create or replace function public.sync_question_count()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.question_sets s
  set question_count = (
    select count(*) from public.questions q where q.set_id = s.id
  )
  where s.id in (
    coalesce(new.set_id, old.set_id),
    coalesce(old.set_id, new.set_id)
  );
  return null;
end;
$$;

drop trigger if exists questions_count_sync on public.questions;
create trigger questions_count_sync
  after insert or update of set_id or delete on public.questions
  for each row execute function public.sync_question_count();


-- ---------------------------------------------------------------------
--  question_keys  — answer + explanation. NO POLICIES ON PURPOSE.
-- ---------------------------------------------------------------------
create table if not exists public.question_keys (
  question_id    uuid primary key references public.questions(id) on delete cascade,
  correct_choice text not null,
  explanation    text
);

alter table public.question_keys enable row level security;
-- No policy is created here. With RLS on and no policy, every read from
-- the browser returns nothing. Only security-definer functions below can
-- see this table. Do not add a select policy.


-- ---------------------------------------------------------------------
--  attempts  — every submitted answer
-- ---------------------------------------------------------------------
create table if not exists public.attempts (
  id              bigserial primary key,
  user_id         uuid not null references auth.users on delete cascade,
  question_id     uuid not null references public.questions(id) on delete cascade,
  selected_choice text not null,
  is_correct      boolean not null,
  created_at      timestamptz not null default now()
);

create index if not exists attempts_user_recent_idx on public.attempts (user_id, created_at desc);
create index if not exists attempts_user_question_idx on public.attempts (user_id, question_id);

alter table public.attempts enable row level security;

drop policy if exists "read own attempts" on public.attempts;
create policy "read own attempts"
  on public.attempts for select
  using (auth.uid() = user_id);

-- No INSERT policy: rows are only ever written by submit_attempt(),
-- which means a client cannot forge is_correct = true.


-- ---------------------------------------------------------------------
--  submit_attempt()  — grade + record, server-side
-- ---------------------------------------------------------------------
create or replace function public.submit_attempt(p_question_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  -- Twenty times faster than a person can actually answer.
  c_max_per_minute constant int := 60;

  v_user_id     uuid := auth.uid();
  v_recent      int;
  v_set_id      text;
  v_is_free     boolean;
  v_owns        boolean;
  v_correct     text;
  v_explanation text;
  v_is_correct  boolean;
begin
  -- Login is required to submit, even on the free set.
  if v_user_id is null then
    raise exception 'You must be signed in to submit an answer.'
      using errcode = '42501';
  end if;

  -- Rate limit. Checked before any other work so a runaway loop costs a
  -- single indexed count rather than the joins below.
  select count(*) into v_recent
  from public.attempts a
  where a.user_id = v_user_id
    and a.created_at > now() - interval '1 minute';

  if v_recent >= c_max_per_minute then
    raise exception 'That is a lot of answers at once. Wait a moment and try again.'
      using errcode = '54000';
  end if;

  select q.set_id, s.is_free
    into v_set_id, v_is_free
  from public.questions q
  join public.question_sets s on s.id = q.set_id
  where q.id = p_question_id;

  if v_set_id is null then
    raise exception 'Question not found.' using errcode = 'P0002';
  end if;

  if not v_is_free then
    select exists (
      select 1 from public.entitlements e
      where e.user_id = v_user_id and e.set_id = v_set_id
    ) into v_owns;

    if not v_owns then
      raise exception 'You do not own this set.' using errcode = '42501';
    end if;
  end if;

  select k.correct_choice, k.explanation
    into v_correct, v_explanation
  from public.question_keys k
  where k.question_id = p_question_id;

  v_is_correct := (upper(btrim(p_choice)) = upper(btrim(v_correct)));

  insert into public.attempts (user_id, question_id, selected_choice, is_correct)
  values (v_user_id, p_question_id, p_choice, v_is_correct);

  return jsonb_build_object(
    'is_correct',     v_is_correct,
    'correct_choice', v_correct,
    'explanation',    v_explanation
  );
end;
$$;

revoke execute on function public.submit_attempt(uuid, text) from public, anon;
grant   execute on function public.submit_attempt(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
--  my_sets()  — which sets the signed-in student owns
-- ---------------------------------------------------------------------
create or replace function public.my_sets()
returns table (set_id text)
language sql
stable
security definer set search_path = public
as $$
  select e.set_id
  from public.entitlements e
  where e.user_id = auth.uid();
$$;

revoke execute on function public.my_sets() from public, anon;
grant   execute on function public.my_sets() to authenticated;


-- ---------------------------------------------------------------------
--  my_progress()  — per-set counts for the signed-in user
-- ---------------------------------------------------------------------
create or replace function public.my_progress()
returns table (set_id text, answered bigint, correct bigint)
language sql
stable
security definer set search_path = public
as $$
  select q.set_id,
         count(distinct a.question_id)::bigint,
         count(distinct a.question_id) filter (where a.is_correct)::bigint
  from public.attempts a
  join public.questions q on q.id = a.question_id
  where a.user_id = auth.uid()
  group by q.set_id;
$$;

revoke execute on function public.my_progress() from public, anon;
grant   execute on function public.my_progress() to authenticated;


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
--  set_my_username()  — the only write path for a display name
--
--  Going through a function rather than an UPDATE policy means the
--  browser cannot touch `email` or `id`, and the three ways a name can
--  be rejected all come back as sentences the UI shows verbatim.
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

  if not found then
    insert into public.profiles (id, email, username)
    select v_user, u.email, v_name
    from auth.users u
    where u.id = v_user;
  end if;

  return v_name;
exception
  -- The lookup above is racy by nature; the unique index is what
  -- actually decides. Catching it turns a constraint dump into
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
--  OPTIONAL: cap signups at 500
--  Enable in Dashboard -> Authentication -> Hooks -> Before User Created
-- ---------------------------------------------------------------------
create or replace function public.enforce_user_cap(event jsonb)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from auth.users
  where deleted_at is null;

  if v_count >= 500 then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'We are at capacity (500 students). Join the waitlist!'
      )
    );
  end if;

  return event;
end;
$$;

grant execute on function public.enforce_user_cap(jsonb) to supabase_auth_admin;
revoke execute on function public.enforce_user_cap(jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------
--  DEV HELPER: unlock a set for yourself.
--
--    insert into public.entitlements (user_id, set_id, source)
--    select id, 'algebra-drill', 'manual' from auth.users
--    where email = 'you@example.com'
--    on conflict do nothing;
-- ---------------------------------------------------------------------
