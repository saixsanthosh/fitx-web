import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NUTRITION_TITLE } from "./nutrition-title";

/**
 * Nutrition's own title ("Nutrition | FITX"), so browser tabs, history and screen readers' page announcements tell it
 * from the other pages. Its page is a client component, which can't export metadata; the template keeps "| FITX" on
 * the pages under it, such as Food data sources (nutrition-title.ts).
 */
export const metadata: Metadata = { title: NUTRITION_TITLE };

export default function NutritionLayout({ children }: { children: ReactNode }) {
  return children;
}
