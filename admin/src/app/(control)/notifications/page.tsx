import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { UnavailableModule } from "@/components/unavailable-module";

export const metadata: Metadata = { title: "Notifications" };
export default async function NotificationsPage() {
  await requireAdmin();
  return <UnavailableModule title="Notifications" eyebrow="COMMUNICATIONS" description="FITX Admin has no connected notification queue or delivery records yet." icon={Bell} />;
}
