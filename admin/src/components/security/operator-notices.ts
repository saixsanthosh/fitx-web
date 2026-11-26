// What Access control says after an action on operators, in Admin's own fixed words: a result sealed into ?state= by
// the Server Action that redirects (lib/notice.ts), or Add operator's refusal beside its button while the form keeps
// the username and role as typed (BUGS.md 63). Never text from the address. Server code only (lib/password.ts uses
// node:crypto); tests can load it.
import type { FormState } from "@/lib/content/form";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

export const OPERATOR_NOTICES: Record<string, { tone: "success" | "error"; text: string }> = {
  created: { tone: "success", text: "Operator added. They choose their own password at first sign-in." },
  saved: { tone: "success", text: "Operator updated and recorded in the audit log." },
  password_reset: { tone: "success", text: "Temporary password set. Their open sessions have ended." },
  forbidden: { tone: "error", text: "Only a super-admin can change operators." },
  invalid: { tone: "error", text: "Check the details and try again." },
  invalid_username: { tone: "error", text: "Usernames are 3 to 32 characters: a to z, 0 to 9, dot, dash or underscore." },
  reserved_username: { tone: "error", text: "That username is reserved." },
  username_taken: { tone: "error", text: "That username is taken." },
  invalid_role: { tone: "error", text: "Choose a role." },
  weak_password: { tone: "error", text: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.` },
  same_password: { tone: "error", text: "Choose a different password." },
  not_found: { tone: "error", text: "That operator no longer exists." },
  root_protected: { tone: "error", text: "The owner account cannot be changed here." },
  self: { tone: "error", text: "You cannot change your own access here." },
  confirm_needed: { tone: "error", text: "Tick the confirmation box first." },
  unavailable: { tone: "error", text: "Server data access is not ready." },
  failed: { tone: "error", text: "The change did not complete. The server log has the details." },
};

/** The Add operator field (its input's name) a refusal is about: marked, described by the message and focused. */
const OPERATOR_FIELDS: Record<string, string> = {
  invalid_username: "username", reserved_username: "username", username_taken: "username", invalid_role: "role", weak_password: "password",
};

/** Add operator's refusal, in Access control's words, naming its field; an unknown code reads as a failure. */
export function operatorRefusal(code: string): FormState {
  const message = (Object.hasOwn(OPERATOR_NOTICES, code) ? OPERATOR_NOTICES[code] : OPERATOR_NOTICES.failed).text;
  const field = Object.hasOwn(OPERATOR_FIELDS, code) ? OPERATOR_FIELDS[code] : undefined;
  return { status: "error", message, fieldErrors: field ? { [field]: message } : undefined };
}
