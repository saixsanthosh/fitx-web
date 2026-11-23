"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { FEATURE_KEYS, LEGACY_FEATURE_KEYS, validateSettingsInput } from "@/components/settings/settings-rules";
import { savePlatformSettings } from "@/lib/data/platform";
import { istInputToIso } from "@/lib/time";

function time(formData: FormData, name: string): string | null | undefined {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  return istInputToIso(raw) ?? undefined;
}

/** Saves feature switches, the maintenance notice and website information together (settings.manage). */
export async function saveSettings(formData: FormData) {
  const actor = await requireAdmin("settings.manage");
  const checked = validateSettingsInput({
    features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, formData.get(`feature_${key}`) === "on"])),
    maintenanceOn: formData.get("maintenance_on") === "on",
    maintenanceTitle: formData.get("maintenance_title"),
    maintenanceBody: formData.get("maintenance_body"),
    startsAt: time(formData, "maintenance_starts"),
    endsAt: time(formData, "maintenance_ends"),
    supportEmail: formData.get("support_email"),
    instagramUrl: formData.get("instagram_url"),
  });
  if (!checked.ok) redirect(`/settings?state=invalid&message=${encodeURIComponent(checked.error)}`);
  const seen = formData.get("updated_at");
  // The form shows the Explore switches only once 20261124100020 is applied (the older save refuses their keys).
  const keys = formData.get("explore_keys") === "1" ? FEATURE_KEYS : LEGACY_FEATURE_KEYS;
  const result = await savePlatformSettings(actor, checked.value, typeof seen === "string" && seen && !Number.isNaN(Date.parse(seen)) ? seen : null, keys);
  revalidatePath("/settings");
  redirect(`/settings?state=${result.ok ? "saved" : result.error}`);
}
