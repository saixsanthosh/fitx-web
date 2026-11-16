import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { logServerError } from "@/lib/log";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  parseOverview,
  parsePayments,
  parsePlans,
  parseRefunds,
  parseSubscribers,
  type BillingMode,
  type BillingOverview,
  type PaymentFilter,
  type PaymentRow,
  type PlanRow,
  type RefundRow,
  type SubscriberRow,
} from "./format";

export const BILLING_PAGE_SIZE = 25;

export type BillingPageData =
  | {
      state: "ready";
      overview: BillingOverview;
      subscribers: { rows: SubscriberRow[]; total: number };
      payments: { rows: PaymentRow[]; total: number };
      refunds: { rows: RefundRow[]; total: number };
      plans: PlanRow[];
    }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

/** The billing migration (supabase/migrations/20261118190000_fitx_billing_razorpay.sql) is not applied. */
function isMissingBillingSchema(code: string | undefined) {
  return ["42P01", "PGRST205", "PGRST204", "PGRST202", "42883", "42703"].includes(code ?? "");
}

/**
 * Billing data straight from the ledger the FITX app writes from verified Razorpay events. Read with
 * the server-only key after requireAdmin(); the browser never receives the key or raw rows.
 */
export async function loadBillingPage({
  mode,
  paymentFilter,
  subscribersPage,
  paymentsPage,
}: {
  mode: BillingMode;
  paymentFilter: PaymentFilter;
  subscribersPage: number;
  paymentsPage: number;
}): Promise<BillingPageData> {
  await requireAdmin();
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" };

  const [overview, subscribers, payments, refunds, plans] = await Promise.all([
    supabase.rpc("billing_admin_overview", { p_mode: mode }),
    supabase.rpc("billing_admin_subscriptions", {
      p_mode: mode,
      p_limit: BILLING_PAGE_SIZE,
      p_offset: (subscribersPage - 1) * BILLING_PAGE_SIZE,
    }),
    supabase.rpc("billing_admin_payments", {
      p_mode: mode,
      p_status: paymentFilter === "all" ? null : paymentFilter,
      p_limit: BILLING_PAGE_SIZE,
      p_offset: (paymentsPage - 1) * BILLING_PAGE_SIZE,
    }),
    supabase.rpc("billing_admin_refunds", { p_mode: mode, p_limit: BILLING_PAGE_SIZE, p_offset: 0 }),
    supabase
      .from("billing_plans")
      .select("code,name,amount_paise,billing_period,billing_interval,is_active,razorpay_plan_id_test,razorpay_plan_id_live,sort_order")
      .order("sort_order")
      .order("amount_paise"),
  ]);

  const error = [overview.error, subscribers.error, payments.error, refunds.error, plans.error].find(Boolean);
  if (error) {
    logServerError("data.billing", error);
    return { state: isMissingBillingSchema(error.code) ? "migration_pending" : "query_failed" };
  }
  const parsedOverview = parseOverview(overview.data);
  if (!parsedOverview) {
    logServerError("data.billing", { message: "the billing overview function returned values that are not totals" });
    return { state: "query_failed" };
  }
  return {
    state: "ready",
    overview: parsedOverview,
    subscribers: parseSubscribers(subscribers.data),
    payments: parsePayments(payments.data),
    refunds: parseRefunds(refunds.data),
    plans: parsePlans(plans.data),
  };
}
