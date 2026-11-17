"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { EQUIPMENT, type TrainingContext } from "@/lib/training/taxonomy";

/** The items shown before "More equipment", most common first; the rest follow in catalogue order. */
const FIRST: Record<TrainingContext, readonly string[]> = {
  home: ["dumbbell", "kettlebell", "resistance_band", "bench", "pull_up_bar", "box", "chair", "stability_ball", "medicine_ball", "suspension_trainer", "jump_rope"],
  gym: ["dumbbell", "barbell", "kettlebell", "bench", "squat_rack", "cable_machine", "machine", "smith_machine", "pull_up_bar", "resistance_band", "ez_bar"],
};

const SHORT_LABELS: Record<string, string> = {
  barbell: "Barbell", ez_bar: "EZ bar", resistance_band: "Bands", pull_up_bar: "Pull-up bar", bench: "Bench", box: "Box or step",
  dip_station: "Dip bars", squat_rack: "Squat rack", cable_machine: "Cable machine", machine: "Weight machines", cardio_machine: "Cardio machines",
  stability_ball: "Exercise ball", suspension_trainer: "Suspension or rings", chair: "Chair", strongman_implements: "Strongman kit",
  specialty: "Other kit",
};

const label = (key: string) => SHORT_LABELS[key] ?? EQUIPMENT.find((item) => item.key === key)?.label ?? key;

/**
 * "What do you have?": equipment as illustrated toggle tiles (aria-pressed). "No equipment" means body weight only
 * and clears the rest; choosing an item clears "No equipment". Less common items sit behind "More equipment",
 * except any that are selected. The common items depend on where the member trains.
 */
export function EquipmentGrid({ value, onChange, context, disabled = false }: {
  /** The member's equipment keys; null while unknown (nothing is shown as chosen). */
  value: readonly string[] | null;
  onChange: (keys: string[]) => void;
  context: TrainingContext;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const known = value !== null;
  const selected = new Set(value ?? []);
  const first = FIRST[context];
  const rest = EQUIPMENT.map((item) => item.key).filter((key) => !first.includes(key));
  const shown = [...first, ...(expanded ? rest : rest.filter((key) => selected.has(key)))];
  const hidden = rest.filter((key) => !shown.includes(key)).length;
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(EQUIPMENT.map((item) => item.key).filter((item) => next.has(item)));
  };
  const tile = (key: string, on: boolean, text: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex h-full min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs font-medium leading-tight transition-colors motion-reduce:transition-none disabled:opacity-60 ${on ? "border-fitx-primary bg-fitx-primary/10 text-fitx-text" : "border-fitx-border bg-fitx-surface text-fitx-text-secondary hover:border-fitx-primary/45 hover:text-fitx-text"}`}
    >
      <span className={on ? "text-fitx-primary" : ""}><EquipmentIcon name={key} size={30} /></span>
      <span>{text}</span>
      <span aria-hidden="true" className={`absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full ${on ? "bg-fitx-primary text-fitx-on-primary" : "border border-fitx-border bg-fitx-surface"}`}>
        {on && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  );
  return (
    <div className="grid gap-2">
      <div role="group" aria-label="Equipment you have" className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
        {tile("none", known && selected.size === 0, "No equipment", () => onChange([]))}
        {shown.map((key) => tile(key, selected.has(key), label(key), () => toggle(key)))}
      </div>
      {(hidden > 0 || expanded) && (
        <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}
          className="inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-lg px-1 text-sm font-semibold text-fitx-primary-text">
          {expanded ? "Fewer items" : `More equipment (${hidden})`}<ChevronDown size={15} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
