import type { Metadata } from "next";
import { ProgressView } from "./ProgressView";

export const metadata: Metadata = { title: "Progress" };

/** /progress: a week, month or year of training, food, weight, records and goals, from the member's own logs. */
export default function ProgressPage() {
  return <ProgressView />;
}
