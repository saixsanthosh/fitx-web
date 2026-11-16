/** Local midnight of the Monday that starts the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const date = new Date(ms);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.getTime();
}

/** "This week", "Last week", or "9–15 Nov" (across months: "28 Oct – 3 Nov"). */
export function weekLabel(weekStart: number, now: number): string {
  const thisWeek = startOfWeek(now);
  if (weekStart === thisWeek) return "This week";
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);
  if (weekStart === lastWeek.getTime()) return "Last week";
  const start = new Date(weekStart);
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const month = (d: Date) => d.toLocaleDateString("en-IN", { month: "short" });
  const year = start.getFullYear() !== new Date(now).getFullYear() ? ` ${end.getFullYear()}` : "";
  return start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${end.getDate()} ${month(end)}${year}`
    : `${start.getDate()} ${month(start)} – ${end.getDate()} ${month(end)}${year}`;
}

/** Groups items (newest first) into weeks, keeping order. */
export function groupByWeek<T extends { startedAt: number }>(items: readonly T[]): Array<{ weekStart: number; items: T[] }> {
  const groups: Array<{ weekStart: number; items: T[] }> = [];
  for (const item of items) {
    const weekStart = startOfWeek(item.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.weekStart === weekStart) last.items.push(item);
    else groups.push({ weekStart, items: [item] });
  }
  return groups;
}
