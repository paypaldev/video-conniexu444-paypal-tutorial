-- =====================================================================
--  Migration 002 — per-set unlocks
--
--  Replaces the single account-wide `profiles.is_pro` flag with an
--  entitlements table, so a student buys individual sets rather than
--  one all-or-nothing upgrade.
--
--  Run once in the SQL Editor. Safe to re-run.
--
--  NOTE: this drops profiles.is_pro at the end. Anyone currently marked
--  pro is migrated to explicit entitlements for every existing paid set
--  first, so no access is lost.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Per-set price, so the paywall can show what a set costs
-- ---------------------------------------------------------------------
alter table public.question_sets
  add column if not exists price_cents int not null default 0;

-- Backfill BEFORE adding the constraint: existing paid sets arrive at the
-- column default of 0, which the constraint rejects. Named sets get their
-- real price; anything else paid gets $5 so the constraint can hold.
update public.question_sets set price_cents = 500 where id = 'algebra-drill';
update public.question_sets set price_cents = 500 where id = 'reading-evidence';
update public.question_sets set price_cents = 500
  where not is_free and price_cents = 0;
update public.question_sets set price_cents = 0 where is_free;

alter table public.question_sets
  drop constraint if exists question_sets_price_check;
alter table public.question_sets
  add constraint question_sets_price_check
  check (price_cents >= 0 and (is_free or price_cents > 0));


-- ---------------------------------------------------------------------
--  1b. Public question count, so a locked set can advertise its size.
--      RLS hides the question rows, so the browser cannot count them.
-- ---------------------------------------------------------------------
alter table public.question_sets
  add column if not exists question_count int not null default 0;

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

-- Backfill for rows that already exist.
update public.question_sets s
set question_count = (
  select count(*) from public.questions q where q.set_id = s.id
);


-- ---------------------------------------------------------------------
--  2. entitlements — one row per (student, set) they own
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
--  3. Carry existing Pro users over before the flag disappears
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'is_pro'
  ) then
    execute $mig$
      insert into public.entitlements (user_id, set_id, source)
      select p.id, s.id, 'manual'
      from public.profiles p
      cross join public.question_sets s
      where p.is_pro and not s.is_free
      on conflict (user_id, set_id) do nothing;
    $mig$;
  end if;
end $$;


-- ---------------------------------------------------------------------
--  4. THE PAYWALL, rewritten against entitlements
-- ---------------------------------------------------------------------
drop policy if exists "read free sets, or any set when pro" on public.questions;
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


-- ---------------------------------------------------------------------
--  5. submit_attempt() — same gate, checked server-side
-- ---------------------------------------------------------------------
create or replace function public.submit_attempt(p_question_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_set_id      text;
  v_is_free     boolean;
  v_owns        boolean;
  v_correct     text;
  v_explanation text;
  v_is_correct  boolean;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to submit an answer.'
      using errcode = '42501';
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
--  6. my_sets() — which sets the signed-in student owns
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
--  7. Retire the old flag
--     (prices were set in step 1, before the constraint was added)
-- ---------------------------------------------------------------------
alter table public.profiles drop column if exists is_pro;


-- ---------------------------------------------------------------------
--  DEV HELPER: grant yourself a set to test.
--
--    insert into public.entitlements (user_id, set_id, source)
--    select id, 'algebra-drill', 'manual' from auth.users
--    where email = 'you@example.com'
--    on conflict do nothing;
--
--  And to take it back:
--
--    delete from public.entitlements
--    where set_id = 'algebra-drill'
--      and user_id = (select id from auth.users where email = 'you@example.com');
-- ---------------------------------------------------------------------
