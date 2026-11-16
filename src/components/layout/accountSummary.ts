/**
 * Name, email and photo for the shell: the sidebar footer, the header and its account menu.
 * No imports, so `node --test` can load it directly.
 */
export type AccountSummary = { name: string; email: string | null; avatarUrl: string | null };

/** The parts of the shared user context (UserContextProvider) the shell reads. */
export type SharedAccount = {
  data: { email: string | null; profile: { name: string; avatar: string | null } | null } | null;
  /** The signed photo link, renewed before it expires; null while it is being signed or with no photo. */
  avatarUrl: string | null;
};

/**
 * The shared user context's name and photo when the dashboard layout provides one (it reloads after a
 * Profile save and keeps the photo link fresh), otherwise the shell's own fetch.
 */
export function preferSharedAccount(fetched: AccountSummary | null, shared: SharedAccount | null): AccountSummary | null {
  const data = shared?.data;
  if (!data) return fetched;
  const avatar = data.profile?.avatar ?? null;
  return {
    name: data.profile?.name || fetched?.name || "",
    email: data.email ?? fetched?.email ?? null,
    // No photo on the profile means none, also right after "Remove photo". While the shared link is
    // still being signed, the fetched one fills in.
    avatarUrl: avatar ? shared.avatarUrl ?? fetched?.avatarUrl ?? null : null,
  };
}
