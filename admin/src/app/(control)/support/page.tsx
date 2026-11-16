import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { UnavailableModule } from "@/components/unavailable-module";

export const metadata: Metadata = { title: "Support" };
export default async function SupportPage() {
  await requireAdmin();
  return <UnavailableModule title="Support" eyebrow="CUSTOMER CARE" description="There is no FITX support-ticket or feedback table connected to the current project." icon={CircleHelp} />;
}
