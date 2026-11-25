"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { ADMIN_OPS_MIGRATION, FEATURE_KEYS, LEGACY_FEATURE_KEYS, validateSettingsInput } from "@/components/settings/settings-rules";
import type { FormState } from "@/lib/content/form";
import { savePlatformSettings, type SaveSettingsResult } from "@/lib/data/platform";
import { istInputToIso } from "@/lib/time";

function time(formData: FormData, name: string): string | null | undefined {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  return istInputToIso(raw) ?? undefined;
}

/** What the save bar says when the database refuses a save. */
const REFUSED: Record<Extract<SaveSettingsResult, { ok: false }>["error"], string> = {
  changed: "Someone saved these settings after you opened them. Reload the page to see their changes, then make yours again.",
  forbidden: "Only a super-admin can change settings.",
  invalid: "The database refused these values. Check them and save again.",
  migration: `Settings need migration ${ADMIN_OPS_MIGRATION}.`,
  configuration: "Server data access is not configured.",
  failed: "Not saved. The server log has the details.",
};

/**
 * Saves feature switches, the maintenance notice and website information together (settings.manage); for
 * useActionState. The result comes back to the form's save bar, never through the address.
 */
export async function saveSettings(_previous: FormState, formData: FormData): Promise<FormState> {
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
  if (!checked.ok) return { status: "error", message: checked.error, fieldErrors: { [checked.field]: checked.error } };
  const seen = formData.get("updated_at");
  // The form shows the Explore switches only once 20261124100020 is applied (the older save refuses their keys).
  const keys = formData.get("explore_keys") === "1" ? FEATURE_KEYS : LEGACY_FEATURE_KEYS;
  const result = await savePlatformSettings(actor, checked.value, typeof seen === "string" && seen && !Number.isNaN(Date.parse(seen)) ? seen : null, keys);
  if (!result.ok) return { status: "error", message: REFUSED[result.error] };
  revalidatePath("/settings");
  return { status: "saved", message: "Saved. The app picks it up within a minute." };
}
