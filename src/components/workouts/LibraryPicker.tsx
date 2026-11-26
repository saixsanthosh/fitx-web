"use client";

import { useId, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { filterLibrary, LIBRARY_PAGE_SIZE, nextVisibleCount } from "@/app/(dashboard)/workouts/_lib/library-filter";
import { ExerciseThumb } from "@/components/exercises/ExerciseThumb";
import type { CatalogExercise } from "@/lib/training/catalog";
import { equipmentLabel, missingEquipment } from "@/lib/training/equipment";
import { FOCUS_AREAS, focusLabel, type FocusArea } from "@/lib/training/focus";

/**
 * Adds exercises to a workout: search by name, muscle or body area, filter by area (the focus vocabulary) and to
 * what the member's equipment allows. Ticking adds an exercise at the end of the plan; unticking removes it. Results
 * come a page at a time with a count, so nothing is cut off silently.
 */
export function LibraryPicker({ catalog, selectedIds, owned, listName, full, onToggle, onInfo }: {
  catalog: readonly CatalogExercise[];
  /** Exercises already in the plan. */
  selectedIds: readonly string[];
  /** The member's equipment where they train this workout (expanded). */
  owned: ReadonlySet<string>;
  /** "home" or "gym". */
  listName: string;
  /** The plan holds the most exercises it can. */
  full: boolean;
  onToggle: (exercise: CatalogExercise) => void;
  onInfo: (exercise: CatalogExercise) => void;
}) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<FocusArea | null>(null);
  const [doableOnly, setDoableOnly] = useState(false);
  const [shown, setShown] = useState(LIBRARY_PAGE_SIZE);
  const results = useMemo(() => filterLibrary(catalog, { query, area, doableOnly }, owned), [catalog, query, area, doableOnly, owned]);
  const visible = results.slice(0, shown);
  const selected = new Set(selectedIds);
  const reset = () => setShown(LIBRARY_PAGE_SIZE);

  return (
    <section aria-labelledby={`${ids}-heading`} className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${ids}-heading`} className="text-sm font-semibold">Add exercises</h3>
        {/* Only the matches are read out as a search narrows: the plan's count changes with every tick (the checkbox
            says that) and every Remove in the builder (its own status line says that). */}
        <p className="text-xs text-fitx-text-secondary">{selected.size} in the plan · <span aria-live="polite">{results.length.toLocaleString()} {results.length === 1 ? "match" : "matches"}</span></p>
      </div>
      <input className="fitx-field mt-2" value={query} onChange={(event) => { setQuery(event.target.value); reset(); }} placeholder="Search by name, muscle or body area" aria-label="Search exercises to add" />
      <div role="group" aria-label="Body area" className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[null, ...FOCUS_AREAS].map((key) => {
          const on = area === key;
          return <button key={key ?? "all"} type="button" aria-pressed={on} onClick={() => { setArea(key); reset(); }} className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm ${on ? "border-fitx-primary bg-fitx-primary/[.08] font-semibold text-fitx-primary-text" : "border-fitx-border text-fitx-text-secondary hover:text-fitx-text"}`}>{key ? focusLabel(key) : "All areas"}</button>;
        })}
      </div>
      <label className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fitx-text-secondary">
        <input type="checkbox" checked={doableOnly} onChange={(event) => { setDoableOnly(event.target.checked); reset(); }} className="h-4 w-4 accent-[var(--fitx-primary)]" />
        Only what I can do with my {listName} equipment
      </label>
      {full && <p role="status" className="mt-1 text-xs text-fitx-warning">This workout has the most exercises it can hold. Remove one to add another.</p>}
      <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-fitx-border bg-fitx-surface">
        {visible.length ? (
          <ul aria-label="Exercises to add">
            {visible.map((exercise) => {
              const missing = missingEquipment(exercise.required_equipment, owned);
              const checked = selected.has(exercise.id);
              return (
                <li key={exercise.id} className="flex items-center gap-1 border-b border-fitx-divider pr-1 last:border-0">
                  <label className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-fitx-hover">
                    <input type="checkbox" checked={checked} disabled={full && !checked} onChange={() => onToggle(exercise)} className="h-4 w-4 shrink-0 accent-[var(--fitx-primary)]" />
                    <span aria-hidden="true" className="shrink-0"><ExerciseThumb exerciseId={exercise.id} name={exercise.name} sourceRef={exercise.source_ref} equipment={exercise.required_equipment} size="sm" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{exercise.name}</span>
                      <span className="block truncate text-xs capitalize text-fitx-text-secondary">{exercise.primary_muscle.replaceAll("_", " ")}{exercise.prescription_type === "time" ? " · timed" : ""}{missing.length ? "" : exercise.required_equipment.length ? "" : " · body weight"}</span>
                      {missing.length > 0 && <span className="block truncate text-xs text-fitx-warning">Needs {missing.map(equipmentLabel).join(", ").toLowerCase()}</span>}
                    </span>
                  </label>
                  <button type="button" onClick={() => onInfo(exercise)} aria-label={`About ${exercise.name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-fitx-text-secondary hover:text-fitx-primary"><Info size={16} aria-hidden="true" /></button>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-3 py-4 text-sm text-fitx-text-secondary">No exercises match. Try another word{area ? " or area" : ""}{doableOnly ? ", or include exercises that need other equipment" : ""}.</p>}
      </div>
      {results.length > visible.length && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-fitx-text-secondary">Showing {visible.length.toLocaleString()} of {results.length.toLocaleString()}</p>
          <button type="button" onClick={() => setShown((count) => nextVisibleCount(count, results.length))} className="fitx-button fitx-button-secondary min-h-11 px-4 text-sm">Show {Math.min(LIBRARY_PAGE_SIZE, results.length - visible.length)} more</button>
        </div>
      )}
    </section>
  );
}
