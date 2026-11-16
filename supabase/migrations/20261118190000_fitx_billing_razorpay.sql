-- FITX billing: premium subscriptions through Razorpay, in test or live mode.
-- Prepared for review. Apply only after the owner approves; it is additive and seeds nothing.
--
-- Tables (all start empty; the owner adds real plans and prices):
--   billing_plans                plans the owner sells: amounts in paise (INR), hidden until is_active
--   billing_subscriptions        one row per Razorpay subscription the FITX server created for a user
--   billing_payments             Razorpay payments belonging to those subscriptions
--   billing_refunds              refunds of those payments
--   billing_provider_events      every Razorpay event applied (signed webhook, API response or
--                                reconciliation read), unique per event id so a redelivery applies once
--   billing_reconciliation_runs  results of the nightly comparison with Razorpay
--
-- Security model:
--   * RLS on every table. Signed-in users read only their own subscriptions, payments and refunds,
--     plus active plans. anon gets nothing.
--   * Nobody writes these tables directly, not even the server's secret key (service_role keeps SELECT
--     only). Every write goes through the security definer functions below, which only service_role
--     may execute. Subscription status therefore changes only from what Razorpay itself reported: a
--     webhook whose signature the server verified, or a response the server read from Razorpay's API
--     with its secret key. Never from the browser.
--   * Premium access is public.has_premium(uid): the paid period of a captured payment, plus a short
--     grace window while Razorpay retries a renewal. It never reads profiles.plan.
--   * Test-mode and live-mode records are kept apart by the mode column; Admin revenue reads live only.
begin;

-- Plans -----------------------------------------------------------------------------------------

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 300),
  features text[] not null default '{}'::text[]
    check (cardinality(features) <= 10 and char_length(array_to_string(features, '')) <= 1200),
  -- Paise: Rs 199 is 19900. The server refuses checkout if the Razorpay plan's amount differs.
  amount_paise integer not null check (amount_paise between 100 and 10000000),
  currency text not null default 'INR' check (currency = 'INR'),
  billing_period text not null check (billing_period in ('monthly', 'yearly')),
  billing_interval integer not null default 1,
  -- Razorpay plan ids differ between test mode and live mode, so each mode has its own column.
  razorpay_plan_id_test text unique check (razorpay_plan_id_test ~ '^plan_[A-Za-z0-9]{1,60}$'),
  razorpay_plan_id_live text unique check (razorpay_plan_id_live ~ '^plan_[A-Za-z0-9]{1,60}$'),
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_interval check (
    (billing_period = 'monthly' and billing_interval between 1 and 12)
    or (billing_period = 'yearly' and billing_interval = 1)
  )
);

-- Subscriptions ---------------------------------------------------------------------------------

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Financial records outlive a deleted account; the link to the person is dropped.
  user_id uuid references auth.users (id) on delete set null,
  plan_id uuid not null references public.billing_plans (id),
  mode text not null check (mode in ('test', 'live')),
  provider_subscription_id text not null unique check (provider_subscription_id ~ '^sub_[A-Za-z0-9]{1,60}$'),
  provider_plan_id text not null check (provider_plan_id ~ '^plan_[A-Za-z0-9]{1,60}$'),
  provider_customer_id text check (char_length(provider_customer_id) <= 80),
  status text not null default 'created' check (status in (
    'created', 'authenticated', 'active', 'pending', 'halted', 'paused', 'cancelled', 'completed', 'expired'
  )),
  current_start timestamptz,
  current_end timestamptz,
  charge_at timestamptz,
  start_at timestamptz,
  end_at timestamptz,
  ended_at timestamptz,
  paid_count integer not null default 0 check (paid_count >= 0),
  total_count integer check (total_count > 0),
  remaining_count integer check (remaining_count >= 0),
  -- End of the latest period covered by a captured, not fully refunded payment. Drives has_premium.
  paid_until timestamptz,
  -- When the account holder cancelled from FITX (renewals stop at once; access runs to paid_until).
  cancel_requested_at timestamptz,
  -- Set when the user started a newer checkout before paying for this one.
  abandoned_at timestamptz,
  -- created_at of the newest Razorpay event (or API read) applied, so older redeliveries never win.
  provider_synced_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_subscriptions_user_idx on public.billing_subscriptions (user_id, created_at desc);
create index if not exists billing_subscriptions_plan_idx on public.billing_subscriptions (plan_id);
create index if not exists billing_subscriptions_mode_status_idx on public.billing_subscriptions (mode, status);
-- At most one unpaid checkout per account and mode; a new one marks the previous one abandoned.
create unique index if not exists billing_subscriptions_one_open_checkout
  on public.billing_subscriptions (user_id, mode) where status = 'created' and abandoned_at is null;

