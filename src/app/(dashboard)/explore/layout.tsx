import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ExploreShell } from "@/components/social/ExploreShell";
import { EXPLORE_TITLE_TEMPLATE } from "@/lib/social/titles";

export const metadata: Metadata = { title: { default: "Explore", template: EXPLORE_TITLE_TEMPLATE } };

/** Explore: the member's Explore profile and its navigation stay mounted while they move between its pages. */
export default function ExploreLayout({ children }: { children: ReactNode }) {
  return <ExploreShell>{children}</ExploreShell>;
}
