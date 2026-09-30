#!/usr/bin/env python3
"""
Convert the OnwardSAT iOS question packs into SQL for the KatSAT database.

    python3 scripts/import-onward.py --packs /path/to/OnwardSAT/AssetPacks \
                                     --level strict \
                                     --out supabase/seed-onward.sql

--level selects how much editorial filtering to apply on import:

  all       import every question in the packs
  moderate  skip items that would not render correctly
  strict    additionally require a distinct explanation per item

Run with --report to see the counts without writing any SQL.

Shape of the source records:
    id, domain, skill, difficulty, passage, prompt,
    choices[4], answer (index), explanation,
    sourceTitle, sourceURL, sourceYear
"""

import argparse
import collections
import json
import pathlib
import re
import sys

#  folder -> (slug, title, subject)
PACKS = {
    "MathAlgebra":              ("algebra", "Algebra", "math"),
    "MathAdvanced":             ("advanced-math", "Advanced Math", "math"),
    "MathGeometryTrigonometry": ("geometry-trig", "Geometry & Trigonometry", "math"),
    "MathProblemSolvingData":   ("problem-solving", "Problem-Solving & Data", "math"),
    "InformationIdeas":         ("info-ideas", "Information & Ideas", "reading-writing"),
    "CraftStructure":           ("craft-structure", "Craft & Structure", "reading-writing"),
    "ExpressionIdeas":          ("expression-ideas", "Expression of Ideas", "reading-writing"),
    "StandardEnglish":          ("standard-english", "Standard English", "reading-writing"),
}

BLURB = {
    "algebra":          "Linear equations, systems, inequalities, and functions.",
    "advanced-math":    "Quadratics, exponentials, radicals, and nonlinear systems.",
    "geometry-trig":    "Angles, triangles, circles, area, volume, and trig ratios.",
    "problem-solving":  "Ratios, percentages, probability, and data analysis.",
    "info-ideas":       "Central ideas, inferences, and command of evidence.",
    "craft-structure":  "Words in context, text structure, and cross-text connections.",
    "expression-ideas": "Rhetorical synthesis and transitions.",
    "standard-english": "Boundaries, agreement, and sentence structure.",
}

LABELS = ["A", "B", "C", "D"]
CHUNK = 250         # questions per set — one domain, sold whole
PRICE_CENTS = 500   # per set
FREE_SET_SIZE = 8


def norm(s):
    return " ".join((s or "").split()).lower()


def load(packs_dir, subject):
    """Read every pack for `subject`. Missing packs are skipped rather than
    fatal, so a bank that only ships one subject still imports."""
    out = []
    for folder, (slug, _title, subj) in PACKS.items():
        if subj != subject:
            continue
        path = packs_dir / folder / "questions.json"
        if not path.exists():
            print(f"  (no pack at {folder}, skipping)", file=sys.stderr)
            continue
        for q in json.loads(path.read_text()):
            out.append((slug, q))
    if not out:
        sys.exit(f"no {subject} packs found under {packs_dir}")
    return out


def build_reasons(all_q, level, subject):
    """Return a function mapping a question to its rejection reasons."""
    exc = collections.Counter(norm(q["explanation"]) for _, q in all_q)
    chc = collections.Counter(norm(" | ".join(q.get("choices") or [])) for _, q in all_q)

    def reasons(q):
        r = []
        choices = [c.lower() for c in q.get("choices") or []]
        passage = norm(q.get("passage"))

        # Grid-in (student-produced response) items carry acceptedAnswers
        # instead of choices. The app renders multiple choice only, so they
        # are held back until it grows a numeric input.
        if not q.get("choices"):
            r.append("grid-in-unsupported")
            return r

        # Unusable at any level — the question cannot be rendered or graded.
        if not isinstance(q.get("answer"), int) or not (0 <= q["answer"] < len(q["choices"])):
            r.append("bad-answer-index")
        if len(q["choices"]) != 4:
            r.append("not-four-choices")
        if level == "all":
            return r

        # Reading-only checks. Math passages are legitimately terse
        # ("A rectangle has length 9 and width 4."), so a length floor
        # would throw out perfectly good items.
        if subject == "reading-writing":
            # Choices discuss "the second text" but only one text is shown.
            if any(("second text" in c or "two texts" in c) for c in choices) \
               and "text 1" not in passage:
                r.append("phantom-second-text")
            if len(passage.split()) < 12:
                r.append("passage-too-short")
        if level == "moderate":
            return r

        # Editorial bar: require a distinct explanation and choice set.
        if exc[norm(q["explanation"])] > 10:
            r.append("shared-explanation")
        if chc[norm(" | ".join(q.get("choices") or []))] > 10:
            r.append("shared-choice-set")
        return r

    return reasons


