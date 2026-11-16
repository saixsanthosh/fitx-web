import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { UnavailableModule } from "@/components/unavailable-module";

export const metadata: Metadata = { title: "Notifications" };
export default function NotificationsPage() {
  return <UnavailableModule title="Notifications" eyebrow="COMMUNICATIONS" description="FITX Admin has no connected notification queue or delivery records yet." icon={Bell} />;
}
