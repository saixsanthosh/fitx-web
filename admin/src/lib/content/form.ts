// Small helpers for reading Admin forms. No imports.

/** What the parsers need from FormData (tests pass a real FormData). */
export type FormLike = { get(name: string): unknown; getAll(name: string): unknown[] };

export type FieldErrors = Record<string, string>;

/** The result of every content Server Action used with useActionState. */
export type FormState = { status: "idle" | "error" | "saved"; message?: string; fieldErrors?: FieldErrors };

export const IDLE: FormState = { status: "idle" };

export function text(form: FormLike, name: string, max = 4000): string {
  const value = form.get(name);
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
}

export function texts(form: FormLike, name: string, max = 200): string[] {
  return form
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().slice(0, max))
    .filter(Boolean);
}

/** Lines of a textarea, trimmed, blanks dropped. */
export function lines(form: FormLike, name: string, maxLines = 40, maxLength = 600): string[] {
  return text(form, name, maxLines * (maxLength + 1))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => line.slice(0, maxLength));
}

/** Comma- or line-separated words, trimmed and de-duplicated (case-insensitive). */
export function words(form: FormLike, name: string, maxWords = 40): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text(form, name, 4000).split(/[,\n]/)) {
    const word = raw.trim();
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    result.push(word);
    if (result.length >= maxWords) break;
  }
  return result;
}

/** A whole number, or null when empty; NaN when it is not a whole number. */
export function wholeNumber(form: FormLike, name: string): number | null {
  const value = text(form, name, 20);
  if (!value) return null;
  return /^-?\d{1,9}$/.test(value) ? Number(value) : Number.NaN;
}

/** A decimal with at most `places` places, or null when empty; NaN when not a number. */
export function decimal(form: FormLike, name: string, places = 2): number | null {
  const value = text(form, name, 20).replace(",", ".");
  if (!value) return null;
  return new RegExp(`^\\d{1,6}(\\.\\d{1,${places}})?$`).test(value) ? Number(value) : Number.NaN;
}

export function checked(form: FormLike, name: string): boolean {
  const value = form.get(name);
  return value === "on" || value === "true" || value === "1";
}

export function oneOf<T extends string>(value: string, options: readonly T[]): T | null {
  return (options as readonly string[]).includes(value) ? (value as T) : null;
}
