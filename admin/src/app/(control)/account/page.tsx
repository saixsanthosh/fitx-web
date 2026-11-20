import type { Metadata } from "next";
import { Notice, PageHead, Panel } from "@/components/console/ui";
import { PendingButton } from "@/components/pending-button";
import { requireAdmin } from "@/lib/admin-auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { ROLE_LABELS } from "@/lib/roles";
import { firstParam } from "@/lib/search-params";
import { changePassword } from "./actions";

export const metadata: Metadata = { title: "Your account" };

const notices: Record<string, { tone: "success" | "error"; text: string }> = {
  changed: { tone: "success", text: "Password changed. Your other sessions have ended." },
  mismatch: { tone: "error", text: "The new passwords do not match." },
  wrong_password: { tone: "error", text: "Your current password is not right." },
  weak_password: { tone: "error", text: `Use at least ${MIN_PASSWORD_LENGTH} characters.` },
  same_password: { tone: "error", text: "Choose a new password." },
  root_protected: { tone: "error", text: "The owner password is changed with npm run admin:hash." },
  unavailable: { tone: "error", text: "Server data access is not ready." },
  failed: { tone: "error", text: "The password was not changed. The server log has the details." },
};

// The minimal own-password page the sign-in contract needs; the admin-core stream owns its look.
export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const operator = await requireAdmin();
  const state = firstParam((await searchParams).state);
  const notice = state ? notices[state] : undefined;
  return <div className="page-stack narrow-stack">
    <PageHead eyebrow={ROLE_LABELS[operator.role]} title={operator.username} meta="Your account" />
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {operator.mustChangePassword && <Notice tone="error">Choose your own password to continue.</Notice>}
    {operator.isRoot ? <section className="report-note module-explanation"><h2>Owner password</h2><p>Make a new hash with npm run admin:hash, set FITX_ADMIN_PASSWORD_HASH in Vercel and redeploy. Every open session ends.</p></section> : <Panel title="Change password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`} flush>
      <form action={changePassword} className="member-form">
        <input type="text" name="username" autoComplete="username" value={operator.username} readOnly hidden />
        <label>Current password<input type="password" name="current_password" autoComplete="current-password" required maxLength={256} /></label>
        <label>New password<input type="password" name="next_password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={256} /></label>
        <label>Repeat new password<input type="password" name="confirm_password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={256} /></label>
        <PendingButton className="primary-button" pendingLabel="Saving">Change password</PendingButton>
      </form>
    </Panel>}
  </div>;
}
