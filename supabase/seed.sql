-- =====================================================================
--  SAT Prep — sample content
--  Run AFTER schema.sql. Safe to re-run (it deletes and reinserts).
--
--  These are original placeholder questions written in SAT style, not
--  real College Board items. Replace them with the bank from your iOS
--  app — that content is the actual value here.
-- =====================================================================

delete from public.question_keys;
delete from public.questions;
delete from public.question_sets;

insert into public.question_sets
  (id, title, description, subject, is_free, price_cents, sort_order) values
  ('free-diagnostic', 'Diagnostic Mini-Set',
   'Six mixed questions to see where you stand. Free for everyone.',
   'mixed', true, 0, 1),
  ('algebra-drill', 'Algebra: Linear & Quadratic',
   'Heart-of-algebra drilling — solving, systems, and function notation.',
   'math', false, 500, 2),
  ('reading-evidence', 'Reading: Evidence & Inference',
   'Main idea, logical completion, and words in context.',
   'reading-writing', false, 500, 3);


-- ---------------------------------------------------------------------
--  FREE SET — free-diagnostic
-- ---------------------------------------------------------------------
insert into public.questions (id, set_id, sort_order, passage, stem, choices, difficulty) values
('a1000000-0000-4000-8000-000000000001', 'free-diagnostic', 1, null,
 'If 3x + 7 = 22, what is the value of 6x + 5?',
 '[{"label":"A","text":"30"},{"label":"B","text":"35"},{"label":"C","text":"40"},{"label":"D","text":"47"}]',
 'easy'),

('a1000000-0000-4000-8000-000000000002', 'free-diagnostic', 2, null,
 'A line in the xy-plane passes through the points (2, 5) and (6, 17). What is the slope of the line?',
 '[{"label":"A","text":"2"},{"label":"B","text":"3"},{"label":"C","text":"4"},{"label":"D","text":"6"}]',
 'easy'),

('a1000000-0000-4000-8000-000000000003', 'free-diagnostic', 3, null,
 'After a 20% discount, a jacket costs $40. What was the original price?',
 '[{"label":"A","text":"$48"},{"label":"B","text":"$50"},{"label":"C","text":"$52"},{"label":"D","text":"$60"}]',
 'medium'),

('a1000000-0000-4000-8000-000000000004', 'free-diagnostic', 4, null,
 'If f(x) = 2x² − 3x + 1, what is the value of f(−2)?',
 '[{"label":"A","text":"−1"},{"label":"B","text":"3"},{"label":"C","text":"11"},{"label":"D","text":"15"}]',
 'medium'),

('a1000000-0000-4000-8000-000000000005', 'free-diagnostic', 5,
 'Octopuses are colorblind. They lack the photoreceptors that let most animals distinguish one wavelength of light from another. ______ they produce some of the most precise color camouflage in the animal kingdom, matching a background within seconds.',
 'Which choice completes the text with the most logical transition?',
 '[{"label":"A","text":"Therefore,"},{"label":"B","text":"Nevertheless,"},{"label":"C","text":"For example,"},{"label":"D","text":"Similarly,"}]',
 'medium'),

('a1000000-0000-4000-8000-000000000006', 'free-diagnostic', 6,
 'The committee''s report was hardly ______: it devoted forty pages to the budget while dismissing the environmental review in a single paragraph.',
 'Which choice completes the text with the most logical and precise word?',
 '[{"label":"A","text":"thorough"},{"label":"B","text":"concise"},{"label":"C","text":"partisan"},{"label":"D","text":"technical"}]',
 'medium');


insert into public.question_keys (question_id, correct_choice, explanation) values
('a1000000-0000-4000-8000-000000000001', 'B',
 '3x = 15, so x = 5, and 6(5) + 5 = 35. Faster route: 6x is just double 3x, so 6x = 30 and 6x + 5 = 35 — you never need to find x.'),

('a1000000-0000-4000-8000-000000000002', 'B',
 'Slope = (17 − 5) / (6 − 2) = 12 / 4 = 3.'),

('a1000000-0000-4000-8000-000000000003', 'B',
 '$40 is 80% of the original, so 0.80p = 40 and p = 50. Choice A is the trap: adding 20% of the *sale* price gives $48, but the discount was 20% of the *original*.'),

