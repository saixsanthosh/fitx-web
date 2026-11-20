"use server";

import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/admin-auth";
import { ADMIN_THEME_COOKIE, ADMIN_THEME_COOKIE_OPTIONS, parseAdminTheme } from "./theme";

/**
 * Remembers the chosen theme on this browser. A display preference only: it reads and changes no data. The
 * switch shows only inside the signed-in console, so like every Server Action it needs a session first.
 */
export async function saveAdminTheme(value: string): Promise<void> {
  await requireAdmin();
  const store = await cookies();
  store.set(ADMIN_THEME_COOKIE, parseAdminTheme(value), ADMIN_THEME_COOKIE_OPTIONS);
}
