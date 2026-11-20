// CSV for the audit export. No imports.

/** A number written with fixed decimals ("-499.00"). It stays a number in a spreadsheet. */
export type CsvNumber = { readonly csvNumber: string };

export function csvNumber(value: number, places = 2): CsvNumber {
  return { csvNumber: Number.isFinite(value) ? value.toFixed(places) : "" };
}

function isCsvNumber(value: unknown): value is CsvNumber {
  return typeof value === "object" && value !== null && typeof (value as CsvNumber).csvNumber === "string" && Object.keys(value).length === 1;
}

/**
 * One CSV cell. Values that a spreadsheet would run as a formula (starting with =, +, -, @, tab or
 * carriage return) get a leading apostrophe, and quotes, commas and line breaks are quoted. Typed
 * numbers (and csvNumber values) are written as they are, so a negative amount stays a number.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (isCsvNumber(value)) return /^-?\d+(\.\d+)?$/.test(value.csvNumber) ? value.csvNumber : "";
  let text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
