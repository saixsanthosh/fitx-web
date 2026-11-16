import "server-only";

/**
 * Small, strict readers for untrusted JSON (model replies and request bodies). Each returns a clean
 * value or null; nothing is coerced silently except trimming and clamping into a stated range.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A trimmed single-line string of 1..max characters, or null. Control characters are removed. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Like cleanText but keeps line breaks (for chat replies and member messages). */
export function cleanMultiline(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/** A finite number clamped into [min, max], or null when it is not a number. */
export function clampNumber(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}
