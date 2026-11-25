import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChallengeView } from "@/components/social/challenges/ChallengeView";
import { routeId } from "@/lib/social/route-params";

type Props = { params: Promise<{ id: string }> };

/** A malformed address is not found, and titled so (not "Challenge"). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!routeId((await params).id)) notFound();
  return { title: "Challenge" };
}

export default async function ChallengePage({ params }: Props) {
  const challengeId = routeId((await params).id);
  if (!challengeId) notFound();
  return <ChallengeView id={challengeId} />;
}
