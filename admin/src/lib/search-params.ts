// Next.js passes a repeated query parameter (?q=a&q=b) as an array. Pages read a single value. No imports.

type ParamValue = string | string[] | undefined;

/** The first value of a query parameter, or "" when it is missing. */
export function firstParam(value: ParamValue): string {
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

/**
 * Search text as a database matches it in one piece (ILIKE '%text%'): every run of spaces (tabs, line breaks,
 * non-breaking spaces) is one space, the ends are trimmed, at most `max` characters. Two spaces typed or pasted
 * between words must not make a name unfindable.
 */
export function searchText(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max).trim();
}
