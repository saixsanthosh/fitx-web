/** Shapes of the Razorpay ids FITX stores or passes back to Razorpay. Anything else is rejected. */
export const RAZORPAY_ID_PATTERNS = {
  plan: /^plan_[A-Za-z0-9]{1,60}$/,
  subscription: /^sub_[A-Za-z0-9]{1,60}$/,
  payment: /^pay_[A-Za-z0-9]{1,60}$/,
  invoice: /^inv_[A-Za-z0-9]{1,60}$/,
  refund: /^rfnd_[A-Za-z0-9]{1,60}$/,
  order: /^order_[A-Za-z0-9]{1,60}$/,
  customer: /^cust_[A-Za-z0-9]{1,60}$/,
} as const;

export type RazorpayIdKind = keyof typeof RAZORPAY_ID_PATTERNS;

export const isRazorpayId = (kind: RazorpayIdKind, value: unknown): value is string =>
  typeof value === "string" && RAZORPAY_ID_PATTERNS[kind].test(value);
