import type { Metadata } from "next";
import { SportScreen } from "@/components/activity/SportScreen";

export const metadata: Metadata = { title: "Run" };

export default function RunPage() {
  return <SportScreen sport="run" />;
}
