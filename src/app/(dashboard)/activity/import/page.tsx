import type { Metadata } from "next";
import { ActivityImportScreen } from "@/components/activity/ActivityImportScreen";

export const metadata: Metadata = { title: "Import activities" };

export default function ImportActivitiesPage() {
  return <ActivityImportScreen />;
}
