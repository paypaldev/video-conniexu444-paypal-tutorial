// ---------------------------------------------------------------------
//  Domain types.
//
//  These mirror supabase/schema.sql. If you change a column there, change
//  it here — nothing checks the two against each other automatically, and
//  a drift shows up as a runtime undefined rather than a type error.
//
//  Note what is deliberately absent: there is no type for an answer key.
//  question_keys is unreachable from the browser (RLS on, no policy), and
//  the only way a correct answer reaches the client is as the return value
//  of submit_attempt() — modelled as SubmitAttemptResult below.
//
//  ---------------------------------------------------------------------
//  Why `type` and not `interface` below
//
//  Every type that feeds the Database generic MUST be a type alias.
//  Supabase constrains table rows to Record<string, unknown>, and an
//  interface does not get an implicit index signature, so it fails that
//  constraint. The failure is silent: the schema is rejected, and every
//  .from() and .rpc() result quietly degrades to `never` instead of
//  raising an error where the mistake actually is. Declaring these as
//  interfaces costs you the entire point of the Database generic.
// ---------------------------------------------------------------------

/**
 * KatSAT is math-only. The union is kept as a union rather than
 * collapsed to a string literal so adding a subject later is a one-line
 * change here plus widening question_sets_subject_check in Postgres.
 */
export type Subject = 'math';

/** A row of public.question_sets. Metadata is world-readable by design. */
export type QuestionSet = {
  id: string;
  title: string;
  description: string | null;
  subject: Subject;
  is_free: boolean;
  price_cents: number;
  /** Denormalised by a trigger — RLS hides the rows, so the browser
   *  cannot count them itself. */
  question_count: number;
  sort_order: number;
};

/** One answer option. Stored as jsonb on public.questions.choices. */
export type Choice = {
  label: string;
  text: string;
};

/** A row of public.questions. Never contains the correct answer. */
export type Question = {
  id: string;
  passage: string | null;
  stem: string;
  /** jsonb — arrives parsed from PostgREST, but a hand-seeded row can
   *  still hand back a string, so callers must tolerate both. */
  choices: Choice[] | string;
  sort_order: number;
};

/** Return value of public.submit_attempt(). */
export type SubmitAttemptResult = {
  is_correct: boolean;
  correct_choice: string;
  explanation: string | null;
};

/** Return row of public.my_progress(). Counts arrive as bigint, which
 *  PostgREST serialises as a string. */
export type ProgressRow = {
  set_id: string;
  answered: number | string;
  correct: number | string;
};

/** Per-set progress once normalised into numbers. */
export type Progress = {
  answered: number;
  correct: number;
};

/** Return row of public.my_profile(). */
export type Profile = {
  id: string;
  email: string | null;
  /** Null only for the moment between signup and the trigger landing. */
  username: string | null;
  created_at: string;
};

/** Return row of public.my_activity(). Counts arrive as bigint, which
 *  PostgREST serialises as a string. `day` is a date — 'YYYY-MM-DD' with
 *  no time and no zone, already grouped in the student's own timezone. */
export type ActivityRow = {
  day: string;
  answered: number | string;
  correct: number | string;
};

/** One day of activity once normalised into numbers. */
export type ActivityDay = {
  /** 'YYYY-MM-DD' in the student's local timezone. */
  day: string;
  answered: number;
  correct: number;
};

// ---------------------------------------------------------------------
//  Supabase schema generic.
//
//  Passing this to createClient is what makes .from() and .rpc() return
//  real types instead of any. Only the surface this app actually touches
//  is modelled; unused tables are intentionally omitted.
// ---------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      question_sets: {
        Row: QuestionSet;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      questions: {
        Row: Question & { set_id: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // Zero-argument functions must use Record<PropertyKey, never>, not
      // Record<string, never> — the latter collapses Returns to never.
      my_sets: {
        Args: Record<PropertyKey, never>;
        Returns: { set_id: string }[];
      };
      my_progress: {
        Args: Record<PropertyKey, never>;
        Returns: ProgressRow[];
      };
      my_profile: {
        Args: Record<PropertyKey, never>;
        Returns: Profile[];
      };
      set_my_username: {
        Args: { p_username: string };
        Returns: string;
      };
      my_activity: {
        Args: { p_tz: string; p_days: number };
        Returns: ActivityRow[];
      };
      my_answered: {
        Args: { p_set_id: string };
        Returns: { question_id: string }[];
      };
      submit_attempt: {
        Args: { p_question_id: string; p_choice: string };
        Returns: SubmitAttemptResult;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
