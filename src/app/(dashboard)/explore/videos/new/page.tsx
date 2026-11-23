import type { Metadata } from "next";
import { VideoComposer } from "@/components/social/videos/VideoComposer";

export const metadata: Metadata = { title: "New video" };

export default function NewVideoPage() {
  return <VideoComposer />;
}
