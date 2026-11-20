"use server";

import { cookies } from "next/headers";
import { ADMIN_THEME_COOKIE, ADMIN_THEME_COOKIE_OPTIONS, parseAdminTheme } from "./theme";

/** Remembers the chosen theme on this browser. A display preference only: it reads and changes no data. */
export async function saveAdminTheme(value: string): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_THEME_COOKIE, parseAdminTheme(value), ADMIN_THEME_COOKIE_OPTIONS);
}
