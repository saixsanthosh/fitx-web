"use client";

/**
 * MuscleRail: the body areas as anatomy tiles (phases 7 and 12; the reference "workout separation of muscle"). Each
 * tile is a toggle (aria-pressed) showing FITX's body map cropped to the area, its muscles lit in the accent, the
 * area's name and an optional count. A sideways rail on phones, a row of eight from 1024 px.
 *
 *   <MuscleRail value={areas} onChange={setAreas} label="Focus areas" details={{ chest: "41" }} />
 *   <MuscleRail mode="single" value={area ? [area] : []} onChange={...} areas={HOME_AREAS} />
 */
import type { CSSProperties } from "react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { FOCUS_AREAS, FOCUS_AREA_INFO, normaliseFocusAreas, type FocusArea } from "@/lib/training/focus";
import { cn } from "@/lib/utils";
import { AREA_CROPS } from "./muscle-crops";
import styles from "./MuscleRail.module.css";

export function MuscleRail({ value, onChange, mode = "multiple", areas = FOCUS_AREAS, label = "Focus areas", details, disabled = false, className }: {
  value: readonly FocusArea[];
  onChange: (next: FocusArea[]) => void;
  mode?: "multiple" | "single";
  areas?: readonly FocusArea[];
  label?: string;
  /** One short line per tile from real data (a count); leave a tile out to show none. */
  details?: Partial<Record<FocusArea, string>>;
  disabled?: boolean;
  className?: string;
}) {
  const selected = new Set(normaliseFocusAreas(value));
  const toggle = (area: FocusArea) => {
    if (mode === "single") return onChange(selected.has(area) ? [] : [area]);
    const next = new Set(selected);
    if (next.has(area)) next.delete(area); else next.add(area);
    onChange(FOCUS_AREAS.filter((key) => next.has(key)));
  };
  return (
    <div role="group" aria-label={label} className={cn(styles.rail, className)}>
      {normaliseFocusAreas(areas).map((area) => {
        const info = FOCUS_AREA_INFO[area];
        const crop = AREA_CROPS[area];
        const on = selected.has(area);
        const detail = details?.[area]?.trim();
        return (
          <button key={area} type="button" aria-pressed={on} disabled={disabled} onClick={() => toggle(area)} className={cn(styles.tile, on && styles.on)} data-focus-area={area}>
            <span className={styles.art} aria-hidden="true">
              <span className={styles.figure} style={{ "--crop-scale": crop.scale, "--crop-top": `${crop.top}%` } as CSSProperties}>
                <BodyMap title={info.label} view={info.badgeView} primary={info.regions} secondary={info.assistRegions} size="lg" />
              </span>
            </span>
            <span className={styles.label}>{info.label}</span>
            {detail && <span className={styles.detail}>{detail}</span>}
          </button>
        );
      })}
    </div>
  );
}
