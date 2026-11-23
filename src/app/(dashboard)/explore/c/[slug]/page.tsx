import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommunityView } from "@/components/social/community/CommunityView";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityBySlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const value = slug.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value)) notFound();
  return <CommunityView slug={value} />;
}
