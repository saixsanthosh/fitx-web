// Targeted notices typed in Admin. No imports, so tests can load it. fitx_admin_op_send_notifications
// (20261121100033_fitx_admin_ops.sql) checks the same limits again.

/** The database's limit per send. */
export const NOTICE_MAX_RECIPIENTS = 500;
/** Emails are looked up one by one, so a pasted list is capped lower; pick larger groups on Users. */
export const NOTICE_MAX_TYPED = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[A-Za-z]{2,}$/;

export type RecipientList = { ids: string[]; emails: string[]; invalid: string[] };

/** Account IDs and emails from a pasted list (commas, spaces, semicolons or new lines), each once. */
export function parseRecipients(raw: unknown): RecipientList {
  const tokens = typeof raw === "string" ? raw.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean) : [];
  const ids = new Set<string>();
  const emails = new Set<string>();
  const invalid: string[] = [];
  for (const token of tokens.slice(0, NOTICE_MAX_RECIPIENTS + 50)) {
    if (UUID.test(token)) ids.add(token.toLowerCase());
    else if (EMAIL.test(token) && token.length <= 254) emails.add(token.toLowerCase());
    else invalid.push(token.slice(0, 60));
  }
  return { ids: [...ids], emails: [...emails], invalid };
}

/** The recipients field prefilled from Users (?to=id,id). Only account IDs pass. */
export function recipientsFromQuery(value: string): string {
  return [...new Set(value.split(",").map((id) => id.trim().toLowerCase()).filter((id) => UUID.test(id)))].slice(0, NOTICE_MAX_RECIPIENTS).join("\n");
}

export const NOTICE_AUDIENCES = ["everyone", "chosen"] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];
