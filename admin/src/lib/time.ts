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
