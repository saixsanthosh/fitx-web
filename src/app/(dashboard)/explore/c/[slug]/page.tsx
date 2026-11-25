import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommunityView } from "@/components/social/community/CommunityView";
import { routeSlug } from "@/lib/social/route-params";

type Props = { params: Promise<{ slug: string }> };

/** A malformed address is not found, and titled so (not "Community"). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!routeSlug((await params).slug)) notFound();
  return { title: "Community" };
}

export default async function CommunityBySlugPage({ params }: Props) {
  const value = routeSlug((await params).slug);
  if (!value) notFound();
  return <CommunityView slug={value} />;
}
