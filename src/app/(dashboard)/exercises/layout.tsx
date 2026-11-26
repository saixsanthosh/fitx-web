import type { Metadata } from "next";

/**
 * The Exercise library's title (bug 78): the page is a client component. Exercise pages and Browse by muscle set their
 * own, and this layout passes the root's " | FITX" on to them (a plain string here would end the root template for
 * every page below /exercises; re-check of release 3).
 */
export const metadata: Metadata = { title: { default: "Exercise library", template: "%s | FITX" } };

export default function ExercisesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
