/**
 * Calendar-day keys ("YYYY-MM-DD") and the arithmetic on them. A key is the user's own calendar
 * day, so the maths runs in UTC on purpose: adding a day never lands on the wrong date because of a
 * daylight-saving change in the browser's zone. Weeks run Monday to Sunday, like the rest of FITX.
 *
 * No imports, so `node --test` can load this file directly.
 */

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = KEY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function toUtc(key: string): number {
  const match = KEY.exec(key);
  if (!match) throw new RangeError(`Not a date key: ${key}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtc(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(key: string, days: number): string {
  return fromUtc(toUtc(key) + Math.trunc(days) * DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  return (new Date(toUtc(key)).getUTCDay() + 6) % 7;
}

export function mondayOf(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

/** The seven keys of the Monday-to-Sunday week that contains `key`. */
export function weekKeys(key: string): string[] {
  const monday = mondayOf(key);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** A key as a Date at local noon, for formatting with Intl (noon never falls in a DST gap). */
export function keyToLocalDate(key: string): Date {
  const match = KEY.exec(key);
  if (!match) throw new RangeError(`Not a date key: ${key}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}
