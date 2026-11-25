/** Short relative times for posts and notifications ("now", "5 min", "3 h", "2 d", then a date). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** The full date for a time element's title and screen readers. */
export function fullDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 1,234 → "1,234"; 12,400 → "12.4k"; 1,200,000 → "1.2m". */
export function compactCount(value: number): string {
  if (value < 10000) return value.toLocaleString("en-GB");
  if (value < 1_000_000) return `${(Math.floor(value / 100) / 10).toString()}k`;
  return `${(Math.floor(value / 100_000) / 10).toString()}m`;
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return countParts(count, one, many).name;
}

/**
 * A count as it is shown and as it is spoken, from one place, so a screen reader and speech control hear exactly what
 * is on screen: `value` and `unit` are drawn ("12.4k", "followers") and `name` is the control's name ("12.4k followers").
 * One is singular: "1 follower".
 */
export function countParts(count: number, one: string, many: string = `${one}s`): { value: string; unit: string; name: string } {
  const value = compactCount(count);
  const unit = count === 1 ? one : many;
  return { value, unit, name: `${value} ${unit}` };
}

/** What a suspended member reads: until when (in their own time zone), or until FITX lifts it. */
export function suspensionText(until: string | null | undefined): string {
  if (!until) return "FITX has paused your Explore account until it reviews it.";
  const date = new Date(until);
  if (!Number.isFinite(date.getTime())) return "FITX has paused your Explore account until it reviews it.";
  return `FITX has paused your Explore account until ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`;
}

/** Whole years between a YYYY-MM-DD date and `today` (local), or null for an invalid date. */
export function ageOn(isoDate: string, today: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return null;
  let age = today.getFullYear() - year;
  if (today.getMonth() < month - 1 || (today.getMonth() === month - 1 && today.getDate() < day)) age -= 1;
  return age;
}
