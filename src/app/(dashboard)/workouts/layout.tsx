import type { Metadata } from "next";

/**
 * Workouts' own title (bug 78): the page is a client component, so the title is set here. Sub-pages set their own,
 * and this layout passes the root's " | FITX" on to them: a plain string here would end the root template for every
 * page below /workouts ("Programme", "Workout history" with no suffix; re-check of release 3).
 */
export const metadata: Metadata = { title: { default: "Workouts", template: "%s | FITX" } };

export default function WorkoutsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
