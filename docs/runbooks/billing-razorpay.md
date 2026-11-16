# Billing with Razorpay: setup, testing and going live

FITX Premium is an optional subscription paid through Razorpay. The code is in place, but nothing can be
charged until the steps below are done. Until then the pages say "Subscriptions open soon"; once billing
is set up but no plan is active, they say Premium is "not on sale right now". Neither wording claims
anything about past payments, so both stay true if sales are paused after launch.

## How it works

- **Plans** live in the `billing_plans` table: name, what it includes, price in paise (₹199 = `19900`),
  monthly or yearly, and the Razorpay plan id for test mode and for live mode. The table starts empty;
  no price is invented. A plan is sold only while `is_active` is true and it has a Razorpay plan id for
  the mode in use.
- **Checkout**: on `/subscription`, the server creates a Razorpay subscription for the signed-in account
  (after checking that Razorpay's plan charges exactly the price FITX shows) and Razorpay Checkout opens.
  Opening the same plan's checkout again reuses it. Before replacing an open checkout (another plan, or
  one older than 12 hours) the server asks Razorpay whether it was paid, and never starts a second
  subscription while one is paid or Razorpay cannot be asked. An account can start at most 10 new
  checkouts per mode in 24 hours. Each subscription stores the price it started at.
- **Confirmation**: only Razorpay can turn Premium on. Razorpay calls `/api/billing/webhook`; FITX checks
  the `X-Razorpay-Signature` (HMAC-SHA256 of the body with the webhook secret), applies each event once
  (duplicates and late, out-of-order deliveries are harmless) and records the payment. When Checkout
  reports a payment with a genuine signature, the server also reads that subscription from Razorpay and
  records Razorpay's answer (for example "active"), so it never looks unpaid while the webhook is late;
  Premium still starts only with the captured payment. The page confirms a payment only from the
  subscription that was just paid.
- **Premium access** = the paid period of a captured payment. While Razorpay retries a failed renewal,
  access continues for 3 days. Cancelling stops renewals at once; access lasts to the end of the paid
  period. A full refund ends access for that period. `public.has_premium(uid)` answers this for premium
  content; it never reads `profiles.plan`.
- **Nightly reconciliation** (`/api/billing/reconcile`) re-reads subscriptions, their invoices, payments
  and refunds from Razorpay's API and repairs anything a missed webhook left behind: first every
  subscription Razorpay may still bill and each open checkout, then subscriptions that ended in the last
  40 days (refunds), then replaced checkouts from the last week.
- **Admin → Billing** shows subscribers, the payments ledger (captured, failed with reason, refunded),
  refunds, revenue (captured minus refunded, in INR), plans, and whether webhooks and reconciliation are
  arriving. Test and live records are kept apart; test records are never counted as revenue.
- FITX never stores card numbers, UPI IDs or bank details; Razorpay keeps them. Razorpay's webhooks and
  API answers to FITX's server can include a UPI ID, a card's last four digits, the payer's email and
  phone; the server removes them before anything is stored.

## Owner decisions before anything is charged

1. Which programmes are Premium (the content must exist first), the plans, and their INR prices.
2. Refund rules: which charges are refundable and for how long, partial refunds, reply time.
3. The 3-day grace period after a failed renewal (keep or change).
4. GST registration, whether prices include GST, and the business name on receipts (ask a CA).
5. Approve the wording of `/terms` and `/refunds`, then remove the "To be confirmed by FITX" boxes.
6. Publish a Contact page with business details. Razorpay's website review asks for About, Contact,
   Pricing, Terms, Privacy and Refund pages.
7. Vercel Pro (Hobby is for non-commercial use) and Supabase Pro with backups before taking money.

## 1. Apply the database migration

`supabase/migrations/20261118190000_fitx_billing_razorpay.sql` is additive and seeds nothing. Apply it
through the Supabase connector after the owner's OK. Check afterwards:

```sql
select count(*) from public.billing_plans;            -- 0
select public.has_premium('00000000-0000-0000-0000-000000000000');  -- false
```

## 2. Razorpay test mode

1. Create the Razorpay account (test mode works before KYC) and enable Subscriptions.
2. Dashboard (Test Mode) → Account & Settings → API Keys → generate a test key: `rzp_test_…` and its secret.
3. Dashboard → Subscriptions → Plans → Create plan, for each plan: name, billing frequency, amount in INR.
   Copy each plan id (`plan_…`).

## 3. Add the plans to FITX

Run through the connector (one row per plan; the amount must equal the Razorpay plan's amount):

```sql
insert into public.billing_plans
  (code, name, description, features, amount_paise, billing_period, billing_interval,
   razorpay_plan_id_test, is_active, sort_order)
values
  ('premium-monthly', 'Premium monthly', '<what the owner wants to say>',
   array['<real feature 1>', '<real feature 2>'], 19900, 'monthly', 1,
   'plan_XXXXXXXXXXXXXX', true, 1);
```

`features` must only list things that exist in the app.

To change a price later, create a new Razorpay plan and a new row with its own `code`, then set the old
row's `is_active` to false. Existing subscriptions keep the price they started at (it is stored on each
subscription), whatever later happens to the plan row.