-- Payments --------------------------------------------------------------------------------------

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid references public.billing_subscriptions (id) on delete set null,
  mode text not null check (mode in ('test', 'live')),
  provider_payment_id text not null unique check (provider_payment_id ~ '^pay_[A-Za-z0-9]{1,60}$'),
  provider_invoice_id text check (char_length(provider_invoice_id) <= 80),
  provider_order_id text check (char_length(provider_order_id) <= 80),
  amount_paise integer not null check (amount_paise >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('created', 'authorized', 'captured', 'failed', 'refunded')),
  method text check (char_length(method) <= 40),
  amount_refunded_paise integer not null default 0 check (amount_refunded_paise >= 0),
  refund_status text check (refund_status in ('partial', 'full')),
  fee_paise integer check (fee_paise >= 0),
  tax_paise integer check (tax_paise >= 0),
  error_code text check (char_length(error_code) <= 100),
  error_description text check (char_length(error_description) <= 500),
  error_reason text check (char_length(error_reason) <= 100),
  error_source text check (char_length(error_source) <= 100),
  error_step text check (char_length(error_step) <= 100),
  -- The billing period this payment paid for (from the subscription in the same Razorpay event, or
  -- from the invoice during reconciliation).
  period_start timestamptz,
  period_end timestamptz,
  provider_created_at timestamptz,
  captured_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_payments_user_idx on public.billing_payments (user_id, created_at desc);
create index if not exists billing_payments_subscription_idx on public.billing_payments (subscription_id);
create index if not exists billing_payments_mode_status_idx on public.billing_payments (mode, status, created_at desc);

-- Refunds ---------------------------------------------------------------------------------------

create table if not exists public.billing_refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  payment_id uuid not null references public.billing_payments (id),
  mode text not null check (mode in ('test', 'live')),
  provider_refund_id text not null unique check (provider_refund_id ~ '^rfnd_[A-Za-z0-9]{1,60}$'),
  amount_paise integer not null check (amount_paise > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('pending', 'processed', 'failed')),
  speed_requested text check (char_length(speed_requested) <= 20),
  speed_processed text check (char_length(speed_processed) <= 20),
  provider_created_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_refunds_user_idx on public.billing_refunds (user_id, created_at desc);
create index if not exists billing_refunds_payment_idx on public.billing_refunds (payment_id);
create index if not exists billing_refunds_mode_idx on public.billing_refunds (mode, created_at desc);

-- Provider events (idempotency and audit) -------------------------------------------------------

create table if not exists public.billing_provider_events (
  id bigint generated always as identity primary key,
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  -- x-razorpay-event-id for webhooks; "api:…" or "reconcile:…" for reads the server made itself.
  event_id text not null check (char_length(event_id) between 1 and 200),
  source text not null check (source in ('webhook', 'api', 'reconcile')),
  event_type text not null check (char_length(event_type) between 1 and 80),
  mode text not null check (mode in ('test', 'live')),
  event_created_at timestamptz,
  -- The Razorpay payload with contact details, card and UPI data removed by the server.
  payload jsonb not null default '{}'::jsonb,
  outcome text not null default 'applied' check (outcome in ('applied', 'ignored')),
  outcome_detail text check (char_length(outcome_detail) <= 200),
  subscription_id uuid references public.billing_subscriptions (id) on delete set null,
  received_at timestamptz not null default now(),
  constraint billing_provider_events_once unique (provider, event_id)
);

create index if not exists billing_provider_events_received_idx
  on public.billing_provider_events (mode, source, received_at desc);
create index if not exists billing_provider_events_subscription_idx on public.billing_provider_events (subscription_id);

-- Reconciliation runs ---------------------------------------------------------------------------

create table if not exists public.billing_reconciliation_runs (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('test', 'live')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  subscriptions_checked integer not null default 0 check (subscriptions_checked >= 0),
  corrections integer not null default 0 check (corrections >= 0),
  errors integer not null default 0 check (errors >= 0),
  detail jsonb not null default '{}'::jsonb
);

create index if not exists billing_reconciliation_runs_mode_idx on public.billing_reconciliation_runs (mode, finished_at desc);

-- Row-level security and privileges -------------------------------------------------------------

alter table public.billing_plans enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_refunds enable row level security;
alter table public.billing_provider_events enable row level security;
alter table public.billing_reconciliation_runs enable row level security;

revoke all on table public.billing_plans, public.billing_subscriptions, public.billing_payments,
  public.billing_refunds, public.billing_provider_events, public.billing_reconciliation_runs
  from public, anon, authenticated, service_role;

grant select on table public.billing_plans, public.billing_subscriptions, public.billing_payments,
  public.billing_refunds to authenticated;
grant select on table public.billing_plans, public.billing_subscriptions, public.billing_payments,
  public.billing_refunds, public.billing_provider_events, public.billing_reconciliation_runs to service_role;

