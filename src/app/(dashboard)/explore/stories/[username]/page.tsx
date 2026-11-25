import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoryViewer } from "@/components/social/stories/StoryViewer";
import { routeUsername } from "@/lib/social/route-params";

type Props = { params: Promise<{ username: string }> };

/** Titled with whose stories open first ("Story by @ben.okafor · Explore · FITX"); a malformed address is not found. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = routeUsername((await params).username);
  if (!name) notFound();
  return { title: `Story by @${name}` };
}

/** /explore/stories/<username>: that account's live stories, then the next accounts in the tray. */
export default async function StoryPage({ params }: Props) {
  const name = routeUsername((await params).username);
  if (!name) notFound();
  return <StoryViewer key={name} username={name} />;
}
