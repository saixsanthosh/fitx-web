import type { Metadata } from "next";
import { SportScreen } from "@/components/activity/SportScreen";

export const metadata: Metadata = { title: "Walk" };

export default function WalkPage() {
  return <SportScreen sport="walk" />;
}
