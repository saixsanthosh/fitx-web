import type { Metadata } from "next";
import { StoriesView } from "@/components/social/stories/StoriesView";

export const metadata: Metadata = { title: "Stories" };

/** /explore/stories: the story tray on its own (the feed shows it on top once it is switched in). */
export default function StoriesPage() {
  return <StoriesView />;
}
