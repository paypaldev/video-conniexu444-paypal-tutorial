-- =====================================================================
--  Migration 003 — source attribution on questions
--
--  The OnwardSAT bank cites the article each passage was built from
--  (NASA, Smithsonian, and similar). Keeping the citation lets the app
--  show students where a passage came from, which is both good practice
--  and useful if a passage is ever challenged.
--
--  Run once in the SQL Editor. Safe to re-run.
-- =====================================================================

alter table public.questions
  add column if not exists source_title text,
  add column if not exists source_url   text,
  add column if not exists source_year  int;
