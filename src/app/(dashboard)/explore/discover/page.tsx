import type { Metadata } from "next";
import { Suspense } from "react";
import { DiscoverView } from "@/components/social/DiscoverView";

export const metadata: Metadata = { title: "Discover" };

/** /explore/discover[?topic=|?tag=]: search, topics, trending posts, people to follow and the latest posts. */
export default function DiscoverPage() {
  return (
    <Suspense>
      <DiscoverView />
    </Suspense>
  );
}
