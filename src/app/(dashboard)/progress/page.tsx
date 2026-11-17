import type { Metadata } from "next";
import { ProgressView } from "./ProgressView";

export const metadata: Metadata = { title: "Progress" };

/** /progress: trends, what to focus on next, muscles, totals, records and body measurements. */
export default function ProgressPage() {
  return <ProgressView />;
}
