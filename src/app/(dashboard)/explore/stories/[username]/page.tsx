import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoryViewer } from "@/components/social/stories/StoryViewer";

export const metadata: Metadata = { title: "Story" };

/** /explore/stories/<username>: that account's live stories, then the next accounts in the tray. */
export default async function StoryPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const name = decodeURIComponent(username).replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(name)) notFound();
  return <StoryViewer key={name} username={name} />;
}
