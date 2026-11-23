import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoFeed } from "@/components/social/videos/VideoFeed";

export const metadata: Metadata = { title: "Videos" };

/** /explore/videos[?v=<post id>]: short fitness videos, newest first, playing only on tap. */
export default function VideosPage() {
  return (
    <Suspense>
      <VideoFeed />
    </Suspense>
  );
}
