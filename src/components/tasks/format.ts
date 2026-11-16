import { localDateKey } from "@/lib/domain/dates";
import { addDays, keyToLocalDate } from "@/lib/domain/day-keys";

/** "Today", "Tomorrow", "Yesterday", or "Thu 19 Nov". */
export function dayName(key: string, today = localDateKey()): string {
  if (key === today) return "today";
  if (key === addDays(today, 1)) return "tomorrow";
  if (key === addDays(today, -1)) return "yesterday";
  return keyToLocalDate(key).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "Wednesday 18 November", for headings and labels. */
export function longDay(key: string): string {
  return keyToLocalDate(key).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** "6:00 PM" in the user's locale. */
export function clockTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
