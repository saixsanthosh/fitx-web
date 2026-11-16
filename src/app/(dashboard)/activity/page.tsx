import type { Metadata } from "next";
import { ActivityHome } from "@/components/activity/ActivityHome";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <ActivityHome />;
}
