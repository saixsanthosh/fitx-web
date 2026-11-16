// Next.js passes a repeated query parameter (?q=a&q=b) as an array. Pages read a single value. No imports.

type ParamValue = string | string[] | undefined;

/** The first value of a query parameter, or "" when it is missing. */
export function firstParam(value: ParamValue): string {
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}