('a1000000-0000-4000-8000-000000000004', 'D',
 '2(−2)² − 3(−2) + 1 = 2(4) + 6 + 1 = 15. Watch the sign: −3 times −2 is +6, not −6. Choice B is what you get if you drop that sign.'),

('a1000000-0000-4000-8000-000000000005', 'B',
 'The text sets up a contrast: they cannot see color, yet they match color precisely. "Nevertheless" marks that contrast. "Therefore" and "Similarly" both imply agreement, which reverses the meaning.'),

('a1000000-0000-4000-8000-000000000006', 'A',
 'The colon introduces an explanation, and the example is lopsided coverage — forty pages versus one paragraph. That is a failure of thoroughness. "Concise" would make the sentence contradict itself, since a hardly-concise report is a long one.');


-- ---------------------------------------------------------------------
--  PAID SET 1 — algebra-drill
-- ---------------------------------------------------------------------
insert into public.questions (id, set_id, sort_order, passage, stem, choices, difficulty) values
('b2000000-0000-4000-8000-000000000001', 'algebra-drill', 1, null,
 'If 2(x − 3) = 5x + 9, what is the value of x?',
 '[{"label":"A","text":"−5"},{"label":"B","text":"−3"},{"label":"C","text":"1"},{"label":"D","text":"5"}]',
 'medium'),

('b2000000-0000-4000-8000-000000000002', 'algebra-drill', 2, null,
 'In the system y = 3x − 4 and y = −x + 8, the solution is (x, y). What is the value of x + y?',
 '[{"label":"A","text":"3"},{"label":"B","text":"5"},{"label":"C","text":"8"},{"label":"D","text":"11"}]',
 'medium'),

('b2000000-0000-4000-8000-000000000003', 'algebra-drill', 3, null,
 'What is the sum of the solutions to x² − 10x + 21 = 0?',
 '[{"label":"A","text":"−10"},{"label":"B","text":"3"},{"label":"C","text":"7"},{"label":"D","text":"10"}]',
 'medium'),

('b2000000-0000-4000-8000-000000000004', 'algebra-drill', 4, null,
 'The function g is defined by g(x) = ax + b, where a and b are constants. If g(0) = 7 and g(4) = 19, what is the value of a?',
 '[{"label":"A","text":"2"},{"label":"B","text":"3"},{"label":"C","text":"4"},{"label":"D","text":"7"}]',
 'medium'),

('b2000000-0000-4000-8000-000000000005', 'algebra-drill', 5, null,
 'If 5^(2x) = 125, what is the value of x?',
 '[{"label":"A","text":"1"},{"label":"B","text":"1.5"},{"label":"C","text":"2.5"},{"label":"D","text":"3"}]',
 'hard');


insert into public.question_keys (question_id, correct_choice, explanation) values
('b2000000-0000-4000-8000-000000000001', 'A',
 'Distribute: 2x − 6 = 5x + 9. Subtract 2x: −6 = 3x + 9. Subtract 9: −15 = 3x, so x = −5.'),

('b2000000-0000-4000-8000-000000000002', 'C',
 'Set them equal: 3x − 4 = −x + 8, so 4x = 12 and x = 3. Then y = 3(3) − 4 = 5, and x + y = 8. Note the question asks for x + y, not x — answer A is the trap.'),

('b2000000-0000-4000-8000-000000000003', 'D',
 'For x² + bx + c = 0, the solutions sum to −b, which is 10 here. You can also factor: (x − 3)(x − 7) = 0 gives 3 and 7, and 3 + 7 = 10.'),

('b2000000-0000-4000-8000-000000000004', 'B',
 'g(0) = b = 7. Then g(4) = 4a + 7 = 19, so 4a = 12 and a = 3.'),

('b2000000-0000-4000-8000-000000000005', 'B',
 'Write both sides in base 5: 125 = 5³, so 5^(2x) = 5³. The exponents must match, so 2x = 3 and x = 1.5.');