def sql_str(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def deterministic_uuid(slug, qid):
    """Stable id so re-running the import updates rather than duplicates."""
    import hashlib
    h = hashlib.sha1(f"onward:{slug}:{qid}".encode()).hexdigest()
    # format as a v4-shaped uuid; uniqueness comes from the hash
    return f"{h[0:8]}-{h[8:12]}-4{h[13:16]}-8{h[17:20]}-{h[20:32]}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--packs", required=True, type=pathlib.Path)
    ap.add_argument("--subject", choices=["math", "reading-writing"], default="math")
    ap.add_argument("--level", choices=["all", "moderate", "strict"], default="strict")
    ap.add_argument("--out", type=pathlib.Path)
    ap.add_argument("--out-dir", type=pathlib.Path,
                    help="write one SQL file per set (recommended: pastes stay small)")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--chunk", type=int, default=CHUNK,
                    help=f"questions per paid set (default {CHUNK})")
    ap.add_argument("--price", type=int, default=PRICE_CENTS,
                    help=f"price per set in cents (default {PRICE_CENTS})")
    ap.add_argument("--free-size", type=int, default=FREE_SET_SIZE,
                    help=f"questions in the free sampler (default {FREE_SET_SIZE})")
    args = ap.parse_args()

    all_q = load(args.packs, args.subject)
    reasons = build_reasons(all_q, args.level, args.subject)

    kept, tally = [], collections.Counter()
    for slug, q in all_q:
        r = reasons(q)
        for x in r:
            tally[x] += 1
        if not r:
            kept.append((slug, q))

    print(f"source questions : {len(all_q)}", file=sys.stderr)
    for k, v in tally.most_common():
        print(f"  rejected {v:5}  {k}", file=sys.stderr)
    print(f"kept             : {len(kept)}  (level={args.level})", file=sys.stderr)

    by_slug = collections.defaultdict(list)
    for slug, q in kept:
        by_slug[slug].append(q)
    for slug in by_slug:
        # Easy first so a set eases the student in.
        order = {"Easy": 0, "Medium": 1, "Hard": 2}
        by_slug[slug].sort(key=lambda q: (order.get(q["difficulty"], 9), q["id"]))

    # Free sampler: spread across domains, easy-to-medium.
    free = []
    for slug, qs in by_slug.items():
        picks = [q for q in qs if q["difficulty"] in ("Easy", "Medium")][:max(1, args.free_size // 4)]
        free.extend((slug, q) for q in picks)
    free = free[:args.free_size]
    free_ids = {(slug, q["id"]) for slug, q in free}

    sets, rows = [], []
    sets.append(dict(id="free-sampler", title="Free Sampler",
                     description="Eight questions across all four domains. Free for everyone.",
                     subject=args.subject, is_free=True, price=0, order=0))
    for slug, q in free:
        rows.append(("free-sampler", slug, q))

    order_n = 1
    for folder, (slug, title, subj) in PACKS.items():
        if subj != args.subject:
            continue
        pool = [q for q in by_slug.get(slug, []) if (slug, q["id"]) not in free_ids]
        n_chunks = max(1, (len(pool) + args.chunk - 1) // args.chunk)
        for i in range(0, len(pool), args.chunk):
            chunk = pool[i:i + args.chunk]
            if len(chunk) < 5:      # too small to sell
                continue
            set_id = f"{slug}-{i // args.chunk + 1:02d}"
            sets.append(dict(
                id=set_id,
                # Only number the title when a domain splits into parts.
                title=title if n_chunks == 1 else f"{title} {i // args.chunk + 1}",
                description=BLURB[slug],
                subject=args.subject,
                is_free=False, price=args.price, order=order_n))
            order_n += 1
            for q in chunk:
                rows.append((set_id, slug, q))

    print(f"sets             : {len(sets)}", file=sys.stderr)
    print(f"questions written: {len(rows)}", file=sys.stderr)

    if args.report or not (args.out or args.out_dir):
        return

    def sets_sql():
        o = [
            "-- Sets. Run this FIRST — the question files reference these rows.",
            "begin;",
            "",
            "delete from public.question_sets where id in (",
            "  " + ", ".join(sql_str(s["id"]) for s in sets),
            ");",
            "",
            "insert into public.question_sets",
            "  (id, title, description, subject, is_free, price_cents, sort_order) values",
        ]
        vals = ["  ({}, {}, {}, {}, {}, {}, {})".format(
            sql_str(s["id"]), sql_str(s["title"]), sql_str(s["description"]),
            sql_str(s["subject"]), "true" if s["is_free"] else "false",
            s["price"], s["order"]) for s in sets]
        o.append(",\n".join(vals) + ";")
        o += ["", "commit;", ""]
        return "\n".join(o)

    def questions_sql(subset, header):
        o = [f"-- {header}", "begin;", "",
             "insert into public.questions",
             "  (id, set_id, sort_order, passage, stem, choices, difficulty,",
             "   source_title, source_url, source_year) values"]
        vals = []
        for n, (set_id, slug, q) in enumerate(subset):
            choices = [{"label": LABELS[i], "text": c} for i, c in enumerate(q["choices"])]
            vals.append("  ({}, {}, {}, {}, {}, {}, {}, {}, {}, {})".format(
                sql_str(deterministic_uuid(slug, q["id"])), sql_str(set_id), n,
                sql_str(q.get("passage")), sql_str(q["prompt"]),
                sql_str(json.dumps(choices, ensure_ascii=False)) + "::jsonb",
                sql_str((q.get("difficulty") or "").lower() or None),
                sql_str(q.get("sourceTitle")), sql_str(q.get("sourceURL")),
                q.get("sourceYear") if isinstance(q.get("sourceYear"), int) else "null"))
        o.append(",\n".join(vals) + ";")
        o += ["", "insert into public.question_keys (question_id, correct_choice, explanation) values"]
        vals = ["  ({}, {}, {})".format(
            sql_str(deterministic_uuid(slug, q["id"])),
            sql_str(LABELS[q["answer"]]), sql_str(q.get("explanation")))
            for set_id, slug, q in subset]
        o.append(",\n".join(vals) + ";")
        o += ["", "commit;", ""]
        return "\n".join(o)

    # One file per set keeps every paste comfortably under ~250 KB.
    if args.out_dir:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        for old in args.out_dir.glob("*.sql"):
            old.unlink()
        (args.out_dir / "00-sets.sql").write_text(sets_sql())
        print(f"wrote {args.out_dir}/00-sets.sql", file=sys.stderr)
        for n, s in enumerate(sets, start=1):
            subset = [r for r in rows if r[0] == s["id"]]
            if not subset:
                continue
            path = args.out_dir / f"{n:02d}-{s['id']}.sql"
            path.write_text(questions_sql(subset, f"{s['title']} — {len(subset)} questions"))
            print(f"wrote {path}  ({len(subset)} questions, "
                  f"{path.stat().st_size // 1024} KB)", file=sys.stderr)
        return

    out = []
    out.append("-- =====================================================================")
    out.append("--  KatSAT question bank, imported from the OnwardSAT iOS packs.")
    out.append(f"--  Generated by scripts/import-onward.py --level {args.level}")
    out.append("--  Do not hand-edit; re-run the script instead.")
    out.append("--")
    out.append("--  Ids are derived from the source pack + question id, so re-running")
    out.append("--  this file updates existing rows rather than duplicating them.")
    out.append("-- =====================================================================")
    out.append("")
    out.append("begin;")
    out.append("")
    out.append("-- Remove any previous import, leaving hand-made sets alone.")
    out.append("delete from public.question_sets where id like 'onward-%' or id in (")
    out.append("  " + ", ".join(sql_str(s["id"]) for s in sets))
    out.append(");")
    out.append("")

    out.append("insert into public.question_sets")
    out.append("  (id, title, description, subject, is_free, price_cents, sort_order) values")
    vals = []
    for s in sets:
        vals.append("  ({}, {}, {}, {}, {}, {}, {})".format(
            sql_str(s["id"]), sql_str(s["title"]), sql_str(s["description"]),
            sql_str(s["subject"]), "true" if s["is_free"] else "false",
            s["price"], s["order"]))
    out.append(",\n".join(vals) + ";")
    out.append("")

    out.append("insert into public.questions")
    out.append("  (id, set_id, sort_order, passage, stem, choices, difficulty,")
    out.append("   source_title, source_url, source_year) values")
    vals = []
    for n, (set_id, slug, q) in enumerate(rows):
        choices = [{"label": LABELS[i], "text": c} for i, c in enumerate(q["choices"])]
        vals.append("  ({}, {}, {}, {}, {}, {}, {}, {}, {}, {})".format(
            sql_str(deterministic_uuid(slug, q["id"])),
            sql_str(set_id), n,
            sql_str(q.get("passage")),
            sql_str(q["prompt"]),
            sql_str(json.dumps(choices, ensure_ascii=False)) + "::jsonb",
            sql_str((q.get("difficulty") or "").lower() or None),
            sql_str(q.get("sourceTitle")),
            sql_str(q.get("sourceURL")),
            q.get("sourceYear") if isinstance(q.get("sourceYear"), int) else "null"))
    out.append(",\n".join(vals) + ";")
    out.append("")

    out.append("insert into public.question_keys (question_id, correct_choice, explanation) values")
    vals = []
    for set_id, slug, q in rows:
        vals.append("  ({}, {}, {})".format(
            sql_str(deterministic_uuid(slug, q["id"])),
            sql_str(LABELS[q["answer"]]),
            sql_str(q.get("explanation"))))
    out.append(",\n".join(vals) + ";")
    out.append("")
    out.append("commit;")
    out.append("")

    args.out.write_text("\n".join(out))
    print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
