-- =====================================================================
--  Migration 012 — real notation, and more variety in the free set
--
--  Two problems with the free 50:
--
--    * No maths notation anywhere. Not one question used a fraction, an
--      exponent, or a radical — every item was phrased as prose ("The
--      equation 6x + 14 = -58 has exactly one solution"), because that
--      is all the renderer could show.
--    * Barely any variety. 50 questions shared 22 distinct stems; "What
--      is the least possible value of x?" appeared ten times and "What
--      is the value of k?" six.
--
--  This swaps those 16 repetitive items back into algebra-01 and adds 16
--  new ones written with LaTeX between dollar signs, which the app now
--  typesets: rational expressions, exponent rules, radicals, quadratics,
--  systems, absolute value, right-triangle trig, circles, volume,
--  percentages and probability.
--
--  The set stays at exactly 50.
--
--  Every answer key here was verified with sympy before the SQL was
--  written — each item's answer was recomputed from the expression
--  itself and compared against the declared key. A wrong key is worse
--  than a missing question: the student is told they are wrong when they
--  are right and has no way to appeal.
--
--  NOT safe to re-run — it would insert the 16 questions a second time.
--  Check first:
--      select count(*) from public.questions
--      where set_id = 'free-sampler' and stem like '%$%';
--  16 means this has already run.
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
--  1. Move the repetitive items back to the algebra set.
--
--  Moved, not deleted: attempts.question_id cascades on delete, so
--  removing them would erase answered history.
-- ---------------------------------------------------------------------
do $$
declare
  v_moved int;
begin
  update public.questions
  set set_id = 'algebra-01'
  where set_id = 'free-sampler'
    and stem in ('What is the least possible value of x?', 'What is the value of k?');

  get diagnostics v_moved = row_count;
  raise notice 'Moved % repetitive questions out of the free set.', v_moved;
end;
$$;


-- ---------------------------------------------------------------------
--  2. The new questions.
--
--  sort_order 900+ marks them as new so step 3 can interleave them;
--  the real positions are assigned there.
-- ---------------------------------------------------------------------

-- 1. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 901, null, 'Simplify the following: $\frac{x^2}{y^3} + \frac{x}{y^2}$',
          '[{"label": "A", "text": "$\\frac{x^2 + x}{y^3}$"}, {"label": "B", "text": "$\\frac{x^2 + xy}{y^3}$"}, {"label": "C", "text": "$\\frac{x^2 + x}{y^5}$"}, {"label": "D", "text": "$\\frac{x^3 + x}{y^3}$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'B', 'Rewrite the second fraction with denominator $y^3$: $\frac{x}{y^2} = \frac{xy}{y^3}$. Adding gives $\frac{x^2 + xy}{y^3}$.' from q;

-- 2. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 902, null, 'Which expression is equivalent to $\frac{x^2 - 9}{x^2 - x - 6}$ for $x \neq 3$ and $x \neq -2$?',
          '[{"label": "A", "text": "$\\frac{x + 3}{x + 2}$"}, {"label": "B", "text": "$\\frac{x - 3}{x + 2}$"}, {"label": "C", "text": "$\\frac{x + 3}{x - 2}$"}, {"label": "D", "text": "$\\frac{3}{2}$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'A', 'Factor both parts: $\frac{(x-3)(x+3)}{(x-3)(x+2)}$. The common factor $(x-3)$ divides out, leaving $\frac{x+3}{x+2}$.' from q;

-- 3. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 903, null, 'Which expression is equivalent to $\frac{x^5 y^{-2}}{x^2 y^3}$?',
          '[{"label": "A", "text": "$x^3 y^{-1}$"}, {"label": "B", "text": "$\\frac{x^3}{y}$"}, {"label": "C", "text": "$\\frac{x^3}{y^5}$"}, {"label": "D", "text": "$x^7 y^5$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'C', 'Subtract exponents on matching bases: $x^{5-2} = x^3$ and $y^{-2-3} = y^{-5}$. So the result is $x^3 y^{-5} = \frac{x^3}{y^5}$.' from q;

-- 4. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 904, 'Assume $x > 0$.', 'What is the value of $\left(\frac{8x^6}{27}\right)^{\frac{1}{3}}$?',
          '[{"label": "A", "text": "$\\frac{2x^3}{3}$"}, {"label": "B", "text": "$\\frac{2x^2}{3}$"}, {"label": "C", "text": "$\\frac{4x^2}{9}$"}, {"label": "D", "text": "$\\frac{8x^2}{27}$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'B', 'Take the cube root of each part: $\sqrt[3]{8} = 2$, $\sqrt[3]{x^6} = x^2$, and $\sqrt[3]{27} = 3$, giving $\frac{2x^2}{3}$.' from q;

-- 5. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 905, null, 'What is the solution to $\sqrt{3x + 1} = x - 1$?',
          '[{"label": "A", "text": "$x = 0$"}, {"label": "B", "text": "$x = 0$ and $x = 5$"}, {"label": "C", "text": "$x = -1$"}, {"label": "D", "text": "$x = 5$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'D', 'Square both sides: $3x + 1 = x^2 - 2x + 1$, so $x^2 - 5x = 0$ and $x = 0$ or $x = 5$. Check both: $x = 0$ gives $\sqrt{1} = -1$, which is false, so it is extraneous. Only $x = 5$ works.' from q;

-- 6. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 906, 'The function $f$ is defined by $f(x) = \frac{2x + 1}{x - 3}$.', 'What is the value of $f(5)$?',
          '[{"label": "A", "text": "$\\frac{11}{2}$"}, {"label": "B", "text": "$\\frac{11}{8}$"}, {"label": "C", "text": "$\\frac{9}{2}$"}, {"label": "D", "text": "$2$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'A', 'Substitute $x = 5$: the numerator is $2(5) + 1 = 11$ and the denominator is $5 - 3 = 2$, so $f(5) = \frac{11}{2}$.' from q;

-- 7. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 907, 'A parabola in the $xy$-plane is given by $y = x^2 - 6x + 5$.', 'What is the vertex of the parabola?',
          '[{"label": "A", "text": "$(-3,\\ -4)$"}, {"label": "B", "text": "$(3,\\ 4)$"}, {"label": "C", "text": "$(3,\\ -4)$"}, {"label": "D", "text": "$(6,\\ 5)$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'C', 'Complete the square: $y = (x - 3)^2 - 4$. The vertex is therefore $(3, -4)$.' from q;

-- 8. advanced-math
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 908, 'The equation $x^2 + kx + 16 = 0$ has exactly one real solution, and $k$ is positive.', 'What is the value of $k$?',
          '[{"label": "A", "text": "$4$"}, {"label": "B", "text": "$8$"}, {"label": "C", "text": "$16$"}, {"label": "D", "text": "$32$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'B', 'One real solution means the discriminant is zero: $k^2 - 4(1)(16) = 0$, so $k^2 = 64$. Since $k$ is positive, $k = 8$.' from q;

-- 9. algebra
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 909, '$2x + 3y = 12$ and $x - y = 1$.', 'What is the value of $x + y$?',
          '[{"label": "A", "text": "$1$"}, {"label": "B", "text": "$3$"}, {"label": "C", "text": "$5$"}, {"label": "D", "text": "$7$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'C', 'From the second equation $x = y + 1$. Substituting: $2(y+1) + 3y = 12$, so $5y = 10$ and $y = 2$, giving $x = 3$. Therefore $x + y = 5$.' from q;

-- 10. algebra
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 910, null, 'Which of the following describes all solutions to $|2x - 5| \leq 7$?',
          '[{"label": "A", "text": "$-1 \\leq x \\leq 6$"}, {"label": "B", "text": "$-6 \\leq x \\leq 1$"}, {"label": "C", "text": "$x \\leq -1$ or $x \\geq 6$"}, {"label": "D", "text": "$1 \\leq x \\leq 6$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'A', 'The inequality means $-7 \leq 2x - 5 \leq 7$. Adding 5 gives $-2 \leq 2x \leq 12$, and dividing by 2 gives $-1 \leq x \leq 6$.' from q;

-- 11. algebra
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 911, 'A line in the $xy$-plane passes through $(2, 5)$ and $(6, 17)$.', 'Which equation defines the line?',
          '[{"label": "A", "text": "$y = 3x + 1$"}, {"label": "B", "text": "$y = 3x - 1$"}, {"label": "C", "text": "$y = \\frac{1}{3}x + 5$"}, {"label": "D", "text": "$y = 4x - 3$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'B', 'The slope is $\frac{17 - 5}{6 - 2} = 3$. Using $(2, 5)$: $5 = 3(2) + b$, so $b = -1$ and $y = 3x - 1$.' from q;

-- 12. geometry-trig
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 912, 'In right triangle $ABC$, angle $C$ is the right angle, $AB = 13$, and $BC = 5$.', 'What is the value of $\sin A$?',
          '[{"label": "A", "text": "$\\frac{5}{13}$"}, {"label": "B", "text": "$\\frac{12}{13}$"}, {"label": "C", "text": "$\\frac{5}{12}$"}, {"label": "D", "text": "$\\frac{13}{5}$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'A', '$\sin A$ is the side opposite angle $A$ over the hypotenuse. The side opposite $A$ is $BC = 5$ and the hypotenuse is $AB = 13$, so $\sin A = \frac{5}{13}$.' from q;

-- 13. geometry-trig
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 913, 'A circle in the $xy$-plane has equation $x^2 + y^2 - 6x + 8y = 0$.', 'What is the radius of the circle?',
          '[{"label": "A", "text": "$3$"}, {"label": "B", "text": "$4$"}, {"label": "C", "text": "$5$"}, {"label": "D", "text": "$25$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'C', 'Complete the square in both variables: $(x - 3)^2 + (y + 4)^2 = 9 + 16 = 25$. The radius is $\sqrt{25} = 5$.' from q;

-- 14. geometry-trig
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 914, 'A right circular cone has radius $3$ and height $4$. The volume of a cone is $V = \frac{1}{3}\pi r^2 h$.', 'What is the volume of the cone?',
          '[{"label": "A", "text": "$4\\pi$"}, {"label": "B", "text": "$12\\pi$"}, {"label": "C", "text": "$36\\pi$"}, {"label": "D", "text": "$48\\pi$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'B', 'Substitute directly: $V = \frac{1}{3}\pi (3)^2 (4) = \frac{1}{3}\pi \cdot 36 = 12\pi$.' from q;

-- 15. problem-solving
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 915, 'The price of a jacket is increased by $20\%$, and the new price is then decreased by $15\%$.', 'The final price is what percent of the original price?',
          '[{"label": "A", "text": "$102\\%$"}, {"label": "B", "text": "$105\\%$"}, {"label": "C", "text": "$100\\%$"}, {"label": "D", "text": "$97\\%$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'A', 'Multiply the factors rather than adding the percentages: $1.20 \times 0.85 = 1.02$, so the final price is $102\%$ of the original.' from q;

-- 16. problem-solving
with q as (
  insert into public.questions (set_id, sort_order, passage, stem, choices, difficulty)
  values ('free-sampler', 916, 'A bag contains $3$ red marbles, $5$ blue marbles, and $4$ green marbles. One marble is selected at random.', 'What is the probability that the marble is not blue?',
          '[{"label": "A", "text": "$\\frac{5}{12}$"}, {"label": "B", "text": "$\\frac{1}{3}$"}, {"label": "C", "text": "$\\frac{4}{12}$"}, {"label": "D", "text": "$\\frac{7}{12}$"}]'::jsonb, 'medium')
  returning id
)
insert into public.question_keys (question_id, correct_choice, explanation)
select id, 'D', 'There are $12$ marbles in total and $5$ are blue, so $12 - 5 = 7$ are not blue. The probability is $\frac{7}{12}$.' from q;


-- ---------------------------------------------------------------------
--  3. Interleave, so the new material is visible immediately.
--
--  The new questions take positions 1, 4, 7, … and the older ones fill
--  the gaps. Appending them would bury all sixteen behind thirty-four
--  prose items, which is the complaint this migration exists to fix.
-- ---------------------------------------------------------------------
do $$
declare
  -- Captured before anything moves. Once the new questions are given
  -- their real positions they no longer look different from the old
  -- ones, so identifying them afterwards is impossible.
  v_new_ids uuid[];
  v_new     int;
  v_total   int;
begin
  select array_agg(id order by sort_order, id) into v_new_ids
  from public.questions
  where set_id = 'free-sampler' and sort_order >= 900;

  v_new := coalesce(array_length(v_new_ids, 1), 0);

  select count(*) into v_total
  from public.questions where set_id = 'free-sampler';

  if v_new = 0 then
    raise exception 'No new questions found — did step 2 run?';
  end if;

  -- Every third slot has to exist for the new items to land in.
  if 3 * v_new - 2 > v_total then
    raise exception 'Cannot interleave % new among % total.', v_new, v_total;
  end if;

  -- New items take positions 1, 4, 7, …
  update public.questions q
  set sort_order = 3 * t.idx - 2
  from unnest(v_new_ids) with ordinality as t(id, idx)
  where q.id = t.id;

  -- The rest fill whatever positions are left, keeping their order.
  with free_slots as (
    select pos, row_number() over (order by pos) as rn
    from generate_series(1, v_total) pos
    where pos not in (select 3 * i - 2 from generate_series(1, v_new) i)
  ),
  older as (
    select id, row_number() over (order by sort_order, id) as rn
    from public.questions
    where set_id = 'free-sampler'
      and not (id = any (v_new_ids))
  )
  update public.questions q
  set sort_order = s.pos
  from older o
  join free_slots s on s.rn = o.rn
  where q.id = o.id;

  raise notice 'Interleaved % new questions among % total.', v_new, v_total;
end;
$$;

commit;


-- Expect 50 questions, 16 of them containing LaTeX.
select
  (select count(*) from public.questions where set_id = 'free-sampler')                    as free_total,
  (select count(*) from public.questions where set_id = 'free-sampler' and stem like '%$%') as with_notation,
  (select count(distinct stem) from public.questions where set_id = 'free-sampler')         as distinct_stems;

select sort_order, left(stem, 58) as stem
from public.questions
where set_id = 'free-sampler'
order by sort_order
limit 10;
