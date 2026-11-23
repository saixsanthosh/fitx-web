/** Explore usernames: 3 to 30 of a-z, 0-9, "." and "_", starting and ending with a letter or digit, no "..". */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;
/** Kept for FITX, and "new", so /explore/stories/new (the story composer) can never be a member's stories. */
export const RESERVED_USERNAMES = ["fitx", "admin", "support", "help", "explore", "settings", "official", "moderator", "staff", "new"] as const;

export function normaliseUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export type UsernameProblem = "short" | "long" | "characters" | "edges" | "dots" | "reserved";

/** What is wrong with a username, or null when it can be used (availability is the database's answer). */
export function usernameProblem(value: string): UsernameProblem | null {
  const name = normaliseUsername(value);
  if (name.length < 3) return "short";
  if (name.length > 30) return "long";
  if (!/^[a-z0-9._]+$/.test(name)) return "characters";
  if (!USERNAME_PATTERN.test(name)) return "edges";
  if (name.includes("..")) return "dots";
  if ((RESERVED_USERNAMES as readonly string[]).includes(name)) return "reserved";
  return null;
}

export const USERNAME_HELP: Record<UsernameProblem, string> = {
  short: "At least 3 characters.",
  long: "At most 30 characters.",
  characters: "Letters, numbers, full stops and underscores only.",
  edges: "Start and end with a letter or number.",
  dots: "No two full stops in a row.",
  reserved: "That name is kept for FITX.",
};

/** A starting suggestion from a name: "Asha Rao" → "asha.rao". The member still chooses. */
export function suggestUsername(name: string | null | undefined): string {
  const base = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 30)
    .replace(/\.+$/g, "");
  return usernameProblem(base) ? "" : base;
}
