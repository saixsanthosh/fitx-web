import type { Metadata } from "next";
import { ActivityRecorderScreen } from "@/components/activity/ActivityRecorderScreen";

export const metadata: Metadata = { title: "Record activity" };

export default function RecordActivityPage() {
  return <ActivityRecorderScreen />;
}
