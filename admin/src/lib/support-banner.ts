// The Dashboard's help-request banner, in the Support inbox's own words and numbers ("need attention", "unread"), so
// the banner and the inbox it opens always agree (BUGS.md 64). Type imports only, so tests can load it.
import type { SupportStatus } from "@/lib/support-catalog";

/** What the inbox counts: requests per status and unread requests; null for a count that could not be read. */
export type SupportSummary = { byStatus: Record<SupportStatus, number | null>; unread: number | null };

/** The statuses that need attention, as the inbox's "Needs attention" tab counts them. */
export const ATTENTION_STATUSES = ["open", "in_progress", "waiting_on_user"] as const satisfies readonly SupportStatus[];

/** Requests that need attention, or null when any of their counts is unknown (never a partial sum, never 0 for unknown). */
export function needingAttention(byStatus: Record<SupportStatus, number | null>): number | null {
  let sum = 0;
  for (const status of ATTENTION_STATUSES) {
    const count = byStatus[status];
    if (count === null) return null;
    sum += count;
  }
  return sum;
}

const number = (count: number) => count.toLocaleString("en-IN");

/**
 * The banner, or null when nothing needs attention and nothing is unread. It stays while the total is unknown
 * ("Not known", never 0). Unread is left out before the inbox can count it. With only unread requests it opens the
 * inbox's Unread tab; otherwise its default, Needs attention.
 */
export function supportBanner(summary: SupportSummary | null): { href: string; text: string } | null {
  if (!summary) return null;
  const attention = needingAttention(summary.byStatus);
  const unread = summary.unread;
  if (attention === 0) {
    if (!unread) return null;
    return { href: "/support?status=all&unread=1", text: `${number(unread)} unread help ${unread === 1 ? "request" : "requests"}` };
  }
  const lead = attention === null
    ? "Help requests needing attention: Not known"
    : `${number(attention)} help ${attention === 1 ? "request needs" : "requests need"} attention`;
  return { href: "/support", text: unread === null ? lead : `${lead} · ${number(unread)} unread` };
}
