/*
 * Map tiles: OpenFreeMap by default (free, no key, commercial use allowed, no uptime guarantee).
 * Another provider can replace it without code changes by setting full MapLibre style URLs:
 *   NEXT_PUBLIC_ACTIVITY_MAP_STYLE_LIGHT and NEXT_PUBLIC_ACTIVITY_MAP_STYLE_DARK
 * (for example MapTiler or a self-hosted PMTiles style). The style's own attribution is always shown.
 */

export const OPENFREEMAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

/** True when the dark map is OpenFreeMap's own dark style (FITX recolours it to its palette). */
export function usesDefaultDarkStyle(): boolean {
  return !process.env.NEXT_PUBLIC_ACTIVITY_MAP_STYLE_DARK && !process.env.NEXT_PUBLIC_ACTIVITY_MAP_STYLE_LIGHT;
}

export function mapStyleUrl(dark: boolean): string {
  const light = process.env.NEXT_PUBLIC_ACTIVITY_MAP_STYLE_LIGHT;
  const darkStyle = process.env.NEXT_PUBLIC_ACTIVITY_MAP_STYLE_DARK;
  if (dark) return darkStyle || light || OPENFREEMAP_STYLES.dark;
  return light || OPENFREEMAP_STYLES.light;
}

/** True when FITX is showing its dark theme (chosen, or "system" on a dark device). */
export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  const mode = document.documentElement.dataset.theme;
  if (mode === "dark") return true;
  if (mode === "system") return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return false;
}

/** Calls `onChange` whenever the resolved theme may have changed; returns an unsubscribe. */
export function watchTheme(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/** A FITX colour token's current value (for map paint properties, which cannot use CSS variables). */
export function themeToken(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