-- ---------------------------------------------------------------------
--  PAID SET 2 — reading-evidence
-- ---------------------------------------------------------------------
insert into public.questions (id, set_id, sort_order, passage, stem, choices, difficulty) values
('c3000000-0000-4000-8000-000000000001', 'reading-evidence', 1,
 'For decades, ecologists assumed that the tallest trees in a forest captured most of its sunlight and therefore drove most of its growth. Recent measurements complicate that picture. In temperate forests, the mid-canopy — a dense layer of smaller trees routinely skipped in survey work — accounts for nearly forty percent of total carbon uptake.',
 'Which choice best states the main purpose of the text?',
 '[{"label":"A","text":"To describe a new method for surveying forests"},{"label":"B","text":"To present findings that revise a long-held assumption"},{"label":"C","text":"To argue that tall trees should be protected"},{"label":"D","text":"To compare temperate forests with tropical ones"}]',
 'medium'),

('c3000000-0000-4000-8000-000000000002', 'reading-evidence', 2,
 'Museums increasingly publish high-resolution scans of works in their collections free of charge. Curators initially worried the practice would give the public a reason to stay home. Instead, institutions that released scans saw in-person attendance rise, which suggests that ______',
 'Which choice most logically completes the text?',
 '[{"label":"A","text":"online access can stimulate rather than replace physical visits."},{"label":"B","text":"digital scans are a poor substitute for viewing an original."},{"label":"C","text":"attendance figures are an unreliable measure of interest."},{"label":"D","text":"museums should begin charging a fee for access to scans."}]',
 'medium'),

('c3000000-0000-4000-8000-000000000003', 'reading-evidence', 3,
 'Researchers asked 200 students to take notes on the same lecture, half by hand and half on laptops. One week later, the handwriting group recalled 28 percent more conceptual detail than the typing group. Verbatim recall of specific phrases was similar across both groups.',
 'Which claim is best supported by the data described?',
 '[{"label":"A","text":"Handwriting notes improves later recall of concepts."},{"label":"B","text":"Typing notes allows students to record more material."},{"label":"C","text":"Handwriting notes improves every form of recall."},{"label":"D","text":"The method of note-taking has little effect on learning."}]',
 'hard'),

('c3000000-0000-4000-8000-000000000004', 'reading-evidence', 4,
 'The novelist''s late style is remarkably ______: sentences that once ran half a page contract to four or five words.',
 'Which choice completes the text with the most logical and precise word?',
 '[{"label":"A","text":"ornate"},{"label":"B","text":"austere"},{"label":"C","text":"ambivalent"},{"label":"D","text":"derivative"}]',
 'hard'),

('c3000000-0000-4000-8000-000000000005', 'reading-evidence', 5,
 'Solar panel efficiency has improved steadily for thirty years. ______ the cost per watt has fallen faster than gains in efficiency alone would predict, largely because manufacturing has scaled up.',
 'Which choice completes the text with the most logical transition?',
 '[{"label":"A","text":"In contrast,"},{"label":"B","text":"However,"},{"label":"C","text":"Moreover,"},{"label":"D","text":"Consequently,"}]',
 'medium');


insert into public.question_keys (question_id, correct_choice, explanation) values
('c3000000-0000-4000-8000-000000000001', 'B',
 'The structure is: old assumption, then "Recent measurements complicate that picture," then the finding. That is a revision of received wisdom. A is wrong because the survey method is mentioned only in passing, not described.'),

('c3000000-0000-4000-8000-000000000002', 'A',
 'The evidence is that scans went up and attendance also went up. That undercuts the fear of substitution and supports complementarity. B and C contradict the finding rather than following from it.'),

('c3000000-0000-4000-8000-000000000003', 'A',
 'The measured difference was specifically in conceptual detail. C overreaches — verbatim recall was explicitly similar, so "every form of recall" is contradicted by the passage. B is never measured.'),

('c3000000-0000-4000-8000-000000000004', 'B',
 'The colon defines the word: sentences shrinking from half a page to five words is severe plainness. "Austere" means stripped-down and unadorned. "Ornate" is the exact opposite.'),

('c3000000-0000-4000-8000-000000000005', 'C',
 'Both sentences describe good news for solar, and the second adds a further, stronger point. "Moreover" signals addition. "However" and "In contrast" would wrongly imply the second fact opposes the first.');
