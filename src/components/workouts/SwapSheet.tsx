"use client";

import { useMemo } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentLabel, missingEquipment } from "@/lib/training/equipment";
import { rankSubstitutes } from "@/lib/training/substitutions";
import { MUSCLE_GROUP_LABELS, type Level } from "@/lib/training/taxonomy";
import { Sheet } from "./Sheet";

/**
 * Alternatives for one exercise that train the same muscles with equipment the user has.
 * `contextLabel` names the equipment list used ("home", "gym").
 */
export function SwapSheet({ target, catalog, owned, level, exclude, contextLabel, onPick, onClose }: {
  target: CatalogExercise;
  catalog: readonly CatalogExercise[];
  owned: ReadonlySet<string>;
  level: Level;
  exclude: ReadonlySet<string>;
  contextLabel: string;
  onPick: (exercise: CatalogExercise) => void;
  onClose: () => void;
}) {
  const options = useMemo(() => rankSubstitutes(target, catalog, { owned, level, exclude, limit: 8 }), [target, catalog, owned, level, exclude]);
  const missing = missingEquipment(target.required_equipment, owned);
  return (
    <Sheet title={`Swap ${target.name}`} onClose={onClose}
      description={missing.length ? `Your ${contextLabel} list does not include ${missing.map(equipmentLabel).join(", ").toLowerCase()}. These train the same muscles with what you have.` : `Other ${MUSCLE_GROUP_LABELS[target.muscle_group].toLowerCase()} exercises you can do with your ${contextLabel} equipment.`}>
      {options.length ? (
        <ul className="space-y-2">
          {options.map(({ exercise, reasons }) => (
            <li key={exercise.id}>
              <button type="button" onClick={() => onPick(exercise)} className="flex w-full items-center gap-3 rounded-lg border border-fitx-border bg-fitx-surface p-3 text-left transition-colors hover:border-fitx-primary/40 hover:bg-fitx-hover">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-fitx-primary/10 text-fitx-primary-text"><ArrowRightLeft size={16} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{exercise.name}</span>
                  <span className="mt-0.5 block text-xs text-fitx-text-secondary">{reasons.join(" · ")} · {exercise.difficulty}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-fitx-border bg-fitx-surface p-4 text-sm text-fitx-text-secondary">
          Nothing else in the library trains the same muscles with your {contextLabel} equipment. Add equipment to your list, or remove this exercise.
        </p>
      )}
    </Sheet>
  );
}
