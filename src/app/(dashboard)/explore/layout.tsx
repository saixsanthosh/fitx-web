import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ExploreShell } from "@/components/social/ExploreShell";

export const metadata: Metadata = { title: { default: "Explore", template: "%s · Explore · FITX" } };

/** Explore: the member's Explore profile and its navigation stay mounted while they move between its pages. */
export default function ExploreLayout({ children }: { children: ReactNode }) {
  return <ExploreShell>{children}</ExploreShell>;
}
