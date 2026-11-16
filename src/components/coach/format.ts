/** Small display helpers for the coach page. */

export function formatNumber(value: number) {
  return Math.round(value).toLocaleString("en-IN");
}

export function formatGrams(value: number) {
  return `${Math.round(value * 10) / 10} g`;
}

/** "5:30 am" today, or "Tue 5:30 am" when it is not today, in the viewer's own time zone. */
export function formatResetTime(iso: string | undefined | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function relativeDay(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}
