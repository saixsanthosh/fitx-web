import { useSyncExternalStore } from "react";

/**
 * The site theme. The head script (introBootstrap.ts) applies the saved choice before first paint from
 * localStorage "fitx-theme"; signed-in choices also live in user_preferences.theme so they follow the
 * account to other devices. Visitors who never chose one get "system" (match the device).
 */
export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "fitx-theme";
export const THEME_EVENT = "fitx-theme-change";
export const DEFAULT_THEME: ThemeMode = "system";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** The theme the page is showing now. */
export function currentTheme(): ThemeMode {
  const mode = document.documentElement.dataset.theme;
  return isThemeMode(mode) ? mode : DEFAULT_THEME;
}

/** The choice saved on this device, if any. */
export function storedTheme(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

/** Shows `mode` now and remembers it on this device. */
export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be blocked (private mode); the current page still switches.
  }
  syncBrowserThemeColor();
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * Keeps the browser's own colour (address bar, PWA title bar) on the page background. The root layout
 * emits one theme-color tag per OS scheme; a fixed light or dark choice paints both with the chosen
 * background, and "system" restores what the layout rendered.
 */
export function syncBrowserThemeColor() {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (!metas.length) return;
  const mode = currentTheme();
  const background = getComputedStyle(document.documentElement).getPropertyValue("--fitx-bg").trim();
  metas.forEach((meta) => {
    if (meta.dataset.fitxOriginal === undefined) meta.dataset.fitxOriginal = meta.content;
    meta.content = mode === "system" || !background ? meta.dataset.fitxOriginal : background;
  });
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/** The current theme, re-rendering when it changes anywhere on the page. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, currentTheme, () => DEFAULT_THEME);
}
