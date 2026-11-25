import type { Metadata } from "next";

/** The live workout's title (bug 78); the page is a client component. */
export const metadata: Metadata = { title: "Active workout" };

export default function ActiveWorkoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
