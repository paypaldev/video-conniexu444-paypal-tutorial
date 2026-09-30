-- =====================================================================
--  Migration 005 — math-only site
--
--  Removes every reading & writing set and reduces the free set to its
--  math questions, so the site offers one subject.
--
--  DESTRUCTIVE. Deleting a question_set cascades to its questions, their
--  answer keys, any attempts against them, and any entitlements granting
--  access to them. Read the summary at the bottom before running.
--
--  Run once in the SQL Editor.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  1. Drop the reading & writing sets.
--     These are the four imported domain packs (currently empty), the
--     free sampler drawn from them, and the placeholder reading set.
-- ---------------------------------------------------------------------
delete from public.question_sets
where subject = 'reading-writing';


-- ---------------------------------------------------------------------
--  2. Reduce the mixed free set to its math questions.
--     Its two reading items go; the four math items stay.
-- ---------------------------------------------------------------------
delete from public.questions
where set_id = 'free-diagnostic'
  and stem in (
    'Which choice completes the text with the most logical transition?',
    'Which choice completes the text with the most logical and precise word?'
  );

update public.question_sets
set subject     = 'math',
    title       = 'Free Diagnostic',
    description = 'Four questions to see where you stand. Free for everyone.'
where id = 'free-diagnostic';


-- ---------------------------------------------------------------------
--  3. Stop new reading & writing sets being created by accident.
--     The subject column keeps its check constraint but is narrowed to
--     math. Widen it again if the site ever adds another subject.
-- ---------------------------------------------------------------------
alter table public.question_sets
  drop constraint if exists question_sets_subject_check;
alter table public.question_sets
  add constraint question_sets_subject_check
  check (subject = 'math');


commit;


-- ---------------------------------------------------------------------
--  What is left afterwards:
--
--    free-diagnostic   free   4 questions
--    algebra-drill     $5     5 questions
--
--  Nine questions in total, all placeholders. This migration makes the
--  site math-only; it does not provide math content. That still needs a
--  question bank — the OnwardSAT packs contain none.
-- ---------------------------------------------------------------------
