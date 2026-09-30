-- =====================================================================
--  Migration 010 — which questions has this student already answered?
--
--  Opening a set has always served it from question 1, so a student who
--  did the first ten yesterday met the same ten again today. attempts
--  already knows better; nothing was reading it back.
--
--  Returns ids only. The client subtracts them from the set it already
--  holds, so this adds one small query per set opened rather than a
--  second copy of the questions.
--
--  Why a function rather than selecting from attempts directly: the
--  "read own attempts" policy would allow that, but the client would
--  have to join through questions to filter by set, which means teaching
--  it the shape of a table it otherwise never touches. This keeps the
--  browser's view of the database to the same small set of functions.
--
--  Safe to re-run.
-- =====================================================================

create or replace function public.my_answered(p_set_id text)
returns table (question_id uuid)
language sql
stable
security definer set search_path = public
as $$
  -- distinct because a question answered three times is still one
  -- question the student has seen.
  select distinct a.question_id
  from public.attempts a
  join public.questions q on q.id = a.question_id
  where a.user_id = auth.uid()
    and q.set_id = p_set_id;
$$;

revoke execute on function public.my_answered(text) from public, anon;
grant   execute on function public.my_answered(text) to authenticated;


-- ---------------------------------------------------------------------
--  Also: name the free set properly. 009 called it "Free Practice",
--  which does not say what it is practice for.
-- ---------------------------------------------------------------------
update public.question_sets
set title = 'Free Math Practice'
where id = 'free-sampler';


notify pgrst, 'reload schema';
