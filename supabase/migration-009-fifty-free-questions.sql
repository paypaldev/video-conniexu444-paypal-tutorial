-- =====================================================================
--  Migration 009 — one free set of 50 questions
--
--  Before: two free sets, "Free Sampler" (8) and "Free Diagnostic" (4).
--  After:  one free set of exactly 50, and no diagnostic.
--
--  The diagnostic's questions are MOVED into the free set rather than
--  deleted. attempts.question_id cascades on delete, so dropping those
--  rows would silently erase answered history — streaks and the activity
--  chart would shrink for anyone who had already worked through it.
--  Moving keeps every attempt attached to its question.
--
--  The rest of the top-up comes off the tail of the four paid sets,
--  spread evenly so the free set stays representative of all four math
--  domains. Moving rather than copying matters: a copy would show a
--  buyer the same question twice, once free and once in the set they
--  paid for.
--
--  Signing in is still required to answer. That is enforced in
--  submit_attempt() — anon has no EXECUTE grant, and attempts has no
--  INSERT policy — and nothing here changes it. Free means free to
--  open, not free to use anonymously.
--
--  Safe to re-run: the top-up is driven by how many questions the free
--  set is short, so a second run moves nothing.
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
--  1. Fold the diagnostic in, then retire the set itself.
-- ---------------------------------------------------------------------
update public.questions
set set_id = 'free-sampler'
where set_id = 'free-diagnostic';

-- Empty by now, so this deletes a set row and nothing else.
delete from public.question_sets where id = 'free-diagnostic';


-- ---------------------------------------------------------------------
--  2. Top the free set up to exactly 50.
--
--  Quota per source is recomputed each pass over the remaining sources,
--  so a source that cannot supply its share (fewer rows than asked for)
--  is made up by the ones after it rather than leaving the set short.
-- ---------------------------------------------------------------------
do $$
declare
  c_free    constant text := 'free-sampler';
  c_target  constant int  := 50;
  c_sources constant text[] := array[
    'algebra-01', 'advanced-math-01', 'geometry-trig-01', 'problem-solving-01'
  ];
  v_short  int;
  v_take   int;
  v_moved  int;
  v_i      int;
begin
  select c_target - count(*) into v_short
  from public.questions where set_id = c_free;

  if v_short <= 0 then
    raise notice 'Free set already holds % questions; nothing moved.', c_target - v_short;
    return;
  end if;

  for v_i in 1 .. array_length(c_sources, 1) loop
    exit when v_short <= 0;

    -- Ceiling division: with 38 to find across 4 sources this is
    -- 10, 10, 9, 9 rather than 9, 9, 9, 9 and two left over.
    v_take := ceil(v_short::numeric / (array_length(c_sources, 1) - v_i + 1));

    update public.questions
    set set_id = c_free
    where id in (
      select q.id
      from public.questions q
      where q.set_id = c_sources[v_i]
      -- Off the end, so what remains in the paid set keeps its opening
      -- run of questions intact.
      order by q.sort_order desc, q.id desc
      limit v_take
    );

    get diagnostics v_moved = row_count;
    v_short := v_short - v_moved;
  end loop;

  if v_short > 0 then
    raise exception 'Only found % of the % questions needed for the free set.',
      c_target - v_short, c_target;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
--  3. Renumber.
--
--  The moved rows carry the sort_order they had in their old set, so
--  without this the free set has fifty questions sharing a dozen
--  positions and no defined order to work through them in.
-- ---------------------------------------------------------------------
with ordered as (
  select id, row_number() over (order by sort_order, id) as position
  from public.questions
  where set_id = 'free-sampler'
)
update public.questions q
set sort_order = o.position
from ordered o
where o.id = q.id;


-- ---------------------------------------------------------------------
--  4. Say what it now is.
--
--  question_count is not set here — the questions_count_sync trigger
--  has already maintained it for every set touched above.
-- ---------------------------------------------------------------------
update public.question_sets
set title       = 'Free Math Practice',
    description = 'Fifty questions across all four math domains. Free for everyone.',
    sort_order  = 0
where id = 'free-sampler';

commit;


-- Expect: free-sampler = 50, no free-diagnostic row, paid sets reduced.
select id, title, is_free, question_count, sort_order
from public.question_sets
order by is_free desc, sort_order;
