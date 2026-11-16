"use server";

import { redirect } from "next/navigation";
import { requireAdminIdentity } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { logServerError } from "@/lib/log";
import { normaliseTotpCode } from "@/lib/session-policy";
import { createUserSupabase } from "@/lib/supabase/server";

export type SetupState = {
  factorId?: string;
  qrCode?: string;
  secret?: string;
  error?: "start_failed" | "invalid_code" | "verify_failed";
} | null;

export type CodeState = { error?: "invalid_code" | "verify_failed" } | null;

const SVG_DATA_PREFIX = "data:image/svg+xml;utf-8,";

/** Supabase returns the QR code as an SVG data URL with raw markup; a "#" in it would end the URL early. */
function safeQrDataUrl(value: string): string {
  const svg = value.startsWith(SVG_DATA_PREFIX) ? value.slice(SVG_DATA_PREFIX.length) : value;
  return svg.trimStart().startsWith("<") ? `${SVG_DATA_PREFIX}${encodeURIComponent(svg)}` : value;
}

/**
 * Sets up an authenticator app: "start" creates a new TOTP factor and returns its QR code; "confirm"
 * checks the first code, which also raises this session to AAL2.
 */
export async function setUpAuthenticator(previous: SetupState, formData: FormData): Promise<SetupState> {
  const identity = await requireAdminIdentity();
  if (identity.hasAuthenticator) redirect("/mfa");
  const supabase = await createUserSupabase();
  if (!supabase) return { error: "start_failed" };

  if (formData.get("intent") === "start") {
    // Unfinished set-ups from earlier visits are removed first, so the name stays free.
    const factors = await supabase.auth.mfa.listFactors();
    for (const factor of factors.data?.all ?? []) {
      if (factor.factor_type === "totp" && factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "FITX Admin", issuer: "FITX Admin" });
    if (error || !data || data.type !== "totp") {
      logServerError("mfa.enroll", error);
      return { error: "start_failed" };
    }
    return { factorId: data.id, qrCode: safeQrDataUrl(data.totp.qr_code), secret: data.totp.secret };
  }

  const factorId = formData.get("factorId");
  const code = normaliseTotpCode(formData.get("code"));
  if (typeof factorId !== "string" || !factorId) return { ...previous, error: "verify_failed" };
  if (!code) return { ...previous, error: "invalid_code" };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    await logAdminEvent({ actorId: identity.user.id, action: "admin_mfa_failed", resourceType: "admin_session", details: { step: "setup" } });
    return { ...previous, error: "invalid_code" };
  }
  await logAdminEvent({ actorId: identity.user.id, action: "admin_mfa_enrolled", resourceType: "admin_session" });
  redirect("/overview");
}

/** Checks the authenticator code for this session; success raises it to AAL2. */
export async function verifyAuthenticatorCode(_previous: CodeState, formData: FormData): Promise<CodeState> {
  const identity = await requireAdminIdentity();
  const code = normaliseTotpCode(formData.get("code"));
  if (!code) return { error: "invalid_code" };
  const supabase = await createUserSupabase();
  if (!supabase) return { error: "verify_failed" };

  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp.find((candidate) => candidate.status === "verified");
  if (!factor) redirect("/mfa/setup");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    await logAdminEvent({ actorId: identity.user.id, action: "admin_mfa_failed", resourceType: "admin_session", details: { step: "sign_in" } });
    return { error: "invalid_code" };
  }
  await logAdminEvent({ actorId: identity.user.id, action: "admin_mfa_verified", resourceType: "admin_session" });
  redirect("/overview");
}
