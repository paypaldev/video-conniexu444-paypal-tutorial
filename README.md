# KatSAT — katsat.org


## Community / troubleshooting

Need help running this sample? Join the [PayPal Developer Discord](https://bit.ly/PayPalDev_Discord) for questions and troubleshooting.

---

> **Educational example.** This is a simplified teaching site (including the
> PayPal video / content collaboration). The checkout shows a real Orders v2
> create → capture → webhook path, but it is not a complete production
> integration and may need additional work before you take real money.
> Read [PayPal's security guidelines](https://developer.paypal.com/security-guidelines)
> and the [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit) before
> copying any of this into a live store.

A React + TypeScript static site built with esbuild, plus Supabase for auth and data.
One free question set, the rest behind a paywall, and you must be signed in
to submit an answer — including on the free set.

The output is still a plain static site: one HTML file, one CSS file, and one
bundled `app.js` loaded with an ordinary `<script>` tag. No SSR, no server.

```
src/               ← everything you edit lives here
  index.html       ← shell; React mounts into #root
  styles.css
  main.tsx         ← entry point
  App.tsx          ← view switching, set opening
  components/      ← SetList, PracticeView, dialogs, PayPalCheckout
  state/
    AppContext.tsx ← session, entitlements, progress, dialogs
  lib/             ← supabase client, api calls, errors, PayPal SDK loader
  hooks/
  config/
    supabase.ts    ← your Supabase URL + anon key go here
    paypal.ts      ← your PayPal client id + sandbox/live (public) go here
  demo-data.ts     ← sample data for demo mode only
  types.ts         ← domain types + the Supabase Database generic
public/            ← BUILD OUTPUT. Generated, gitignored, never edit.
scripts/
  build.mjs        ← esbuild bundle + static asset copy
supabase/
  schema.sql       ← tables, RLS policies, submit_attempt()
  functions/       ← PayPal Edge Functions (Deno)
```

## Run it right now

```sh
npm install
npm run dev          # builds, watches src/, serves on :8788
```

Open http://localhost:8788. With `config/supabase.ts` untouched it runs in **demo mode** —
the free set renders from local data so you can see the UI. Auth and the paid
sets need a real project.

Other commands:

```sh
npm run build        # one-off production build into public/
npm run typecheck    # tsc --noEmit, no output written
npm run check        # typecheck then build — run this before pushing
```

### A note on the type layer

`src/types.ts` defines a `Database` type that is passed to `createClient`. That
generic is what makes `.from()` and `.rpc()` return real types. Two traps are
documented in that file and worth knowing before you edit it, because **both
fail silently** — the schema is rejected and every query result degrades to
`never` rather than erroring where the mistake is:

- every type feeding `Database` must be a `type` alias, never an `interface`
- zero-argument functions need `Args: Record<PropertyKey, never>`

## Wiring up Supabase

1. Create a project at supabase.com (Free plan).
2. **SQL Editor** → paste `supabase/schema.sql` → Run.
3. **SQL Editor** → paste `supabase/seed.sql` → Run.
4. **Project Settings → Data API** → copy the Project URL and the anon
   (publishable) key into `src/config/supabase.ts`.
5. **Authentication → Sign In / Providers → Email**: turn *Confirm email* off
   while developing, or you will not be able to log in — see the email note below.

Reload. Sign up, and you should be able to work through the free set.

To test a paid set, unlock it for yourself in the SQL Editor:

```sql
insert into public.entitlements (user_id, set_id, source)
select id, 'algebra-drill', 'manual' from auth.users
where email = 'you@example.com'
on conflict do nothing;
```

Access is **per set** — a student unlocks individual sets, and there is no
account-wide upgrade. If your project was created before this change, run
`supabase/migration-002-per-set-unlocks.sql` rather than re-running the schema.

## How the paywall is actually enforced

Client-side hiding is not a paywall — anyone can open devtools. The real
enforcement is in Postgres:

| Rule | Where it lives |
|---|---|
| Sets you have not unlocked return **zero rows** | RLS policy on `public.questions` |
| Answer keys are unreadable | `question_keys` has RLS on and **no policy** |
| Must be signed in to submit | `submit_attempt()` has no `EXECUTE` grant for `anon` |
| Cannot fake a correct answer | No `INSERT` policy on `attempts`; only the function writes |
| Cannot unlock a set yourself | No `INSERT`/`UPDATE` policy on `entitlements` |

Grading happens inside `submit_attempt()`, so the correct answer is only ever
revealed *after* a student commits to a choice. Set metadata (title, description)
stays public on purpose — that is how a locked set advertises itself.

## The profile page

Reached from the student's name in the header. It shows the display name, the
current and longest practice streak, lifetime totals, a GitHub-style
contribution chart of the last year, and a per-set breakdown.

Existing projects need `supabase/migration-007-profile-page.sql` — it adds
`profiles.username` plus three functions. A fresh project gets all of it from
`schema.sql`.

| Piece | Where it lives |
|---|---|
| Read your own profile, creating the row if missing | `my_profile()` |
| Change your display name | `set_my_username()` |
| Day-by-day answer counts for the chart | `my_activity(tz, days)` |
| Streak arithmetic and the calendar grid | `src/lib/streaks.ts` |

Two things worth knowing:

- **There is no `UPDATE` policy on `profiles`.** Names change only through
  `set_my_username()`, so the browser can never write `id` or `email`. The
  function validates the shape, rejects a name already taken (case-insensitively
  — `Kat` and `kat` are the same name), and raises sentences that the UI shows
  to the student verbatim.
- **Days are grouped in the student's timezone, not UTC.** The browser sends its
  IANA zone to `my_activity()`. Answering at 8pm in Los Angeles should light up
  today's square, not tomorrow's. An unknown zone falls back to UTC rather than
  failing the page.

A streak counts consecutive days with at least one answer, and survives the
whole of the current day — someone on a thirty-day run who opens the page over
breakfast sees 30, not 0. Only a fully skipped day breaks it.

## Showing only the free sets

`src/config/catalog.ts` has `SHOW_PAID_SETS = false`, which filters the paid sets
out of the catalogue. Set it to `true` to put them back — checkout, entitlements
and the paywall dialog are all still wired up and untouched.

This is presentation only. The paywall below is what actually protects the
questions, and it stays in force either way.

## Before real students use it: SMTP

Supabase's built-in email sender is capped at **2 emails/hour** and only delivers
to addresses on your project team. Signup confirmations and password resets will
silently fail for everyone else.

Fix it before launch: create a free Resend account (3,000 emails/month), then
**Authentication → SMTP Settings** → enter the Resend credentials, and raise the
send limit under **Authentication → Rate Limits** from its default of 30/hour.

## Deploying to katsat.org

Cloudflare Pages, free tier, commercial use allowed. The domain is already on
Cloudflare, so DNS is one click rather than a nameserver change.

1. Push this repo to GitHub.
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command: **`npm run build`**. Build output directory: **`public`**.
4. Custom Domains → add `katsat.org` and `www.katsat.org`.

Because `public/` is gitignored, Cloudflare builds it from `src/` on every
deploy. That means a broken `npm run build` is now a broken deploy — run
`npm run check` before you push.

Then — and this is the step that silently breaks signups if you skip it —
point Supabase at the real domain:

**Authentication → URL Configuration**
- Site URL: `https://katsat.org`
- Redirect URLs: add `https://katsat.org/**` and `http://localhost:8788/**`

Without this, confirmation and password-reset emails send people to
`localhost:3000` and the links appear broken to every real user.

Do not buy Supabase's custom-domain add-on ($10/mo per project) — the browser
talks to the default `*.supabase.co` API URL and nobody ever sees it.

## PayPal checkout

The code is written. What is left is credentials and three dashboard steps.

### How it works

```
browser                Edge Function            PayPal          Postgres
   |  set_id  ------->  create-order
   |                      reads price from DB  --> create order
   |  <-- order id -----------------------------------            orders row
   |  approve in PayPal popup  ------------------>
   |  orderId ------->  capture-order
   |                      verifies order is yours --> capture
   |                                                            grant_entitlement()
   |  <-- unlocked -----                                         entitlements row
                       paypal-webhook  <-- PAYMENT.CAPTURE.COMPLETED
                         verifies signature                     grant_entitlement()
```

The browser loads PayPal **JavaScript SDK v6** (`https://www.sandbox.paypal.com/web-sdk/v6/core`, or `www.paypal.com` when live) and starts a one-time payment session. Create and capture still use the Orders v2 REST API in the Edge Functions — v6 did not replace that.

Capture unlocks immediately; the webhook is the backstop for when the browser
never comes back, and the only path that handles refunds. Both call the same
idempotent `grant_entitlement()`, and `entitlements.order_ref` is uniquely
indexed, so whichever arrives second is a no-op.

Two invariants hold the whole thing up:

- **Price comes from `question_sets`, never from the request body.** The browser
  sends a set id and an optional `request_id` (idempotency for the 429 retry),
  never an amount.
- **The user comes from the JWT, never from the request body.** `getCallerId()`
  in `_shared/http.ts` is the only source.

### Setting it up

1. **PayPal Business account** → Developer Dashboard → create a REST app.
   Note the **Client ID** and **Secret** (sandbox first; live has its own pair).

2. **Apply the migration.** SQL Editor → paste `supabase/migration-004-paypal-orders.sql`
   → Run. Then run the verification query at the bottom of that file — every
   column must come back `false`. If any is `true`, stop: a student could grant
   themselves every set.

3. **Set the secrets** (never in `src/`, which is bundled and served).
   Names are listed in `.env.example`; values stay in the Supabase dashboard:

   ```sh
   supabase secrets set PAYPAL_CLIENT_ID=...
   supabase secrets set PAYPAL_SECRET=...
   supabase secrets set PAYPAL_ENV=sandbox     # 'live' when you go live
   ```

4. **Deploy the functions.** `supabase/config.toml` pins JWT verification per
   function, so a plain deploy gets it right:

   ```sh
   supabase functions deploy create-order
   supabase functions deploy capture-order
   supabase functions deploy paypal-webhook
   ```

5. **Create the webhook** in the PayPal dashboard, pointing at
   `https://<project-ref>.supabase.co/functions/v1/paypal-webhook`, subscribed to
   `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, and
   `PAYMENT.CAPTURE.REVERSED`. Then set the id it gives you:

   ```sh
   supabase secrets set PAYPAL_WEBHOOK_ID=...
   ```

6. **Add the client id** to `src/config/paypal.ts`, and set `PAYPAL_ENV` to
   `'sandbox'` or `'live'` so it matches the Edge Function secret. That flips
   `PAYMENTS_ENABLED` and swaps the placeholder button for the v6 PayPal button.

### Before taking real money

- Buy a set end to end with a sandbox account.
- Replay a webhook from PayPal's simulator and confirm the second delivery
  changes nothing — that proves idempotency.
- Refund the sandbox order and confirm access is revoked.
- Swap to live credentials, create a **separate live webhook** (sandbox and live
  webhook ids differ), and update `PAYPAL_ENV` in both the Edge Function secret
  and `src/config/paypal.ts`, plus both secrets and the client id.

Fees are roughly 3.49% + $0.49, so a $5 set nets about $4.33.

### PayPal AI Toolkit alignment

What this teaching site already did, what this checkout now adds, and what
is left out on purpose.

**Already in place**

- JavaScript SDK **v6** (`/web-sdk/v6/core`, `createInstance`, `{ orderId }`)
- Server-side Orders v2 create and capture; the browser never sends a price
- Identity from the JWT, never from a body `user_id`
- Webhook signature verification; idempotent `grant_entitlement()`
- Secrets only as Edge Function env vars; sandbox is the default
- Pay Later / PayPal Credit never mounted (a $5 set should not offer financing)

**Added to match toolkit feedback that fits this stack**

- `PayPal-Request-Id` on Orders create/capture POSTs, reused on the server's automatic 429 retry. Create-order also accepts a client `request_id` (folded with the signed-in user) so the browser's one 429 retry does not mint a second PayPal order
- One 429 retry that honors `Retry-After` (capped so the Edge Function does not sleep away its budget), then `429` + `Retry-After` to the client
- OAuth token rate limits surface as **429 + Retry-After**, not a generic 502/500
- PayPal `debug_id` logged on errors
- `INSTRUMENT_DECLINED` on capture returns **422** and the ledger row is marked failed. There is no dedicated client decline/restart UI — after PayPal approval the paywall closes and the UI mainly reacts to `unlocked`, so a decline may just leave the set locked. That restart UX is intentionally out of scope
- Webhook parses JSON once; malformed / non-object bodies return **400**; missing secrets and unexpected verify failures stay **503**
- Browser: one extra wait/retry on 429, or “try again in N seconds”. The create-order retry reuses the same `request_id`

**Intentionally out of scope**

- Async webhook worker/queue (the toolkit prefers “200 then process later”; this function grants inline because the work is a single RPC)
- Caching the OAuth token across Edge isolates. Isolates are short-lived, so this demo fetches a token per invocation. That is one merchant client-credentials token (not per-user); production apps usually cache until `expires_in` (~9 hours). Intentionally out of scope here
- Enabling Pay Later, Venmo, Apple Pay, or Google Pay
- Dedicated `INSTRUMENT_DECLINED` client UX / `actions.restart()` — skipped on purpose. The server still returns 422; this demo does not surface that copy as a paywall message

## Still to do

- **Your real questions.** `seed.sql` holds original placeholder items written in
  SAT style, not College Board content. Export the bank from the iOS app and
  replace them — that content is the actual value here.
- **Optional 500-user cap.** `enforce_user_cap()` is already in `schema.sql`.
  Turn it on at **Authentication → Hooks → Before User Created**.
