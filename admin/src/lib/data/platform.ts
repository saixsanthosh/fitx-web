import "server-only";
import { hasPermission, requireAdmin, type AdminOperator } from "@/lib/admin-auth";
import { parseSettingsRow, type PlatformSettingsValue } from "@/components/settings/settings-rules";
import { logServerError } from "@/lib/log";
import { isMissingSchema, isPermissionError } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type PlatformSettingsResult =
  | { state: "ready"; settings: PlatformSettingsValue; updatedAt: string | null; updatedBy: string | null }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

/** The one platform_settings row, as the Settings screen edits it (settings.view). */
export async function getPlatformSettings(): Promise<PlatformSettingsResult> {
  await requireAdmin("settings.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  const { data, error } = await admin.from("platform_settings").select("features,maintenance,site,updated_at,updated_by_operator_id").eq("id", 1).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { state: "migration_pending" };
    logServerError("data.platform_settings", error);
    return { state: "query_failed" };
  }
  const parsed = parseSettingsRow(data);
  let updatedBy: string | null = null;
  const operatorId = (data as { updated_by_operator_id?: string | null } | null)?.updated_by_operator_id;
  if (operatorId) {
    const who = await admin.from("admin_operators").select("username").eq("id", operatorId).maybeSingle();
    updatedBy = typeof who.data?.username === "string" ? who.data.username : null;
  }
  const { updatedAt, ...settings } = parsed;
  return { state: "ready", settings, updatedAt: data ? updatedAt : null, updatedBy };
}

export type SaveSettingsResult = { ok: true } | { ok: false; error: "forbidden" | "changed" | "invalid" | "migration" | "configuration" | "failed" };

/** Saves every part at once; the database checks settings.manage again, refuses stale saves and audits. */
export async function savePlatformSettings(actor: AdminOperator, value: PlatformSettingsValue, expectedUpdatedAt: string | null): Promise<SaveSettingsResult> {
  if (!hasPermission(actor, "settings.manage")) return { ok: false, error: "forbidden" };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "configuration" };
  const { error } = await admin.rpc("fitx_admin_op_save_platform_settings", {
    p_operator_id: actor.id,
    p_features: value.features,
    p_maintenance: value.maintenance,
    p_site: value.site,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (!error) return { ok: true };
  if (isMissingSchema(error)) return { ok: false, error: "migration" };
  if (isPermissionError(error)) return { ok: false, error: "forbidden" };
  if (error.code === "40001") return { ok: false, error: "changed" };
  if (error.code === "22023") return { ok: false, error: "invalid" };
  logServerError("data.save_platform_settings", error);
  return { ok: false, error: "failed" };
}
