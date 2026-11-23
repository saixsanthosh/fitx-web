import type { Metadata } from "next";
import { Suspense } from "react";
import { ChallengesView } from "@/components/social/challenges/ChallengesView";

export const metadata: Metadata = { title: "Challenges" };

/** /explore/challenges[?box=closed]: weekly and monthly challenges, and the member's past ones. */
export default function ChallengesPage() {
  return (
    <Suspense>
      <ChallengesView />
    </Suspense>
  );
}
