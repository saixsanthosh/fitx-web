import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostView } from "@/components/social/PostView";
import { isUuid } from "@/lib/social/paths";

export const metadata: Metadata = { title: "Post" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const postId = id.toLowerCase();
  if (!isUuid(postId)) notFound();
  return <PostView id={postId} />;
}
