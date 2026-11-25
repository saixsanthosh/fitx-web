import type { Metadata } from "next";

/** The Exercise library's title (bug 78): the page is a client component. Exercise pages and Browse by muscle set their own. */
export const metadata: Metadata = { title: "Exercise library" };

export default function ExercisesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
