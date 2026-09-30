// ---------------------------------------------------------------------
//  Splitting question text into prose and maths.
//
//  Two hazards drive most of these cases:
//
//    * SAT questions are full of prices. "$40" is currency, not the
//      start of an expression, and two prices in one question used to
//      make the sentence between them render as LaTeX.
//    * The delimiters must be found without regex lookbehind, which is
//      a parse error in Safari before 16.4 and would blank the page.
// ---------------------------------------------------------------------

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitMath } from '../src/components/MathText.js';

const text = (value: string) => ({ kind: 'text', value });
const math = (value: string) => ({ kind: 'math', value });

describe('splitMath', () => {
  it('leaves plain text alone', () => {
    assert.deepEqual(splitMath('What is the value of x?'), [
      text('What is the value of x?'),
    ]);
  });

  it('extracts an expression', () => {
    assert.deepEqual(splitMath(String.raw`Simplify $\frac{x}{y}$`), [
      text('Simplify '),
      math(String.raw`\frac{x}{y}`),
    ]);
  });

  it('handles maths in the middle of a sentence', () => {
    assert.deepEqual(splitMath('If $x = 5$ then what?'), [
      text('If '),
      math('x = 5'),
      text(' then what?'),
    ]);
  });

  it('handles two expressions in one line', () => {
    assert.deepEqual(splitMath('$a$ and $b$'), [math('a'), text(' and '), math('b')]);
  });

  it('accepts expressions that are just a number or a symbol', () => {
    assert.deepEqual(splitMath('is $3$ prime'), [text('is '), math('3'), text(' prime')]);
    assert.deepEqual(splitMath(String.raw`is $102\%$ of it`), [
      text('is '),
      math(String.raw`102\%`),
      text(' of it'),
    ]);
  });

  it('keeps a lone price as text', () => {
    const stem = 'After a 20% discount, a jacket costs $40. What was the original price?';
    assert.deepEqual(splitMath(stem), [text(stem)]);
  });

  it('keeps a sentence between two prices as text', () => {
    // The case that would otherwise render a word problem as gibberish.
    const stem = 'A shirt costs $12 and a hat costs $8.';
    assert.deepEqual(splitMath(stem), [text(stem)]);
  });

  it('treats an escaped dollar as a literal one', () => {
    assert.deepEqual(splitMath(String.raw`It costs \$40 total`), [
      text('It costs $40 total'),
    ]);
  });

  it('does not swallow the rest of a question on an unclosed delimiter', () => {
    assert.deepEqual(splitMath('costs $40'), [text('costs $40')]);
  });

  it('ignores an empty expression', () => {
    assert.deepEqual(splitMath('a $$ b'), [text('a $$ b')]);
  });

  it('mixes an escaped price with real maths', () => {
    assert.deepEqual(splitMath(String.raw`Costs \$5. Solve $x^2 = 9$`), [
      text('Costs $5. Solve '),
      math('x^2 = 9'),
    ]);
  });

  it('does not mistake a spaced equation for prose', () => {
    assert.deepEqual(splitMath('$x + y = 12$'), [math('x + y = 12')]);
  });
});
