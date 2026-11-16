import type { Metadata } from "next";
import { CircleHelp } from "lucide-react";
import { UnavailableModule } from "@/components/unavailable-module";

export const metadata: Metadata = { title: "Support" };
export default function SupportPage() {
  return <UnavailableModule title="Support" eyebrow="CUSTOMER CARE" description="There is no FITX support-ticket or feedback table connected to the current project." icon={CircleHelp} />;
}
