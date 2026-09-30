-- =====================================================================
--  Migration 013 — cap how fast one account can submit answers
--
--  submit_attempt() is the only unbounded write a signed-in student can
--  reach. Nothing stopped a script calling it in a loop: every call
--  inserts a row into attempts, and the free tier's database is 500MB.
--  It also lets someone inflate their own "questions answered" total,
--  which is the number the profile page is built around.
--
--  60 per minute is roughly twenty times faster than a person can read
--  an SAT question and choose an answer, so it should never be felt by
--  a real student — including one clicking quickly through easy items.
--  It exists to stop a loop, not to pace anybody.
--
--  Cost is one COUNT per submission, served by attempts_user_recent_idx
--  (user_id, created_at desc), which already exists for the profile
--  page. No new index.
--
--  Deliberately NOT rate limited here:
--
--    * Reading questions. Measured at 18KB for the whole free set, so
--      exhausting the 5GB monthly egress needs ~286,000 full scrapes.
--      The anon key is public by design and the free questions are meant
--      to be read; throttling them would cost more than it saves.
--    * Signups. Those belong to Supabase Auth, not to Postgres — see
--      Authentication -> Rate Limits, and enable enforce_user_cap() from
--      migration 006 under Authentication -> Hooks.
--
--  Safe to re-run.
-- =====================================================================

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
--  set_my_username() is deliberately left alone.
--
--  It looked like it needed a limit too, but one account holds exactly
--  one name — the function UPDATEs a single row rather than inserting.
--  Hoarding names would need many accounts, which is a signup problem
--  and belongs to Supabase Auth. All an unthrottled caller can do is
--  rewrite their own row, which costs nothing and affects nobody.
--  Redeclaring the function to add a limit it does not need would be a
--  chance to introduce a typo for no gain.
-- ---------------------------------------------------------------------


notify pgrst, 'reload schema';