drop policy if exists billing_subscriptions_read_own on public.billing_subscriptions;
create policy billing_subscriptions_read_own on public.billing_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists billing_plans_read on public.billing_plans;
create policy billing_plans_read on public.billing_plans for select to authenticated
  using (
    is_active
    or exists (
      select 1 from public.billing_subscriptions s
      where s.plan_id = billing_plans.id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists billing_payments_read_own on public.billing_payments;
create policy billing_payments_read_own on public.billing_payments for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists billing_refunds_read_own on public.billing_refunds;
create policy billing_refunds_read_own on public.billing_refunds for select to authenticated
  using ((select auth.uid()) = user_id);

-- billing_provider_events and billing_reconciliation_runs have no policies: only service_role reads them.

-- Access rule -----------------------------------------------------------------------------------

-- Access lasts until the end of the paid period. While Razorpay is still collecting the next renewal
-- (status active or pending) a 3-day grace window covers the gap; once the subscription is cancelled,
-- halted, paused or finished, access ends exactly at paid_until.
create or replace function public.billing_grants_access(p_status text, p_paid_until timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_paid_until is not null
    and pg_catalog.now() < p_paid_until + case
      when p_status in ('active', 'pending') then interval '3 days'
      else interval '0 seconds'
    end
$$;

-- Usable in RLS policies of premium content, for example:
--   using (not is_premium or (select public.has_premium((select auth.uid()))))
-- A signed-in user can only ask about themselves; any other id returns false.
create or replace function public.has_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_id is null then false
    when (select auth.uid()) is not null and p_user_id <> (select auth.uid()) then false
    else exists (
      select 1
      from public.billing_subscriptions s
      where s.user_id = p_user_id
        and public.billing_grants_access(s.status, s.paid_until)
    )
  end
$$;

-- Status order for payments and refunds: a later status never moves back. "failed" ranks below
-- "authorized" because Razorpay can authorise a payment late after first reporting it failed.
create or replace function public.billing_payment_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'created' then 0 when 'failed' then 1 when 'authorized' then 2
    when 'captured' then 3 when 'refunded' then 4 else -1
  end
$$;

create or replace function public.billing_refund_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status when 'pending' then 0 when 'failed' then 1 when 'processed' then 2 else -1 end
$$;

-- Lifecycle order of a subscription, used only between snapshots from the same second: created, then
-- authenticated, then any later status.
create or replace function public.billing_subscription_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status when 'created' then 0 when 'authenticated' then 1 else 2 end
$$;

-- Applying Razorpay events ----------------------------------------------------------------------

-- Applies one normalised Razorpay event in a single transaction and returns what happened.
-- p_event: { event_id, source, event_type, mode, event_created_at, payload,
--            subscription?: {...}, payment?: {...}, refund?: {...} } as built by src/lib/billing/events.ts.
-- * The event row is inserted first; a second delivery of the same event id returns "duplicate".
-- * Subscription fields are a snapshot: applied unless the row already holds a newer snapshot, and a
--   cancelled, completed or expired subscription never changes status again.
-- * Payments and refunds are upserted by Razorpay id and their status only moves forward.
-- * paid_until is recomputed from the subscription's captured payments.
-- * A record that belongs to the other mode raises billing_mode_mismatch, so nothing is written and
--   Razorpay retries later.
create or replace function public.billing_apply_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id text := p_event->>'event_id';
  v_source text := p_event->>'source';
  v_type text := p_event->>'event_type';
  v_mode text := p_event->>'mode';
  v_at timestamptz := coalesce(nullif(p_event->>'event_created_at', '')::timestamptz, pg_catalog.now());
  v_sub jsonb := case when pg_catalog.jsonb_typeof(p_event->'subscription') = 'object' then p_event->'subscription' end;
  v_pay jsonb := case when pg_catalog.jsonb_typeof(p_event->'payment') = 'object' then p_event->'payment' end;
  v_ref jsonb := case when pg_catalog.jsonb_typeof(p_event->'refund') = 'object' then p_event->'refund' end;
  v_event_pk bigint;
  v_sub_row public.billing_subscriptions;
  v_pay_row public.billing_payments;
  v_target_sub uuid;
  v_target_user uuid;
  v_target_mode text;
  v_status_before text;
  v_status_after text;
  v_payment_created boolean := false;
  v_refunded integer;
  v_applied boolean := false;
  v_detail text;
begin
  if v_event_id is null or pg_catalog.char_length(v_event_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'billing_apply_event: event_id is required';
  end if;
  if v_source is null or v_source not in ('webhook', 'api', 'reconcile') then
    raise exception using errcode = '22023', message = 'billing_apply_event: unknown source';
  end if;
  if v_mode is null or v_mode not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'billing_apply_event: unknown mode';
  end if;
  if v_type is null or pg_catalog.char_length(v_type) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'billing_apply_event: event_type is required';
  end if;

  insert into public.billing_provider_events (event_id, source, event_type, mode, event_created_at, payload)
  values (v_event_id, v_source, v_type, v_mode, v_at,
          case when pg_catalog.jsonb_typeof(p_event->'payload') = 'object' then p_event->'payload' else '{}'::jsonb end)
  on conflict (provider, event_id) do nothing
  returning id into v_event_pk;
  if v_event_pk is null then
    return pg_catalog.jsonb_build_object('outcome', 'duplicate');
  end if;

  -- Subscription snapshot.
  if v_sub is not null then
    select * into v_sub_row
    from public.billing_subscriptions
    where provider_subscription_id = v_sub->>'provider_subscription_id'
    for update;

    if not found then
      update public.billing_provider_events
      set outcome = 'ignored', outcome_detail = 'unknown_subscription'
      where id = v_event_pk;
      return pg_catalog.jsonb_build_object('outcome', 'ignored', 'detail', 'unknown_subscription');
    end if;
    if v_sub_row.mode <> v_mode then
      raise exception using errcode = 'P0001', message = 'billing_mode_mismatch';
    end if;

    v_target_sub := v_sub_row.id;
    v_target_user := v_sub_row.user_id;
    v_target_mode := v_sub_row.mode;
    v_status_before := v_sub_row.status;
    v_status_after := v_sub_row.status;

    if v_sub_row.status in ('cancelled', 'completed', 'expired') then
      v_detail := 'subscription_already_final';
    elsif v_sub_row.provider_synced_at is not null and (
      v_at < v_sub_row.provider_synced_at
      -- Webhook times are whole seconds. Within one second the start of the lifecycle never wins
      -- over a later step: an "authenticated" arriving after "charged" must not undo it.
      or (v_at = v_sub_row.provider_synced_at
          and public.billing_subscription_rank(coalesce(v_sub->>'status', v_sub_row.status))
            < public.billing_subscription_rank(v_sub_row.status))
    ) then
      v_detail := 'older_than_applied_snapshot';
    else
      update public.billing_subscriptions s set
        status = coalesce(v_sub->>'status', s.status),
        provider_customer_id = coalesce(nullif(v_sub->>'provider_customer_id', ''), s.provider_customer_id),
        current_start = case when v_sub ? 'current_start' then nullif(v_sub->>'current_start', '')::timestamptz else s.current_start end,
        current_end = case when v_sub ? 'current_end' then nullif(v_sub->>'current_end', '')::timestamptz else s.current_end end,
        charge_at = case when v_sub ? 'charge_at' then nullif(v_sub->>'charge_at', '')::timestamptz else s.charge_at end,
        start_at = case when v_sub ? 'start_at' then nullif(v_sub->>'start_at', '')::timestamptz else s.start_at end,
        end_at = case when v_sub ? 'end_at' then nullif(v_sub->>'end_at', '')::timestamptz else s.end_at end,
        ended_at = case when v_sub ? 'ended_at' then nullif(v_sub->>'ended_at', '')::timestamptz else s.ended_at end,
        paid_count = coalesce((v_sub->>'paid_count')::integer, s.paid_count),
        total_count = coalesce((v_sub->>'total_count')::integer, s.total_count),
        remaining_count = case when v_sub ? 'remaining_count' then (v_sub->>'remaining_count')::integer else s.remaining_count end,
        provider_synced_at = v_at,
        updated_at = pg_catalog.now()
      where s.id = v_sub_row.id
      returning s.status into v_status_after;
    end if;

    -- Only the server's own, successful cancel call (made for the signed-in account holder) sends this.
    if v_source = 'api' and (v_sub->>'cancel_requested') = 'true' then
      update public.billing_subscriptions
      set cancel_requested_at = coalesce(cancel_requested_at, pg_catalog.now()), updated_at = pg_catalog.now()
      where id = v_target_sub;
    end if;
    if v_source = 'reconcile' then
      update public.billing_subscriptions set last_reconciled_at = pg_catalog.now() where id = v_target_sub;
    end if;
    v_applied := true;
  end if;

  -- Payment.
  if v_pay is not null then
    select * into v_pay_row
    from public.billing_payments
    where provider_payment_id = v_pay->>'provider_payment_id'
    for update;

    if found then
      if v_pay_row.mode <> v_mode then
        raise exception using errcode = 'P0001', message = 'billing_mode_mismatch';
      end if;
      v_target_sub := coalesce(v_target_sub, v_pay_row.subscription_id);
      v_target_user := coalesce(v_target_user, v_pay_row.user_id);
      v_refunded := greatest(v_pay_row.amount_refunded_paise, coalesce((v_pay->>'amount_refunded_paise')::integer, 0));
      update public.billing_payments p set
        status = case
          when public.billing_payment_rank(v_pay->>'status') > public.billing_payment_rank(p.status) then v_pay->>'status'
          else p.status
        end,
        amount_refunded_paise = v_refunded,
        refund_status = case
          when v_refunded > 0 and v_refunded >= p.amount_paise then 'full'
          when v_refunded > 0 then 'partial'
          else p.refund_status
        end,
        method = coalesce(nullif(pg_catalog.left(v_pay->>'method', 40), ''), p.method),
        fee_paise = coalesce((v_pay->>'fee_paise')::integer, p.fee_paise),
        tax_paise = coalesce((v_pay->>'tax_paise')::integer, p.tax_paise),
        error_code = coalesce(nullif(pg_catalog.left(v_pay->>'error_code', 100), ''), p.error_code),
        error_description = coalesce(nullif(pg_catalog.left(v_pay->>'error_description', 500), ''), p.error_description),
        error_reason = coalesce(nullif(pg_catalog.left(v_pay->>'error_reason', 100), ''), p.error_reason),
        error_source = coalesce(nullif(pg_catalog.left(v_pay->>'error_source', 100), ''), p.error_source),
        error_step = coalesce(nullif(pg_catalog.left(v_pay->>'error_step', 100), ''), p.error_step),
        provider_invoice_id = coalesce(p.provider_invoice_id, nullif(pg_catalog.left(v_pay->>'provider_invoice_id', 80), '')),
        provider_order_id = coalesce(p.provider_order_id, nullif(pg_catalog.left(v_pay->>'provider_order_id', 80), '')),
        subscription_id = coalesce(p.subscription_id, v_target_sub),
        user_id = coalesce(p.user_id, v_target_user),
        period_start = coalesce(p.period_start, nullif(v_pay->>'period_start', '')::timestamptz),
        period_end = coalesce(p.period_end, nullif(v_pay->>'period_end', '')::timestamptz),
        provider_created_at = coalesce(p.provider_created_at, nullif(v_pay->>'provider_created_at', '')::timestamptz),
        captured_at = coalesce(p.captured_at, case when v_pay->>'status' in ('captured', 'refunded') then v_at end),
        failed_at = coalesce(p.failed_at, case when v_pay->>'status' = 'failed' then v_at end),
        updated_at = pg_catalog.now()
      where p.id = v_pay_row.id;
      v_applied := true;
    else
      if v_target_sub is null and nullif(v_pay->>'provider_subscription_id', '') is not null then
        select s.id, s.user_id, s.mode into v_target_sub, v_target_user, v_target_mode
        from public.billing_subscriptions s
        where s.provider_subscription_id = v_pay->>'provider_subscription_id';
        if v_target_sub is not null and v_target_mode <> v_mode then
          raise exception using errcode = 'P0001', message = 'billing_mode_mismatch';
        end if;
      end if;

      if v_target_sub is not null then
        v_refunded := coalesce((v_pay->>'amount_refunded_paise')::integer, 0);
        insert into public.billing_payments (
          user_id, subscription_id, mode, provider_payment_id, provider_invoice_id, provider_order_id,
          amount_paise, currency, status, method, amount_refunded_paise, refund_status, fee_paise, tax_paise,
          error_code, error_description, error_reason, error_source, error_step,
          period_start, period_end, provider_created_at, captured_at, failed_at
        ) values (
          v_target_user, v_target_sub, v_mode, v_pay->>'provider_payment_id',
          nullif(pg_catalog.left(v_pay->>'provider_invoice_id', 80), ''), nullif(pg_catalog.left(v_pay->>'provider_order_id', 80), ''),
          (v_pay->>'amount_paise')::integer, coalesce(nullif(v_pay->>'currency', ''), 'INR'), v_pay->>'status',
          nullif(pg_catalog.left(v_pay->>'method', 40), ''), v_refunded,
          case
            when v_refunded > 0 and v_refunded >= (v_pay->>'amount_paise')::integer then 'full'
            when v_refunded > 0 then 'partial'
          end,
          (v_pay->>'fee_paise')::integer, (v_pay->>'tax_paise')::integer,
          nullif(pg_catalog.left(v_pay->>'error_code', 100), ''), nullif(pg_catalog.left(v_pay->>'error_description', 500), ''),
          nullif(pg_catalog.left(v_pay->>'error_reason', 100), ''), nullif(pg_catalog.left(v_pay->>'error_source', 100), ''),
          nullif(pg_catalog.left(v_pay->>'error_step', 100), ''),
          nullif(v_pay->>'period_start', '')::timestamptz, nullif(v_pay->>'period_end', '')::timestamptz,
          nullif(v_pay->>'provider_created_at', '')::timestamptz,
          case when v_pay->>'status' in ('captured', 'refunded') then v_at end,
          case when v_pay->>'status' = 'failed' then v_at end
        );
        v_payment_created := true;
        v_applied := true;
      else
        v_detail := coalesce(v_detail, 'unknown_payment');
      end if;
    end if;
  end if;

  -- Refund.
  if v_ref is not null then
    select * into v_pay_row
    from public.billing_payments
    where provider_payment_id = v_ref->>'provider_payment_id';

    if not found then
      v_detail := coalesce(v_detail, 'unknown_payment');
    else
      if v_pay_row.mode <> v_mode then
        raise exception using errcode = 'P0001', message = 'billing_mode_mismatch';
      end if;
      v_target_sub := coalesce(v_target_sub, v_pay_row.subscription_id);
      insert into public.billing_refunds as r (
        user_id, payment_id, mode, provider_refund_id, amount_paise, currency, status,
        speed_requested, speed_processed, provider_created_at, processed_at, failed_at
      ) values (
        v_pay_row.user_id, v_pay_row.id, v_mode, v_ref->>'provider_refund_id', (v_ref->>'amount_paise')::integer,
        coalesce(nullif(v_ref->>'currency', ''), 'INR'), v_ref->>'status',
        nullif(pg_catalog.left(v_ref->>'speed_requested', 20), ''), nullif(pg_catalog.left(v_ref->>'speed_processed', 20), ''),
        nullif(v_ref->>'provider_created_at', '')::timestamptz,
        case when v_ref->>'status' = 'processed' then v_at end,
        case when v_ref->>'status' = 'failed' then v_at end
      )
      on conflict (provider_refund_id) do update set
        status = case
          when public.billing_refund_rank(excluded.status) > public.billing_refund_rank(r.status) then excluded.status
          else r.status
        end,
        speed_processed = coalesce(excluded.speed_processed, r.speed_processed),
        processed_at = coalesce(r.processed_at, excluded.processed_at),
        failed_at = coalesce(r.failed_at, excluded.failed_at),
        updated_at = pg_catalog.now();
      v_applied := true;
    end if;
  end if;

  -- Recompute paid_until; the row (and updated_at) is touched only when it actually changes.
  if v_target_sub is not null then
    update public.billing_subscriptions s
    set paid_until = c.paid_until, updated_at = pg_catalog.now()
    from (
      select pg_catalog.max(p.period_end) as paid_until
      from public.billing_payments p
      where p.subscription_id = v_target_sub and p.status = 'captured'
    ) c
    where s.id = v_target_sub and s.paid_until is distinct from c.paid_until;
  end if;

  if not v_applied then
    v_detail := coalesce(v_detail, 'nothing_to_apply');
  end if;

  update public.billing_provider_events
  set outcome = case when v_applied then 'applied' else 'ignored' end,
      outcome_detail = v_detail,
      subscription_id = v_target_sub
  where id = v_event_pk;

  return pg_catalog.jsonb_build_object(
    'outcome', case when v_applied then 'applied' else 'ignored' end,
    'detail', v_detail,
    'subscription_id', v_target_sub,
    'status_before', v_status_before,
    'status_after', v_status_after,
    'payment_created', v_payment_created
  );
end
$$;

-- Records the Razorpay subscription the server just created for a signed-in user's checkout.
-- Serialised per account; refuses when the account already has a subscription Razorpay is billing or
-- has started 10 checkouts of this mode in the last 24 hours (the server checks the same limit before
-- it contacts Razorpay; this catches a burst of parallel requests), and marks any older unpaid
-- checkout of the same mode as abandoned.
create or replace function public.billing_record_checkout(
  p_user_id uuid,
  p_plan_id uuid,
  p_mode text,
  p_provider_subscription_id text,
  p_provider_plan_id text,
  p_total_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_plan_id is null or p_mode is null or p_mode not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'billing_record_checkout: invalid arguments';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fitx_billing_checkout:' || p_user_id::text, 0));

  if exists (
    select 1 from public.billing_subscriptions
    where user_id = p_user_id and mode = p_mode
      and status in ('authenticated', 'active', 'pending', 'halted', 'paused')
  ) then
    raise exception using errcode = 'P0001', message = 'billing_already_subscribed';
  end if;
  if (
    select pg_catalog.count(*) from public.billing_subscriptions
    where user_id = p_user_id and mode = p_mode and created_at > pg_catalog.now() - interval '1 day'
  ) >= 10 then
    raise exception using errcode = 'P0001', message = 'billing_checkout_limit';
  end if;

  update public.billing_subscriptions
  set abandoned_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where user_id = p_user_id and mode = p_mode and status = 'created' and abandoned_at is null;

  insert into public.billing_subscriptions (user_id, plan_id, mode, provider_subscription_id, provider_plan_id, total_count)
  values (p_user_id, p_plan_id, p_mode, p_provider_subscription_id, p_provider_plan_id, p_total_count)
  returning id into v_id;
  return v_id;
end
$$;

-- Subscriptions the nightly reconciliation should compare with Razorpay, in this order:
--   1. every subscription Razorpay may still bill, and each account's open checkout (a missed
--      activation or renewal webhook is repaired here);
--   2. ended ones while a refund is still plausible: 40 days after they ended. ended_at and
--      provider_synced_at no longer change once a subscription is final, so these age out;
--   3. checkouts replaced by a newer one, for a week (an already open Checkout window can still pay
--      them), last so they can never crowd out the others.
-- Least recently checked first within each group.
create or replace function public.billing_reconcile_candidates(p_mode text, p_limit integer)
returns table (id uuid, provider_subscription_id text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.provider_subscription_id, s.status
  from public.billing_subscriptions s
  where s.mode = p_mode
    and (
      s.status in ('authenticated', 'active', 'pending', 'halted', 'paused')
      or (s.status = 'created' and s.created_at > pg_catalog.now() - interval '7 days')
      or (s.status in ('cancelled', 'completed', 'expired')
          and coalesce(s.ended_at, s.provider_synced_at, s.created_at) > pg_catalog.now() - interval '40 days')
    )
  order by
    case
      when s.status = 'created' and s.abandoned_at is not null then 2
      when s.status in ('cancelled', 'completed', 'expired') then 1
      else 0
    end,
    s.last_reconciled_at nulls first,
    s.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

create or replace function public.billing_record_reconciliation(p_run jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if (p_run->>'mode') is null or (p_run->>'mode') not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'billing_record_reconciliation: unknown mode';
  end if;
  insert into public.billing_reconciliation_runs (mode, started_at, finished_at, subscriptions_checked, corrections, errors, detail)
  values (
    p_run->>'mode',
    coalesce(nullif(p_run->>'started_at', '')::timestamptz, pg_catalog.now()),
    pg_catalog.now(),
    greatest(coalesce((p_run->>'subscriptions_checked')::integer, 0), 0),
    greatest(coalesce((p_run->>'corrections')::integer, 0), 0),
    greatest(coalesce((p_run->>'errors')::integer, 0), 0),
    case when pg_catalog.jsonb_typeof(p_run->'detail') = 'object' then p_run->'detail' else '{}'::jsonb end
  )
  returning id into v_id;
  return v_id;
end
$$;

-- Admin reads (FITX Admin app, service_role only) -----------------------------------------------

-- Verified totals for one mode. Revenue is captured INR payments minus processed refunds; months
-- are calendar months in India Standard Time.
create or replace function public.billing_admin_overview(p_mode text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as month_start
  ),
  captured as (
    select p.amount_paise, coalesce(p.provider_created_at, p.captured_at, p.created_at) as at, p.fee_paise
    from public.billing_payments p
    where p.mode = p_mode and p.currency = 'INR' and p.status in ('captured', 'refunded')
  ),
  refunded as (
    select r.amount_paise, coalesce(r.processed_at, r.created_at) as at
    from public.billing_refunds r
    where r.mode = p_mode and r.currency = 'INR' and r.status = 'processed'
  ),
  months as (
    select pg_catalog.generate_series(0, 5) as back
  )
  select pg_catalog.jsonb_build_object(
    'mode', p_mode,
    'subscribers_with_access', (
      select pg_catalog.count(distinct s.user_id) from public.billing_subscriptions s
      where s.mode = p_mode and s.user_id is not null
        and public.billing_grants_access(s.status, s.paid_until)
    ),
    'subscriptions_by_status', coalesce((
      select pg_catalog.jsonb_object_agg(t.status, t.n) from (
        select s.status, pg_catalog.count(*) as n from public.billing_subscriptions s
        where s.mode = p_mode and not (s.status = 'created' and s.abandoned_at is not null)
        group by s.status
      ) t
    ), '{}'::jsonb),
    'captured_paise_total', (select coalesce(pg_catalog.sum(amount_paise), 0) from captured),
    'refunded_paise_total', (select coalesce(pg_catalog.sum(amount_paise), 0) from refunded),
    'fees_paise_total', (select coalesce(pg_catalog.sum(fee_paise), 0) from captured),
    'captured_paise_month', (select coalesce(pg_catalog.sum(c.amount_paise), 0) from captured c, bounds b where c.at >= b.month_start),
    'refunded_paise_month', (select coalesce(pg_catalog.sum(r.amount_paise), 0) from refunded r, bounds b where r.at >= b.month_start),
    'payments_captured_30d', (
      select pg_catalog.count(*) from captured c where c.at >= pg_catalog.now() - interval '30 days'
    ),
    'payments_failed_30d', (
      select pg_catalog.count(*) from public.billing_payments p
      where p.mode = p_mode and p.status = 'failed' and coalesce(p.failed_at, p.created_at) >= pg_catalog.now() - interval '30 days'
    ),
    'refunds_pending', (
      select pg_catalog.count(*) from public.billing_refunds r where r.mode = p_mode and r.status = 'pending'
    ),
    'monthly', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'month', pg_catalog.to_char(m.month_start at time zone 'Asia/Kolkata', 'YYYY-MM'),
        'captured_paise', (select coalesce(pg_catalog.sum(c.amount_paise), 0) from captured c
                           where c.at >= m.month_start and c.at < m.month_end),
        'refunded_paise', (select coalesce(pg_catalog.sum(r.amount_paise), 0) from refunded r
                           where r.at >= m.month_start and r.at < m.month_end)
      ) order by m.month_start desc)
      from (
        select (b.month_start at time zone 'Asia/Kolkata' - pg_catalog.make_interval(months => mo.back)) at time zone 'Asia/Kolkata' as month_start,
               (b.month_start at time zone 'Asia/Kolkata' - pg_catalog.make_interval(months => mo.back - 1)) at time zone 'Asia/Kolkata' as month_end
        from bounds b, months mo
      ) m
    ), '[]'::jsonb),
    'last_webhook_at', (
      select pg_catalog.max(e.received_at) from public.billing_provider_events e
      where e.mode = p_mode and e.source = 'webhook'
    ),
    'webhooks_ignored_30d', (
      select pg_catalog.count(*) from public.billing_provider_events e
      where e.mode = p_mode and e.source = 'webhook' and e.outcome = 'ignored'
        and e.received_at >= pg_catalog.now() - interval '30 days'
    ),
    'last_reconciliation', (
      select pg_catalog.jsonb_build_object(
        'finished_at', r.finished_at, 'subscriptions_checked', r.subscriptions_checked,
        'corrections', r.corrections, 'errors', r.errors
      )
      from public.billing_reconciliation_runs r
      where r.mode = p_mode
      order by r.finished_at desc
      limit 1
    )
  )
$$;

create or replace function public.billing_admin_subscriptions(p_mode text, p_limit integer, p_offset integer)
returns table (
  id uuid, user_id uuid, email text, plan_name text, amount_paise integer, billing_period text, billing_interval integer,
  status text, has_access boolean, paid_until timestamptz, charge_at timestamptz, cancel_requested_at timestamptz,
  provider_subscription_id text, created_at timestamptz, total_rows bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.user_id, u.email::text, p.name, p.amount_paise, p.billing_period, p.billing_interval,
         s.status, public.billing_grants_access(s.status, s.paid_until),
         s.paid_until, s.charge_at, s.cancel_requested_at, s.provider_subscription_id, s.created_at,
         pg_catalog.count(*) over ()
  from public.billing_subscriptions s
  join public.billing_plans p on p.id = s.plan_id
  left join auth.users u on u.id = s.user_id
  where s.mode = p_mode and not (s.status = 'created' and s.abandoned_at is not null)
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.billing_admin_payments(p_mode text, p_status text, p_limit integer, p_offset integer)
returns table (
  id uuid, user_id uuid, email text, plan_name text, provider_payment_id text, amount_paise integer, currency text,
  status text, method text, amount_refunded_paise integer, error_code text, error_description text, error_reason text,
  period_start timestamptz, period_end timestamptz, paid_at timestamptz, total_rows bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select pay.id, pay.user_id, u.email::text, pl.name, pay.provider_payment_id, pay.amount_paise, pay.currency,
         pay.status, pay.method, pay.amount_refunded_paise, pay.error_code, pay.error_description, pay.error_reason,
         pay.period_start, pay.period_end, coalesce(pay.provider_created_at, pay.captured_at, pay.failed_at, pay.created_at),
         pg_catalog.count(*) over ()
  from public.billing_payments pay
  left join public.billing_subscriptions s on s.id = pay.subscription_id
  left join public.billing_plans pl on pl.id = s.plan_id
  left join auth.users u on u.id = pay.user_id
  where pay.mode = p_mode and (p_status is null or pay.status = p_status)
  order by coalesce(pay.provider_created_at, pay.captured_at, pay.failed_at, pay.created_at) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.billing_admin_refunds(p_mode text, p_limit integer, p_offset integer)
returns table (
  id uuid, user_id uuid, email text, provider_refund_id text, provider_payment_id text, amount_paise integer,
  currency text, status text, speed_processed text, created_at timestamptz, processed_at timestamptz, total_rows bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.user_id, u.email::text, r.provider_refund_id, pay.provider_payment_id, r.amount_paise, r.currency,
         r.status, r.speed_processed, coalesce(r.provider_created_at, r.created_at), r.processed_at,
         pg_catalog.count(*) over ()
  from public.billing_refunds r
  join public.billing_payments pay on pay.id = r.payment_id
  left join auth.users u on u.id = r.user_id
  where r.mode = p_mode
  order by coalesce(r.provider_created_at, r.created_at) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Function privileges ---------------------------------------------------------------------------

revoke all on function public.billing_grants_access(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.billing_payment_rank(text) from public, anon, authenticated, service_role;
revoke all on function public.billing_refund_rank(text) from public, anon, authenticated, service_role;
revoke all on function public.billing_subscription_rank(text) from public, anon, authenticated, service_role;

revoke all on function public.has_premium(uuid) from public, anon;
grant execute on function public.has_premium(uuid) to authenticated, service_role;

revoke all on function public.billing_apply_event(jsonb) from public, anon, authenticated;
revoke all on function public.billing_record_checkout(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.billing_reconcile_candidates(text, integer) from public, anon, authenticated;
revoke all on function public.billing_record_reconciliation(jsonb) from public, anon, authenticated;
revoke all on function public.billing_admin_overview(text) from public, anon, authenticated;
revoke all on function public.billing_admin_subscriptions(text, integer, integer) from public, anon, authenticated;
revoke all on function public.billing_admin_payments(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.billing_admin_refunds(text, integer, integer) from public, anon, authenticated;

grant execute on function public.billing_apply_event(jsonb) to service_role;
grant execute on function public.billing_record_checkout(uuid, uuid, text, text, text, integer) to service_role;
grant execute on function public.billing_reconcile_candidates(text, integer) to service_role;
grant execute on function public.billing_record_reconciliation(jsonb) to service_role;
grant execute on function public.billing_admin_overview(text) to service_role;
grant execute on function public.billing_admin_subscriptions(text, integer, integer) to service_role;
grant execute on function public.billing_admin_payments(text, text, integer, integer) to service_role;
grant execute on function public.billing_admin_refunds(text, integer, integer) to service_role;

commit;
