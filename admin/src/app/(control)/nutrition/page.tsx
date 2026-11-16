import type { Metadata } from "next";
import { Apple } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { UnavailableModule } from "@/components/unavailable-module";

export const metadata: Metadata = { title: "Nutrition" };
export default async function NutritionPage() {
  await requireAdmin();
  return <UnavailableModule title="Nutrition" eyebrow="FOOD DATA" description="The current FITX schema contains personal meal logs, not an admin-managed public food catalog." icon={Apple} />;
}
