// The Users list's filters and labels. No imports, so tests can load it.

export const PEOPLE_STATUSES = ["active", "suspended", "unconfirmed"] as const;
export type PeopleStatus = (typeof PEOPLE_STATUSES)[number];
export const PEOPLE_STATUS_LABELS: Record<PeopleStatus, string> = { active: "Active", suspended: "Suspended", unconfirmed: "Unconfirmed" };

/** Sign-in methods as Supabase Auth names them. Email covers both the email code and a password. */
export const SIGN_IN_METHODS = ["google", "email", "phone", "apple"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];
export const METHOD_LABELS: Record<string, string> = { google: "Google", email: "Email", phone: "Phone", apple: "Apple" };

export const PEOPLE_PLANS = ["premium", "free"] as const;
export type PeoplePlan = (typeof PEOPLE_PLANS)[number];
export const PLAN_LABELS: Record<PeoplePlan, string> = { premium: "Premium", free: "Free" };

/** At most this many accounts are suspended in one go. */
export const BULK_SUSPEND_MAX = 50;

export type PeopleFilters = { q: string; status: PeopleStatus | null; method: SignInMethod | null; plan: PeoplePlan | null; page: number };

type SearchParams = Record<string, string | string[] | undefined>;

function first(params: SearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

function oneOf<T extends string>(list: readonly T[], value: string): T | null {
  return (list as readonly string[]).includes(value) ? (value as T) : null;
}

export function parsePeopleFilters(params: SearchParams): PeopleFilters {
  const page = Number(first(params, "page") || "1");
  return {
    q: first(params, "q").trim().slice(0, 120),
    status: oneOf(PEOPLE_STATUSES, first(params, "status")),
    method: oneOf(SIGN_IN_METHODS, first(params, "method")),
    plan: oneOf(PEOPLE_PLANS, first(params, "plan")),
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

/** The filters as a link to /users; empty values are left out. */
export function peopleHref(filters: PeopleFilters, overrides: Partial<PeopleFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.q) query.set("q", merged.q);
  if (merged.status) query.set("status", merged.status);
  if (merged.method) query.set("method", merged.method);
  if (merged.plan) query.set("plan", merged.plan);
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return `/users${text ? `?${text}` : ""}`;
}

export function hasFilters(filters: PeopleFilters): boolean {
  return Boolean(filters.q || filters.status || filters.method || filters.plan);
}

/** Sign-in methods in a fixed order, unknown ones last, labelled. */
export function methodLabels(providers: readonly string[]): string[] {
  const order = (value: string) => {
    const index = (SIGN_IN_METHODS as readonly string[]).indexOf(value);
    return index === -1 ? SIGN_IN_METHODS.length : index;
  };
  return [...new Set(providers)].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((value) => METHOD_LABELS[value] ?? value);
}

/** The subscription column: what Razorpay says about the latest live subscription. null = could not be read. */
export function subscriptionLabel(status: string | null | undefined, premium: boolean | null | undefined): { text: string; tone: "good" | "warn" | "neutral" } | null {
  if (premium === null || premium === undefined) return null;
  if (premium) return { text: status === "cancelled" ? "Premium until period end" : "Premium", tone: "good" };
  if (!status) return { text: "Free", tone: "neutral" };
  const words: Record<string, string> = {
    created: "Checkout started", authenticated: "Awaiting first payment", active: "Active", pending: "Payment pending", halted: "Payment failed",
    paused: "Paused", cancelled: "Cancelled", completed: "Completed", expired: "Expired",
  };
  return { text: words[status] ?? status, tone: status === "halted" || status === "pending" ? "warn" : "neutral" };
}

/** Selected account IDs from the list's checkboxes: valid IDs only, each once. */
export function selectedIds(values: unknown[]): string[] {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(values.filter((value): value is string => typeof value === "string" && UUID.test(value)).map((value) => value.toLowerCase()))];
}

/** A phone number as Auth stores it (digits, no plus) for display: "+919812345678". */
export function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  return digits ? `+${digits}` : null;
}

export type DeleteConfirmation = { kind: "email" | "phone" | "id"; expected: string; label: string };

/**
 * What the operator types before deleting an account: its email; for an account with no email, its phone
 * number; with neither, the first 8 characters of its account ID.
 */
export function deleteConfirmation(account: { id: string; email?: string | null; phone?: string | null }): DeleteConfirmation {
  if (account.email) return { kind: "email", expected: account.email, label: "Type the account email to confirm" };
  const phone = formatPhone(account.phone);
  if (phone) return { kind: "phone", expected: phone, label: "Type the account phone number to confirm" };
  return { kind: "id", expected: account.id.slice(0, 8), label: "Type the first 8 characters of the account ID to confirm" };
}

/** Whether the typed text confirms deleting this account (letter case, spaces and phone punctuation aside). */
export function confirmsDeletion(typed: unknown, account: { id: string; email?: string | null; phone?: string | null }): boolean {
  if (typeof typed !== "string" || !typed.trim()) return false;
  const { kind, expected } = deleteConfirmation(account);
  if (kind === "phone") return typed.replace(/[^0-9]/g, "") === expected.slice(1);
  return typed.trim().toLowerCase() === expected.toLowerCase();
}
