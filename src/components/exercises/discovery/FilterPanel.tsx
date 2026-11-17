"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { REGIONS, type RegionKey } from "@/lib/training/anatomy";
import { MACHINES, MOVEMENTS, MOVEMENT_LABELS, NO_EQUIPMENT, type Movement } from "@/lib/training/catalog-search";
import { CATEGORY_LABELS, EQUIPMENT_KEYS, EXERCISE_CATEGORIES, LEVELS, MECHANICS, type ExerciseCategory, type Level, type Mechanic } from "@/lib/training/taxonomy";
import { browseByMuscleHref, toggleValue, usesLabel, type LibraryState } from "@/app/(dashboard)/exercises/_lib/library-state";

const MUSCLE_SECTIONS: ReadonlyArray<{ title: string; regions: readonly RegionKey[] }> = [
  { title: "Upper body", regions: ["chest", "shoulders", "traps", "neck"] },
  { title: "Arms", regions: ["biceps", "triceps", "forearms"] },
  { title: "Back", regions: ["lats", "middle_back", "lower_back"] },
  { title: "Core", regions: ["abdominals"] },
  { title: "Hips and legs", regions: ["glutes", "quadriceps", "hamstrings", "adductors", "abductors", "calves"] },
];

const MECHANIC_LABELS: Record<Mechanic, string> = { compound: "Compound", isolation: "Isolation" };
const MECHANIC_HINTS: Record<Mechanic, string> = { compound: "Several joints move", isolation: "One joint moves" };
const USES_ORDER = [NO_EQUIPMENT, ...EQUIPMENT_KEYS.filter((key) => !["machine", "smith_machine", "cardio_machine"].includes(key)), MACHINES, "machine", "smith_machine", "cardio_machine"];

const capitalise = (value: string) => value[0].toUpperCase() + value.slice(1);

function Toggle({ on, onClick, children, hint }: { on: boolean; onClick: () => void; children: ReactNode; hint?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={hint}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors motion-reduce:transition-none ${on ? "border-fitx-primary bg-fitx-primary/10 font-semibold text-fitx-primary-text" : "border-fitx-border bg-fitx-surface text-fitx-text-secondary hover:border-fitx-primary/45 hover:text-fitx-text"}`}>
      {on && <Check size={14} aria-hidden="true" />}{children}
    </button>
  );
}

function Section({ title, count, onClear, children, aside }: { title: string; count: number; onClear: () => void; children: ReactNode; aside?: ReactNode }) {
  const headingId = useId();
  return (
    <section role="group" aria-labelledby={headingId} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="m-0 text-xs font-semibold uppercase tracking-[.1em] text-fitx-text-secondary">
          {title}{count > 0 && <span className="ml-1.5 normal-case tracking-normal text-fitx-primary-text">· {count} chosen</span>}
        </h3>
        <span className="flex items-center gap-3">
          {aside}
          {count > 0 && <button type="button" onClick={onClear} aria-label={`Clear ${title.toLowerCase()}`} className="min-h-11 text-xs font-semibold text-fitx-primary-text underline underline-offset-4">Clear</button>}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/**
 * The library's Filters panel: muscles, equipment the exercise uses, level, exercise type and movement. Every
 * option is a toggle (aria-pressed); several in one section mean "any of them".
 */
export function FilterPanel({ id, state, onChange }: { id: string; state: LibraryState; onChange: (next: LibraryState) => void }) {
  const set = (patch: Partial<LibraryState>) => onChange({ ...state, ...patch });
  return (
    <div id={id} className="grid gap-5 border-t border-fitx-divider pt-4">
      <Section title="Muscles" count={state.muscles.length} onClear={() => set({ muscles: [] })}
        aside={<Link href={browseByMuscleHref(state)} className="inline-flex min-h-11 items-center text-xs font-semibold text-fitx-primary-text underline underline-offset-4">Browse by muscle</Link>}>
        <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MUSCLE_SECTIONS.map((section) => (
            <div key={section.title} className="grid gap-1.5">
              <p className="m-0 text-xs text-fitx-text-secondary">{section.title}</p>
              <div className="flex flex-wrap gap-2">
                {section.regions.map((region) => (
                  <Toggle key={region} on={state.muscles.includes(region)} onClick={() => set({ muscles: toggleValue(state.muscles, region) })}>{REGIONS[region].label}</Toggle>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Equipment it uses" count={state.uses.length} onClear={() => set({ uses: [] })}>
        {USES_ORDER.map((value) => (
          <Toggle key={value} on={state.uses.includes(value)} onClick={() => set({ uses: toggleValue(state.uses, value, USES_ORDER) })}
            hint={value === MACHINES ? "Weight machines, the Smith machine and cardio machines" : undefined}>
            <EquipmentIcon name={value === MACHINES ? "machine" : value} size={18} />{usesLabel(value)}
          </Toggle>
        ))}
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Level" count={state.difficulties.length} onClear={() => set({ difficulties: [] })}>
          {LEVELS.map((level: Level) => (
            <Toggle key={level} on={state.difficulties.includes(level)} onClick={() => set({ difficulties: toggleValue(state.difficulties, level, LEVELS) })}>{capitalise(level)}</Toggle>
          ))}
        </Section>
        <Section title="Exercise type" count={state.categories.length} onClear={() => set({ categories: [] })}>
          {EXERCISE_CATEGORIES.map((category: ExerciseCategory) => (
            <Toggle key={category} on={state.categories.includes(category)} onClick={() => set({ categories: toggleValue(state.categories, category, EXERCISE_CATEGORIES) })}>{CATEGORY_LABELS[category]}</Toggle>
          ))}
        </Section>
        <Section title="Movement" count={state.movements.length + state.mechanics.length} onClear={() => set({ movements: [], mechanics: [] })}>
          {MOVEMENTS.map((movement: Movement) => (
            <Toggle key={movement} on={state.movements.includes(movement)} onClick={() => set({ movements: toggleValue(state.movements, movement, MOVEMENTS) })}>{MOVEMENT_LABELS[movement]}</Toggle>
          ))}
          {MECHANICS.map((mechanic: Mechanic) => (
            <Toggle key={mechanic} hint={MECHANIC_HINTS[mechanic]} on={state.mechanics.includes(mechanic)} onClick={() => set({ mechanics: toggleValue(state.mechanics, mechanic, MECHANICS) })}>{MECHANIC_LABELS[mechanic]}</Toggle>
          ))}
        </Section>
      </div>
      <p className="-mt-2 text-xs leading-5 text-fitx-text-secondary">Push, pull and hold come from the movement each exercise records; exercises without one (most cardio and stretches) are left out when you choose a movement.</p>
    </div>
  );
}
