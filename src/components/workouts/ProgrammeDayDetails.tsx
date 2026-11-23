"use client";

import { ArrowRight, Eye } from "lucide-react";
import { readableDate } from "@/lib/domain/dates";
import type { CalendarDay } from "@/lib/training/programme-calendar";
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, type MuscleGroup } from "@/lib/training/taxonomy";
import { dayMessage } from "./gym-compact";

function dateLabel(day: CalendarDay) {
  if (day.isToday) return "Today";
  return readableDate(new Date(`${day.date}T12:00:00`), { weekday: "long", month: "short", day: "numeric" });
}

/** "Chest, shoulders and triceps" from a programme day's muscle groups. */
export function focusPhrase(focus: readonly string[]): string {
  const names = focus.filter((group): group is MuscleGroup => (MUSCLE_GROUPS as readonly string[]).includes(group))
    .map((group, index) => (index === 0 ? MUSCLE_GROUP_LABELS[group] : MUSCLE_GROUP_LABELS[group].toLowerCase()));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What a day is and what can be done with it, in one compact row: its heading, what it trains in one short line, and a button to see its workout. */
export function ProgrammeDayDetails({ day, next, busy, onPreview }: {
  day: CalendarDay;
  /** The next training day, mentioned on rest days. */
  next?: CalendarDay | null;
  busy?: boolean;
  /** Opens the day's plan preview (where the workout begins). */
  onPreview: (planId: string) => void;
}) {
  const heading = `${dateLabel(day)} · ${day.kind === "rest" ? "Rest day" : day.title ?? "Training day"}`;
  const focus = day.kind === "training" ? focusPhrase(day.focus) : "";
  const nextLine = next ? `Next: ${dateLabel(next)}${next.title ? ` · ${next.title}` : ""}.` : "";
  const message = dayMessage(day, nextLine);
  const label = day.state === "today" ? "Start" : day.state === "done" ? "View workout" : "Preview workout";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-fitx-border bg-fitx-surface py-2.5 pl-3.5 pr-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{heading}</p>
        <p className="mt-0.5 text-xs text-fitx-text-secondary">{[focus, message].filter(Boolean).join(" · ")}</p>
      </div>
      {day.planId && (
        <button type="button" aria-haspopup="dialog" disabled={busy} onClick={() => onPreview(day.planId!)}
          className={`fitx-button min-h-11 shrink-0 px-4 text-sm ${day.state === "today" ? "" : "fitx-button-secondary"}`}>
          {label}{day.state === "today" ? <ArrowRight size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
