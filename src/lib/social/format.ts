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
  return `${compactCount(count)} ${count === 1 ? one : many}`;
}
