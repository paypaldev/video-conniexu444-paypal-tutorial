// ---------------------------------------------------------------------
//  Demo mode only. Used when config/supabase.ts still has placeholders, so
//  you can look at the UI before wiring up Supabase.
//
//  Once configured, ALL content comes from the database and this file is
//  ignored. Note that the real answer keys never appear in the browser
//  like this — they stay in question_keys and are only revealed by the
//  submit_attempt() function after you answer. This file is a mock.
// ---------------------------------------------------------------------

import type { Question, QuestionSet } from './types.js';

interface DemoData {
  sets: QuestionSet[];
  questions: Record<string, Question[]>;
}

export const demoData: DemoData = {
  sets: [
    {
      id: 'free-diagnostic',
      title: 'Free Diagnostic',
      description: 'Four questions to see where you stand. Free for everyone.',
      subject: 'math',
      is_free: true,
      price_cents: 0,
      question_count: 4,
      sort_order: 1,
    },
    {
      id: 'algebra-drill',
      title: 'Algebra: Linear & Quadratic',
      description: 'Heart-of-algebra drilling — solving, systems, and function notation.',
      subject: 'math',
      is_free: false,
      price_cents: 500,
      question_count: 5,
      sort_order: 2,
    },
  ],

  questions: {
    'free-diagnostic': [
      {
        id: 'demo-1',
        passage: null,
        stem: 'If 3x + 7 = 22, what is the value of 6x + 5?',
        sort_order: 1,
        choices: [
          { label: 'A', text: '30' },
          { label: 'B', text: '35' },
          { label: 'C', text: '40' },
          { label: 'D', text: '47' },
        ],
      },
      {
        id: 'demo-2',
        passage: null,
        stem: 'A line in the xy-plane passes through the points (2, 5) and (6, 17). What is the slope of the line?',
        sort_order: 2,
        choices: [
          { label: 'A', text: '2' },
          { label: 'B', text: '3' },
          { label: 'C', text: '4' },
          { label: 'D', text: '6' },
        ],
      },
      {
        id: 'demo-3',
        passage: null,
        stem: 'After a 20% discount, a jacket costs $40. What was the original price?',
        sort_order: 3,
        choices: [
          { label: 'A', text: '$48' },
          { label: 'B', text: '$50' },
          { label: 'C', text: '$52' },
          { label: 'D', text: '$60' },
        ],
      },
      {
        id: 'demo-4',
        passage: null,
        stem: 'If f(x) = 2x² − 3x + 1, what is the value of f(−2)?',
        sort_order: 4,
        choices: [
          { label: 'A', text: '−1' },
          { label: 'B', text: '3' },
          { label: 'C', text: '11' },
          { label: 'D', text: '15' },
        ],
      },
    ],
  },
};
