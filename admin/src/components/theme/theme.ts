// The Admin colour theme: light, dark, or the device's own (system). No imports, so tests can load it.

export const ADMIN_THEME_COOKIE = "fitx_admin_theme";
export const ADMIN_THEMES = ["system", "light", "dark"] as const;
export type AdminTheme = (typeof ADMIN_THEMES)[number];

export const ADMIN_THEME_LABELS: Record<AdminTheme, string> = { system: "System", light: "Light", dark: "Dark" };

export function parseAdminTheme(value: unknown): AdminTheme {
  return typeof value === "string" && (ADMIN_THEMES as readonly string[]).includes(value) ? (value as AdminTheme) : "system";
}

/** The data-theme attribute for <html>: none for system, so the device's setting decides. */
export function themeAttribute(theme: AdminTheme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

/** A year, httpOnly is not needed (it holds no secret), Lax so it is sent on the first page of a visit. */
export const ADMIN_THEME_COOKIE_OPTIONS = { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" as const, secure: true, httpOnly: true };
