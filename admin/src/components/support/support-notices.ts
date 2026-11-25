// The words a help request's page shows for a Support action's result (sealed into ?notice=, lib/notice.ts) and the
// reply form shows for a refusal. Imports only the support and schema vocabularies (no imports of their own).
import { MIGRATIONS } from "@/lib/schema";
import { SUPPORT_REPLY_MAX } from "@/lib/support-catalog";

export const SUPPORT_NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  replied: { tone: "success", text: "Reply sent. The person sees it on their Help page." },
  updated: { tone: "success", text: "Request updated and recorded in the audit log." },
  reply_length: { tone: "error", text: `A reply needs 1 to ${SUPPORT_REPLY_MAX} characters.` },
  invalid: { tone: "error", text: "Check the status, priority and assignee." },
  assignee: { tone: "error", text: "The assignee must be an active operator with support access." },
  changed: { tone: "error", text: "Nothing was saved: this request changed after you opened it (for example, the person replied). Check the latest version below and save again." },
  forbidden: { tone: "error", text: "Your role cannot change help requests." },
  migration: { tone: "error", text: `This needs migration ${MIGRATIONS.adminV2}.` },
  configuration: { tone: "error", text: "Server data access is not configured." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};
