import type { Metadata } from "next";

/** Browse by muscle's title (bug 78); the page is a client component. */
export const metadata: Metadata = { title: "Browse by muscle" };

export default function BrowseByMuscleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
