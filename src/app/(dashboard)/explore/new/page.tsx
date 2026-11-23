import type { Metadata } from "next";
import { ComposerView } from "@/components/social/ComposerView";

export const metadata: Metadata = { title: "New post" };

export default function NewPostPage() {
  return <ComposerView />;
}
