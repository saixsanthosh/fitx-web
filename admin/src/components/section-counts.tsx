"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { shownCounts, withReport, type SectionCounts, type StampedCount, type StampedCounts } from "@/lib/section-counts";

const NO_REPORTS: StampedCounts = {};
const NO_COUNTS: SectionCounts = {};
const ShownCounts = createContext<SectionCounts>(NO_COUNTS);
const ReportCount = createContext<((href: string, count: StampedCount) => void) | null>(null);
// Before the browser paints, so a page and the menu's new count appear together (useEffect on the server).
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The menu's badge counts for the whole console: the layout's, and any newer count a page reports (lib/section-counts.ts).
 * It sits in the layout, so what pages report is kept while the operator moves between pages, as the layout is.
 */
export function SectionCountsProvider({ counts, children }: { counts: StampedCounts; children: React.ReactNode }) {
  const [reports, setReports] = useState<StampedCounts>(NO_REPORTS);
  const report = useCallback((href: string, count: StampedCount) => setReports((held) => withReport(held, href, count)), []);
  const shown = useMemo(() => shownCounts(counts, reports), [counts, reports]);
  return (
    <ReportCount value={report}>
      <ShownCounts value={shown}>{children}</ShownCounts>
    </ReportCount>
  );
}

/** The counts the menu draws (Support's unread, Explore's waiting), by section route. */
export function useSectionCounts(): SectionCounts {
  return useContext(ShownCounts);
}

/**
 * Drawn by a page that changed a menu count or read it afresh: it gives the menu that count, stamped with the server
 * time it was asked for, and draws nothing itself.
 */
export function SectionCountReport({ href, count, at }: { href: string; count: number | null; at: number }) {
  const report = useContext(ReportCount);
  useIsomorphicLayoutEffect(() => {
    report?.(href, { count, at });
  }, [report, href, count, at]);
  return null;
}
