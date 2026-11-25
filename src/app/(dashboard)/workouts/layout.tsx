import type { Metadata } from "next";

/** Workouts' own title (bug 78): the page is a client component, so the title is set here. Sub-pages set their own. */
export const metadata: Metadata = { title: "Workouts" };

export default function WorkoutsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
