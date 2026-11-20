// Reads and checks the subscription plan form. Pure; fitx_admin_op_save_billing_plan runs the same rules.
// A plan's price is fixed by its Razorpay plan, so it is only read when a plan is created.
import { checked, lines, oneOf, text, wholeNumber, type FieldErrors, type FormLike } from "./form";

export const PLAN_CODE = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const RAZORPAY_PLAN_ID = /^plan_[A-Za-z0-9]{1,60}$/;

export type PlanPayload = {
  name: string;
  description: string | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
  razorpay_plan_id_test: string | null;
  razorpay_plan_id_live: string | null;
  amount_paise?: number;
  billing_period?: "monthly" | "yearly";
  billing_interval?: number;
};

export type PlanParse = { ok: true; code: string; value: PlanPayload } | { ok: false; errors: FieldErrors };

/** "199", "199.50" or "1,499" rupees → paise; null when it is not a price with at most two decimals. */
export function rupeesToPaise(value: string): number | null {
  const clean = value.replaceAll(",", "").replace(/^₹\s*/, "").trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function parsePlanForm(form: FormLike, { creating, existing }: { creating: boolean; existing?: { test: string | null; live: string | null } }): PlanParse {
  const errors: FieldErrors = {};
  const code = text(form, "code", 60).toLowerCase();
  if (!PLAN_CODE.test(code)) errors.code = "2 to 40 lower-case letters, digits or hyphens.";
  const name = text(form, "name", 80);
  if (!name || name.length > 60) errors.name = "1 to 60 characters.";
  const description = text(form, "description", 320) || null;
  if (description && description.length > 300) errors.description = "Keep it under 300 characters.";
  const features = lines(form, "features", 11, 400);
  if (features.length > 10) errors.features = "At most 10 features.";
  else if (features.join("").length > 1200) errors.features = "At most 1,200 characters in all.";
  const sort = wholeNumber(form, "sort_order") ?? 0;
  if (!Number.isInteger(sort) || sort < -1000 || sort > 1000) errors.sort_order = "-1000 to 1000.";

  const test = existing?.test ?? (text(form, "razorpay_plan_id_test", 80) || null);
  const live = existing?.live ?? (text(form, "razorpay_plan_id_live", 80) || null);
  if (test && !RAZORPAY_PLAN_ID.test(test)) errors.razorpay_plan_id_test = "Looks like plan_…";
  if (live && !RAZORPAY_PLAN_ID.test(live)) errors.razorpay_plan_id_live = "Looks like plan_…";

  const value: PlanPayload = { name, description, features, is_active: checked(form, "is_active"), sort_order: sort, razorpay_plan_id_test: test, razorpay_plan_id_live: live };
  if (creating) {
    const paise = rupeesToPaise(text(form, "price", 20));
    if (paise === null || paise < 100 || paise > 10_000_000) errors.price = "₹1 to ₹1,00,000.";
    const period = oneOf(text(form, "billing_period", 10), ["monthly", "yearly"] as const);
    if (!period) errors.billing_period = "Monthly or yearly.";
    const interval = wholeNumber(form, "billing_interval") ?? 1;
    if (period === "yearly" && interval !== 1) errors.billing_interval = "Yearly plans renew every year.";
    if (period === "monthly" && (!Number.isInteger(interval) || interval < 1 || interval > 12)) errors.billing_interval = "1 to 12 months.";
    if (paise !== null) value.amount_paise = paise;
    if (period) value.billing_period = period;
    value.billing_interval = interval;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, code, value };
}
