// Admin times are shown in India Standard Time. Vercel servers run in UTC, so the
// zone is set explicitly instead of relying on the server clock. No imports.

export const ADMIN_TIME_ZONE = "Asia/Kolkata";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ADMIN_TIME_ZONE,
});

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
  timeZoneName: "short",
});

function toDate(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/** Calendar date in IST, for example "17 Nov 2026". */
export function formatIstDate(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? dateFormat.format(date) : null;
}

/** Date and time in IST with the zone label, for example "17 Nov 2026, 1:35 am IST". */
export function formatIstDateTime(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : null;
}

// IST is a fixed UTC+05:30 offset with no daylight saving, so form values convert exactly.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** A `datetime-local` value typed in IST ("2026-11-18T09:30") as an ISO UTC timestamp, or null. */
export function istInputToIso(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

/** An ISO timestamp as a `datetime-local` value in IST, or "" when empty or invalid. */
export function isoToIstInput(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? new Date(date.valueOf() + IST_OFFSET_MS).toISOString().slice(0, 16) : "";
}

/** A `date` value ("2026-11-18") as the ISO start of that IST day; with `endOfDay`, the start of the next day. */
export function istDateToIso(value: unknown, { endOfDay = false }: { endOfDay?: boolean } = {}): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(start.valueOf())) return null;
  return new Date(start.valueOf() + (endOfDay ? 24 * 60 * 60 * 1000 : 0)).toISOString();
}

/** A calendar day ("2026-11-18") formatted for chart labels, for example "18 Nov", or "18 Nov 2026" with the year. */
export function formatShortDay(day: string, withYear = false): string {
  const date = new Date(`${day}T12:00:00+05:30`);
  return Number.isNaN(date.valueOf())
    ? day
    : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" as const } : {}), timeZone: ADMIN_TIME_ZONE }).format(date);
}

/** Whether two calendar days ("YYYY-MM-DD") fall in different years, so short day labels need the year to be read right. */
export function crossesYear(first: string | null | undefined, last: string | null | undefined): boolean {
  return Boolean(first && last && /^\d{4}-/.test(first) && /^\d{4}-/.test(last) && first.slice(0, 4) !== last.slice(0, 4));
}

/** A range of calendar days with its year: "27 Oct to 26 Nov 2026", or "27 Nov 2025 to 26 Nov 2026" across a year. */
export function formatDayRange(from: string, to: string): string {
  return `${formatShortDay(from, crossesYear(from, to))} to ${formatShortDay(to, true)}`;
}
