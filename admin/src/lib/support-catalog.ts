// Support request vocabulary, shared by the Admin screens and actions. No imports.
// The same values are enforced by check constraints in supabase/migrations/20261118180005_fitx_support.sql
// and 20261121100033_fitx_admin_ops.sql.

export const SUPPORT_STATUSES = ["open", "in_progress", "waiting_on_user", "resolved", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

// "complaint" needs migration 20261121100033_fitx_admin_ops (it widens the check constraint).
export const SUPPORT_CATEGORIES = ["question", "problem", "complaint", "feedback", "account", "other"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_user: "Waiting for the person",
  resolved: "Resolved",
  closed: "Closed",
};

export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  question: "Question",
  problem: "Something is not working",
  complaint: "Complaint",
  feedback: "Feedback or idea",
  account: "Account and sign-in",
  other: "Other",
};

export const SUPPORT_REPLY_MAX = 4000;

export function isSupportStatus(value: unknown): value is SupportStatus {
  return typeof value === "string" && (SUPPORT_STATUSES as readonly string[]).includes(value);
}

export function isSupportPriority(value: unknown): value is SupportPriority {
  return typeof value === "string" && (SUPPORT_PRIORITIES as readonly string[]).includes(value);
}

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

/** Short labels for the inbox tabs. */
export const SUPPORT_CATEGORY_SHORT: Record<SupportCategory, string> = {
  question: "Questions",
  problem: "Problems",
  complaint: "Complaints",
  feedback: "Feedback",
  account: "Account",
  other: "Other",
};
