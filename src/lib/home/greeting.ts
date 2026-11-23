/**
 * Home's greeting by the time of day on the member's device: morning from 05:00, afternoon from 12:00,
 * evening from 17:00, and "Welcome back" through the night (22:00 to 04:59), when "Good night" would read as
 * a goodbye.
 */
export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const WORDS: Readonly<Record<DayPart, string>> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Welcome back",
};

/** "Good morning, Asha", or just "Good morning" while the name is unknown. */
export function greeting(hour: number, name: string | null): string {
  const words = WORDS[dayPart(hour)];
  return name ? `${words}, ${name}` : words;
}

/** "Monday 23 November" in British English, from a YYYY-MM-DD day key. */
export function longDate(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
