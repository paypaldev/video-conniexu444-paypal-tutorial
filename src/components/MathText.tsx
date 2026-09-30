// ---------------------------------------------------------------------
//  Question text with typeset maths in it.
//
//  Stems and choices are plain text with LaTeX between dollar signs:
//
//      Simplify $\frac{x^2}{y^2} + \frac{x}{y^3}$
//
//  Two decisions worth knowing about.
//
//  1. The database stores LaTeX, never HTML. Anything from Postgres is
//     parsed by KaTeX rather than trusted as markup, so a question can
//     describe a fraction but cannot inject a script tag. That is the
//     same rule the banner follows — see BannerMessage in AppContext.
//     `trust: false` (KaTeX's default, set explicitly here because it is
//     load-bearing) additionally refuses \href and \url.
//
//  2. MathML output, not KaTeX's HTML output. Browsers render MathML
//     natively, which means no stylesheet and no webfonts to ship — the
//     HTML renderer would need ~20 font files copied into public/ and a
//     CSS file whose URLs have to survive the build. Fractions, powers
//     and radicals are exactly what MathML is good at.
// ---------------------------------------------------------------------

import katex from 'katex';
import { useEffect, useRef } from 'react';

interface Segment {
  kind: 'text' | 'math';
  value: string;
}

/**
 * Prose that happens to sit between two dollar amounts.
 *
 * "a shirt costs $12 and a hat costs $8" contains a matched pair of
 * dollar signs, and reading the middle as LaTeX would turn a word
 * problem into gibberish. Two consecutive three-letter-plus words is
 * something no expression in this bank does — `x = 5`, `102\%` and
 * `\frac{x^2}{y^3}` all pass through untouched — but it is exactly what
 * a sentence looks like.
 *
 * Prices are common in SAT questions, so this needs to be right without
 * relying on whoever writes the next question remembering to escape.
 */
const LOOKS_LIKE_PROSE = /[A-Za-z]{3,}\s+[A-Za-z]{3,}/;

/**
 * Split a string into text and maths segments on `$…$`.
 *
 * Hand-rolled rather than a regex because the obvious pattern needs
 * lookbehind to skip an escaped `\$`, and a lookbehind literal is a
 * parse error — not a runtime one — in Safari before 16.4. At module
 * scope that takes the whole bundle down: a blank page rather than a
 * missing fraction, on exactly the hand-me-down iPhones a student is
 * likely to be revising on.
 *
 * Exported for the tests; the parsing is the fiddly half.
 */
export function splitMath(source: string): Segment[] {
  const segments: Segment[] = [];
  let text = '';
  let index = 0;

  const flushText = () => {
    if (text) segments.push({ kind: 'text', value: text });
    text = '';
  };

  while (index < source.length) {
    const char = source[index]!;

    // An escaped dollar is literal — "\$40" shows as "$40".
    if (char === '\\' && source[index + 1] === '$') {
      text += '$';
      index += 2;
      continue;
    }

    if (char !== '$') {
      text += char;
      index += 1;
      continue;
    }

    // Look for the closing delimiter, skipping escaped ones.
    let close = index + 1;
    while (close < source.length) {
      if (source[close] === '\\' && source[close + 1] === '$') {
        close += 2;
        continue;
      }
      if (source[close] === '$') break;
      close += 1;
    }

    const body = source.slice(index + 1, close);

    // Unclosed, empty, or a sentence between two prices: not maths.
    if (close >= source.length || body === '' || LOOKS_LIKE_PROSE.test(body)) {
      text += char;
      index += 1;
      continue;
    }

    flushText();
    segments.push({ kind: 'math', value: body.replace(/\\\$/g, '$') });
    index = close + 1;
  }

  flushText();
  return segments;
}

function MathSpan({ latex }: { latex: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    try {
      katex.render(latex, el, {
        output: 'mathml',
        // Never build a link or run a macro from database content.
        trust: false,
        // Render what it can rather than blanking the question: a
        // student meeting a typo in one symbol should still see the
        // rest of the expression.
        throwOnError: false,
        displayMode: false,
      });
    } catch {
      // KaTeX still throws for a few malformed inputs even with
      // throwOnError off. The raw LaTeX is a poor answer but a readable
      // one, and it is better than an empty stem.
      el.textContent = latex;
    }
  }, [latex]);

  // The fallback text is what a reader without MathML support gets, and
  // what shows for the instant before the effect runs.
  return <span className="math" ref={ref}>{latex}</span>;
}

/**
 * Render a string that may contain `$…$` maths.
 *
 * Safe to use on any question field; a string with no dollar signs comes
 * out as plain text and costs nothing.
 */
export function MathText({ children }: { children: string }) {
  const segments = splitMath(children);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'math' ? (
          <MathSpan key={index} latex={segment.value} />
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <span key={index}>{segment.value}</span>
        )
      )}
    </>
  );
}
