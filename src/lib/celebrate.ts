// ---------------------------------------------------------------------
//  Celebration on a correct answer.
//
//  Kept deliberately brief — this fires dozens of times in a session, and
//  anything longer than about half a second starts costing the student
//  time rather than giving them a lift. All of it is motion only, so
//  nothing here is load-bearing for understanding the result.
//
//  Stays imperative rather than becoming a component: it is a
//  fire-and-forget flourish appended to document.body and removed a
//  second later. Modelling that as React state would mean tracking
//  particles that no other part of the UI cares about.
// ---------------------------------------------------------------------

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

const PALETTE = ['#1c6b46', '#1c5c4c', '#8fbfa6', '#c9a227', '#e8b4a0'] as const;
const COUNT = 14;

export function celebrate(anchorEl: HTMLElement | null): void {
  if (!anchorEl || REDUCED_MOTION.matches) return;

  const rect = anchorEl.getBoundingClientRect();
  const wrap = document.createElement('div');
  wrap.className = 'burst';
  wrap.style.left = rect.left + rect.width / 2 + 'px';
  wrap.style.top = rect.top + rect.height / 2 + 'px';

  for (let i = 0; i < COUNT; i += 1) {
    const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.5;
    const dist = 44 + Math.random() * 44;
    const p = document.createElement('i');
    p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
    p.style.background = PALETTE[i % PALETTE.length] ?? PALETTE[0];
    p.style.animationDelay = Math.random() * 60 + 'ms';
    wrap.appendChild(p);
  }

  document.body.appendChild(wrap);
  window.setTimeout(() => wrap.remove(), 1000);
}

/** Only from two in a row, so the streak chip actually means something. */
export function pickPraise(streak: number): string {
  if (streak >= 5) return 'On a roll!';
  if (streak >= 3) return 'Nice streak!';
  const words = ['Correct!', 'Nailed it!', 'Yes!', 'Got it!'] as const;
  return words[Math.floor(Math.random() * words.length)] ?? 'Correct!';
}