## 4. Webhook

Razorpay Dashboard (Test Mode) → Account & Settings → Webhooks → Add new webhook:

- URL: `https://fitnessx.vercel.app/api/billing/webhook`
- Secret: a long random string (this becomes `RAZORPAY_WEBHOOK_SECRET`)
- Alert email: the owner's
- Events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
  `subscription.completed`, `subscription.updated`, `subscription.pending`, `subscription.halted`,
  `subscription.cancelled`, `subscription.paused`, `subscription.resumed`, `payment.authorized`,
  `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`,
  `refund.speed_changed`

## 5. Environment variables (Vercel → fitnessx → Settings → Environment Variables)

All are server-only (no `NEXT_PUBLIC_`); mark the secrets Sensitive.

| Name | Value |
| --- | --- |
| `RAZORPAY_KEY_ID` | `rzp_test_…` now, `rzp_live_…` at launch |
| `RAZORPAY_KEY_SECRET` | the key's secret |
| `RAZORPAY_WEBHOOK_SECRET` | the webhook's secret |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API keys (same key as the Admin project) |
| `CRON_SECRET` | a long random string |
| `BILLING_TEST_EMAILS` | test mode only: comma-separated emails allowed to use test checkout |

Test mode is limited to `BILLING_TEST_EMAILS` because Razorpay's test cards are public. The public
pricing page lists plans only in live mode. Redeploy after changing variables.

## 6. Nightly reconciliation

Add to `vercel.json` (Vercel sends `Authorization: Bearer $CRON_SECRET` itself):

```json
"crons": [{ "path": "/api/billing/reconcile", "schedule": "30 20 * * *" }]
```

20:30 UTC is 02:00 IST. To run it by hand:
`curl -H "Authorization: Bearer $CRON_SECRET" https://fitnessx.vercel.app/api/billing/reconcile`

## 7. Test checklist (test mode)

1. Sign in with an email listed in `BILLING_TEST_EMAILS` → `/subscription`: plans appear under a
   "Test mode" note.
2. Subscribe → Razorpay Checkout → Razorpay's test card for subscriptions, for example the domestic Visa
   credit card listed in Razorpay's "Test Subscriptions" docs, any CVV and a future expiry date.
3. The page says "Payment received. Waiting for Razorpay to confirm it…", then "Premium is on".
4. Admin → Billing → Test records: the subscriber, a captured payment and "Last webhook received".
5. Renewals are not automatic in test mode: in the Razorpay Dashboard open the subscription and use
   "Charge this now" (success), then "Charge as failure" to see a failed payment with its reason and the
   subscription move to `pending`; four failures make it `halted` and Premium ends.
6. Cancel on `/subscription`: "Renewal cancelled … Premium stays on through <date>"; the Razorpay
   Dashboard shows the subscription cancelled.
7. Refund the payment from the Razorpay Dashboard: the refund appears in Admin; a full refund ends Premium.
8. Run reconciliation by hand (step 6) and check "Last reconciliation" in Admin.

## 8. Going live

1. Complete KYC and Razorpay's website review.
2. Create the same plans in live mode and fill `razorpay_plan_id_live`.
3. Create the live webhook (same URL and events, its own secret) and live API keys.
4. End the testers' test-mode Premium while FITX still runs on the test keys: Premium counts test-mode
   subscriptions too, so a tester would otherwise keep it until their test period ends. In the Razorpay
   test Dashboard cancel each test subscription and refund its payments in full, then check Admin →
   Billing → Test records shows them refunded (a fully refunded period gives no Premium).
5. Update the Vercel variables to the live values and redeploy. `BILLING_TEST_EMAILS` no longer matters.
6. Delete the test-mode webhook. (If it stays, its deliveries fail FITX's signature check with HTTP 400,
   because they are signed with the test webhook's secret, and Razorpay eventually disables it.)
7. Make one real low-value purchase with the owner's own card, check Admin, then refund it.

## Troubleshooting

- "Subscriptions open soon" everywhere: a variable is missing (the server logs
  `[fitx-billing] subscriptions are closed: …`), the keys are test keys, or the migration is not applied.
  "Not on sale right now": billing is set up but no plan is active with a plan id for the current mode.
- Checkout refused with "Subscriptions aren't open right now": the plan's `amount_paise`, period or
  interval does not match the Razorpay plan (logged as `does not match its Razorpay plan`).
- Paid but no Premium: check Admin → Billing → "Last webhook received" and the Razorpay Dashboard's
  webhook delivery log; run reconciliation by hand.
- "You've started several checkouts in the last day": the account started 10 new checkouts in 24 hours
  (logged as `reached the daily limit of new checkouts`). It clears by itself as they age.
- "Razorpay didn't cancel the subscription, so it still renews": Razorpay refused the cancel, for
  example while another change to that subscription was in progress. Trying again a minute later
  works; if it keeps failing, cancel it in the Razorpay Dashboard and the webhook records it.
