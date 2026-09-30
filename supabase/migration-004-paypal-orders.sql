-- =====================================================================
--  PayPal checkout — orders ledger + the only two functions allowed to
--  change what a student owns.
--
--  Run once in the SQL Editor. Safe to re-run.
--
--  THE RULE THIS FILE EXISTS TO ENFORCE
--  ------------------------------------
--  A student may never grant themselves a set. entitlements has no
--  INSERT policy, so the browser cannot write to it directly. This file
--  adds functions that CAN write to it — which means the grants at the
--  bottom are the whole security boundary. grant_entitlement() must be
--  callable by the service role and nobody else. If `authenticated` ever
--  gets EXECUTE on it, the paywall is over: any signed-in student could
--  unlock every set from the browser console in one line.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. orders — one row per PayPal order we create
--
--  This is what lets the webhook map a payment back to (user, set)
--  without trusting anything the browser said, and it is the audit trail
--  when a student says "I paid and it did not unlock".
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  paypal_order_id text primary key,
  user_id         uuid not null references auth.users on delete cascade,
  set_id          text not null references public.question_sets(id) on delete cascade,
  -- Recorded from question_sets at creation time, so a later price change
  -- cannot retroactively rewrite what someone actually paid.
  amount_cents    int  not null check (amount_cents > 0),
  currency        text not null default 'USD',
  status          text not null default 'created'
    check (status in ('created', 'approved', 'captured', 'refunded', 'failed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;

-- A student may see their own order history. As with entitlements there
-- is deliberately no INSERT or UPDATE policy: only the Edge Functions,
-- running as the service role, write here.
drop policy if exists "read own orders" on public.orders;
create policy "read own orders"
  on public.orders for select
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------
--  2. grant_entitlement() — the single path from payment to access
--
--  Idempotent on purpose. Both the capture call and the webhook invoke
--  this for the same order, and PayPal may redeliver a webhook days
--  later. `on conflict do nothing` plus the unique index on
--  entitlements.order_ref means the second and hundredth call are no-ops
--  rather than duplicate grants or errors.
--
--  Returns true only when this call is the one that created the row, so
--  the caller can tell "just unlocked" from "already owned".
-- ---------------------------------------------------------------------
create or replace function public.grant_entitlement(
  p_user_id   uuid,
  p_set_id    text,
  p_order_ref text
)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_inserted boolean;
begin
  if p_user_id is null or p_set_id is null or p_order_ref is null then
    raise exception 'grant_entitlement requires user_id, set_id and order_ref.'
      using errcode = '22023';
  end if;

  insert into public.entitlements (user_id, set_id, source, order_ref)
  values (p_user_id, p_set_id, 'purchase', p_order_ref)
  on conflict do nothing;

  v_inserted := found;

  update public.orders
  set status     = 'captured',
      updated_at = now()
  where paypal_order_id = p_order_ref;

  return v_inserted;
end;
$$;


-- ---------------------------------------------------------------------
--  3. revoke_entitlement() — refunds and chargebacks
--
--  Keyed on order_ref rather than (user, set) so a refund can only ever
--  remove access that this specific order paid for. A manually granted
--  comp (source = 'manual', order_ref null) is untouched by design.
-- ---------------------------------------------------------------------
create or replace function public.revoke_entitlement(p_order_ref text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_removed boolean;
begin
  if p_order_ref is null then
    raise exception 'revoke_entitlement requires an order_ref.'
      using errcode = '22023';
  end if;

  delete from public.entitlements where order_ref = p_order_ref;
  v_removed := found;

  update public.orders
  set status     = 'refunded',
      updated_at = now()
  where paypal_order_id = p_order_ref;

  return v_removed;
end;
$$;


-- ---------------------------------------------------------------------
--  4. record_order() — create the ledger row for a new PayPal order
-- ---------------------------------------------------------------------
create or replace function public.record_order(
  p_paypal_order_id text,
  p_user_id         uuid,
  p_set_id          text,
  p_amount_cents    int,
  p_currency        text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.orders (paypal_order_id, user_id, set_id, amount_cents, currency)
  values (p_paypal_order_id, p_user_id, p_set_id, p_amount_cents, coalesce(p_currency, 'USD'))
  on conflict (paypal_order_id) do nothing;
end;
$$;


-- ---------------------------------------------------------------------
--  5. THE GRANTS. Read the header comment before changing anything here.
--
--  These three functions are SECURITY DEFINER and write to entitlements.
--  Exposing any of them to `authenticated` hands every student the
--  ability to unlock every set for free.
-- ---------------------------------------------------------------------
revoke execute on function public.grant_entitlement(uuid, text, text)  from public, anon, authenticated;
revoke execute on function public.revoke_entitlement(text)             from public, anon, authenticated;
revoke execute on function public.record_order(text, uuid, text, int, text) from public, anon, authenticated;

grant execute on function public.grant_entitlement(uuid, text, text)   to service_role;
grant execute on function public.revoke_entitlement(text)              to service_role;
grant execute on function public.record_order(text, uuid, text, int, text) to service_role;


-- ---------------------------------------------------------------------
--  6. Verify the boundary held.
--
--  Run this after applying. Every row must come back `false`. If any
--  says true, stop and fix the grants before taking a single payment.
-- ---------------------------------------------------------------------
--  select
--    has_function_privilege('authenticated', 'public.grant_entitlement(uuid,text,text)', 'EXECUTE') as auth_can_grant,
--    has_function_privilege('anon',          'public.grant_entitlement(uuid,text,text)', 'EXECUTE') as anon_can_grant,
--    has_function_privilege('authenticated', 'public.revoke_entitlement(text)',          'EXECUTE') as auth_can_revoke;
