import type { BillingPeriod } from "./types";

const wholeRupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const rupeesAndPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** 19900 paise -> "₹199"; 19950 -> "₹199.50". Amounts are always stored in paise (integers). */
export function formatInr(paise: number): string {
  if (!Number.isFinite(paise)) return "—";
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? wholeRupees.format(rupees) : rupeesAndPaise.format(rupees);
}

/** Formats an amount in its own currency; billing is INR, but a payment row may say otherwise. */
export function formatAmount(minorUnits: number, currency = "INR"): string {
  if (currency === "INR") return formatInr(minorUnits);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}

/** "per month", "every 3 months", "per year". */
export function periodLabel(period: BillingPeriod, interval = 1): string {
  if (period === "yearly") return interval === 1 ? "per year" : `every ${interval} years`;
  return interval === 1 ? "per month" : `every ${interval} months`;
}

/** "month", "3 months", "year": the length of one paid period. */
export function periodLength(period: BillingPeriod, interval = 1): string {
  const unit = period === "yearly" ? "year" : "month";
  return interval === 1 ? unit : `${interval} ${unit}s`;
}

/** Razorpay charges a subscription for at most 10 years, so it runs that many billing cycles. */
export function billingCyclesForTenYears(period: BillingPeriod, interval = 1): number {
  const months = period === "yearly" ? 12 * interval : interval;
  return Math.max(1, Math.floor(120 / months));
}
