import type { Metadata } from "next";
import { Settings2 } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Settings" };

function readiness(value: boolean, optional: boolean) {
  const label = optional ? (value ? "On" : "Off") : value ? "Configured" : "Missing";
  return <span className={`status-pill ${value && !optional ? "status-good" : "status-neutral"}`}><i />{label}</span>;
}

export default async function SettingsPage() {
  await requireAdmin("settings.view");
  const rows = [
    ["NEXT_PUBLIC_SUPABASE_URL", Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), "Supabase project endpoint"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), "Browser-safe authentication key"],
    ["SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY", Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY), "Server-only Admin data access"],
    ["ADMIN_SITE_URL", Boolean(process.env.ADMIN_SITE_URL), "Canonical OAuth callback origin"],
    ["FITX_ADMIN_ALLOWED_EMAILS", Boolean(process.env.FITX_ADMIN_ALLOWED_EMAILS), "Owner-managed sign-in allowlist"],
    ["FITX_SITE_URL", Boolean(process.env.FITX_SITE_URL), "Customer site for password reset links (optional; defaults to fitnessx.vercel.app)"],
    ["FITX_ADMIN_PASSWORD_RESET_EMAILS", process.env.FITX_ADMIN_PASSWORD_RESET_EMAILS === "on", "Password reset emails from People (optional; see the README first)"],
    ["FITX_ADMIN_CSP_REPORT_ONLY", process.env.FITX_ADMIN_CSP_REPORT_ONLY === "1", "Emergency switch: report-only CSP (should be off)"],
  ] as const;
  return <div className="page-stack">
    <div className="page-heading-row"><div><p className="eyebrow">APPLICATION CONFIGURATION</p><h1>Settings</h1><p className="page-lede">Configuration readiness only. Secret values are never displayed.</p></div><span className="page-heading-icon"><Settings2 aria-hidden="true" size={20} /></span></div>
    <section className="table-panel"><div className="table-heading"><div><h2>Environment status</h2><p>Manage values in the private Vercel project environment.</p></div><span className="data-badge">{process.env.VERCEL_ENV ?? "local"}</span></div>
      <div className="settings-list">{rows.map(([name, configured, description]) => <div className="settings-row" key={name}><span><strong>{name}</strong><small>{description}</small></span>{readiness(configured, description.includes("optional") || description.startsWith("Emergency"))}</div>)}</div>
    </section>
    <section className="report-note module-explanation"><p className="eyebrow">AUTHENTICATION</p><h2>Supabase Google OAuth</h2><p>The Admin app uses the existing FITX Supabase project and checks membership on the server after the callback. Add this Admin origin’s /auth/callback to Supabase’s allowed redirect URLs after the domain is assigned. Every session also needs an authenticator code and ends 12 hours after sign-in. Existing FITX callback and OAuth settings are not changed by this application.</p></section>
  </div>;
}
