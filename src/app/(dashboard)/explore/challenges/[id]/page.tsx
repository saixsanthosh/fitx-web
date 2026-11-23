import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChallengeView } from "@/components/social/challenges/ChallengeView";
import { isUuid } from "@/lib/social/paths";

export const metadata: Metadata = { title: "Challenge" };

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const challengeId = id.toLowerCase();
  if (!isUuid(challengeId)) notFound();
  return <ChallengeView id={challengeId} />;
}
