"use client";

/**
 * FocusTiles: pick the body areas to train (Full body, Chest, Back, Shoulders, Arms, Abs, Legs, Glutes). Each tile
 * is a toggle button (aria-pressed) with a public-domain Free Exercise DB photo of a typical exercise for the area,
 * a mini body map of the area's muscles, its label and a check mark. Two columns on phones, four from 768 px.
 * Vocabulary, photos and rules: @/lib/training/focus.
 *
 *   <FocusTiles value={areas} onChange={setAreas} />                         many areas
 *   <FocusTiles mode="single" value={area ? [area] : []} onChange={...} />   one area at a time
 *   <FocusTiles value={areas} onChange={setAreas} details={{ chest: "41 at home" }} />
 *
 * Props
 *  value     The selected areas (any order; unknown values are ignored).
 *  onChange  Called with the new selection, in display order.
 *  mode      "multiple" (default) or "single" (choosing one replaces the rest; choosing it again clears it).
 *  areas     The tiles to show, default all eight.
 *  label     The group's accessible name, default "Focus areas".
 *  details   One short line per tile from real data, e.g. a count from focusCounts(); leave a tile out to show none.
 *  disabled  Makes every tile inert.
 *  credit    Shows the photo credit under the grid (default true).
 */
import Image from "next/image";
import { Check } from "lucide-react";
import { useId, useState } from "react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { cn } from "@/lib/utils";
import { FOCUS_AREAS, FOCUS_AREA_INFO, focusPhotoUrl, normaliseFocusAreas, type FocusArea } from "@/lib/training/focus";
import { FREE_EXERCISE_DB_ATTRIBUTION, FREE_EXERCISE_DB_LICENSE } from "@/lib/training/media";
import styles from "./FocusTiles.module.css";

export type FocusTilesProps = {
  value: readonly FocusArea[];
  onChange: (next: FocusArea[]) => void;
  mode?: "multiple" | "single";
  areas?: readonly FocusArea[];
  label?: string;
  details?: Partial<Record<FocusArea, string>>;
  disabled?: boolean;
  credit?: boolean;
  className?: string;
};

export function FocusTiles({
  value, onChange, mode = "multiple", areas = FOCUS_AREAS, label = "Focus areas", details, disabled = false, credit = true, className,
}: FocusTilesProps) {
  const baseId = useId();
  const [failed, setFailed] = useState<ReadonlySet<FocusArea>>(() => new Set());
  const shown = normaliseFocusAreas(areas);
  const selected = new Set(normaliseFocusAreas(value));

  const toggle = (area: FocusArea) => {
    if (mode === "single") return onChange(selected.has(area) ? [] : [area]);
    const next = new Set(selected);
    if (next.has(area)) next.delete(area);
    else next.add(area);
    onChange(FOCUS_AREAS.filter((key) => next.has(key)));
  };
  const markFailed = (area: FocusArea) => setFailed((current) => (current.has(area) ? current : new Set([...current, area])));

  return (
    <div className={cn(styles.wrap, className)}>
      <div role="group" aria-label={label} className={styles.grid}>
        {shown.map((area) => {
          const info = FOCUS_AREA_INFO[area];
          const on = selected.has(area);
          const photo = !failed.has(area);
          const detail = details?.[area]?.trim();
          const describedBy = `${baseId}-${area}`;
          return (
            <button
              key={area}
              type="button"
              aria-pressed={on}
              aria-describedby={describedBy}
              disabled={disabled}
              onClick={() => toggle(area)}
              className={cn(styles.tile, on && styles.on, !photo && styles.noPhoto)}
              data-focus-area={area}
            >
              {photo && (
                <Image
                  src={focusPhotoUrl(area)}
                  alt=""
                  fill
                  sizes="(min-width: 768px) 25vw, 50vw"
                  style={{ objectFit: "cover", objectPosition: info.photo.position }}
                  onError={() => markFailed(area)}
                />
              )}
              {photo && <span className={styles.scrim} aria-hidden="true" />}
              <span className={styles.badge} aria-hidden="true">
                <BodyMap title={info.label} view={info.badgeView} primary={info.regions} secondary={info.assistRegions} size="sm" />
              </span>
              <span className={styles.check} aria-hidden="true">{on && <Check size={16} strokeWidth={3} />}</span>
              <span className={styles.text}>
                <span className={styles.label}>{info.label}</span>
                {detail && <span className={styles.detail}>{detail}</span>}
              </span>
              <span id={describedBy} className="sr-only">{info.description}</span>
            </button>
          );
        })}
      </div>
      {credit && shown.some((area) => !failed.has(area)) && (
        <p className={styles.credit}>Photos: {FREE_EXERCISE_DB_ATTRIBUTION}. Licence: {FREE_EXERCISE_DB_LICENSE}.</p>
      )}
    </div>
  );
}
