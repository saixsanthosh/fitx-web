"use client";

import { ArrowRight, Eye } from "lucide-react";
import { readableDate } from "@/lib/domain/dates";
import type { CalendarDay } from "@/lib/training/programme-calendar";
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS, type MuscleGroup } from "@/lib/training/taxonomy";

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

/** What a day is and what can be done with it: its heading, what it trains, and a button to see its workout. */
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
  let message = "";
  switch (day.state) {
    case "done": message = day.doneOn && day.doneOn !== day.date ? "Done (you did it on another day; it still counts)." : "Done."; break;
    case "today": message = "Planned for today. Review the exercises, then begin."; break;
    case "planned": message = "Planned. You can review it now, or do it early: it counts either way."; break;
    case "missed": message = "Not done. A missed day isn’t held against you, and you can still do it."; break;
    case "projected": message = "Not planned yet. FITX plans each training day about a week ahead, with exercises for your equipment."; break;
    case "unplanned": message = "No workout was planned for this day."; break;
    case "paused": message = "Your programme is paused. Resume it to plan this day."; break;
    case "rest": message = `Recovery is part of your plan. ${nextLine}`.trim(); break;
    case "before_start": message = "Before you started this programme."; break;
    case "after_end": message = "After the last session of this plan."; break;
  }
  const label = day.state === "today" ? "Start" : day.state === "done" ? "View workout" : "Preview workout";
  return (
    <div className="rounded-xl border border-fitx-border bg-fitx-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{heading}</p>
          {focus && <p className="mt-0.5 text-xs text-fitx-text-secondary">{focus}</p>}
          <p className="mt-1.5 text-sm text-fitx-text-secondary">{message}</p>
        </div>
        {day.planId && (
          <button type="button" aria-haspopup="dialog" disabled={busy} onClick={() => onPreview(day.planId!)}
            className={`fitx-button min-h-11 px-4 text-sm ${day.state === "today" ? "" : "fitx-button-secondary"}`}>
            {label}{day.state === "today" ? <ArrowRight size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
}
