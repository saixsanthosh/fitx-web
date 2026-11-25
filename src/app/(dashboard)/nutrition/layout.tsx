import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Nutrition's own title ("Nutrition | FITX"), so browser tabs, history and screen readers' page announcements tell it
 * from the other pages. Its page is a client component, which can't export metadata; Food data sources keeps its own.
 */
export const metadata: Metadata = { title: "Nutrition" };

export default function NutritionLayout({ children }: { children: ReactNode }) {
  return children;
}
