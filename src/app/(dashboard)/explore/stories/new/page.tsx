import type { Metadata } from "next";
import { StoryComposer } from "@/components/social/stories/StoryComposer";

export const metadata: Metadata = { title: "New story" };

export default function NewStoryPage() {
  return <StoryComposer />;
}
