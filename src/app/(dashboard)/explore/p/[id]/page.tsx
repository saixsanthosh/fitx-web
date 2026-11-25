import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostView } from "@/components/social/PostView";
import { routeId } from "@/lib/social/route-params";

type Props = { params: Promise<{ id: string }> };

/** A malformed address is not found, and titled so (not "Post"). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!routeId((await params).id)) notFound();
  return { title: "Post" };
}

export default async function PostPage({ params }: Props) {
  const postId = routeId((await params).id);
  if (!postId) notFound();
  return <PostView id={postId} />;
}
