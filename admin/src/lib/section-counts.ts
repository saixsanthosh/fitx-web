// The menu's badges (Support's unread help requests, Explore's waiting reports), as pure rules with no imports, so tests
// can load them. The console layout counts the badges when it draws, but Next.js draws it alongside the page, not after
// it, and keeps it as it is while the operator moves between pages. So a page that changes a count (opening an unread
// help request marks it read) or reads it afresh tells the menu (components/section-counts.tsx). Every count carries the
// server time it was asked for: the newest count wins, and on a tie a page's count wins over the layout's.

/** A count as the server read it, null when it could not be known (no badge, never 0), and when it was asked for. */
export type StampedCount = { count: number | null; at: number };

/** Stamped counts by section route ("/support", "/explore"). */
export type StampedCounts = Readonly<Record<string, StampedCount>>;

/** What the menu draws: the known counts by section route. */
export type SectionCounts = Readonly<Record<string, number>>;

const own = (counts: StampedCounts, href: string): StampedCount | undefined => (Object.hasOwn(counts, href) ? counts[href] : undefined);

/**
 * The reports held once a page reports `next` for `href`. A report older than the one held changes nothing (a page
 * shown again by Back still carries the count it was drawn with), and the same report again returns the same object.
 */
export function withReport(held: StampedCounts, href: string, next: StampedCount): StampedCounts {
  const current = own(held, href);
  if (current && (current.at > next.at || (current.at === next.at && current.count === next.count))) return held;
  return { ...held, [href]: next };
}

/**
 * The counts the menu draws: per route, the layout's count, unless a page reported one asked for at the same time or
 * later. A count that could not be known is left out, so no badge shows: neither 0 nor an older number.
 */
export function shownCounts(layout: StampedCounts, reports: StampedCounts): SectionCounts {
  const shown: Record<string, number> = {};
  for (const href of new Set([...Object.keys(layout), ...Object.keys(reports)])) {
    const counted = own(layout, href);
    const report = own(reports, href);
    const newest = report && (!counted || report.at >= counted.at) ? report : counted;
    if (typeof newest?.count === "number") shown[href] = newest.count;
  }
  return shown;
}
