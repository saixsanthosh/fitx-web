"use client";

/**
 * AreaLaunchRail: the Gym tab's "Train by area" (phase 7.4, wave 2). The same anatomy art as the library's and the
 * builder's MuscleRail (FITX's body map cropped to each area, its muscles lit in the accent), but each tile opens the
 * workout builder for its area, so it is a plain button with aria-haspopup="dialog" rather than a toggle. A sideways
 * rail on phones and a row of eight from 768 px. Replaces the photo FocusTiles, which
 * showed a stand-in icon whenever the photo host was unreachable.
 *
 *   <AreaLaunchRail label="Train by area" onLaunch={(area) => openBuilder(area)} />
 */
import type { CSSProperties } from "react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { AREA_CROPS } from "@/components/training/muscle-crops";
import { FOCUS_AREAS, FOCUS_AREA_INFO, normaliseFocusAreas, type FocusArea } from "@/lib/training/focus";
import { cn } from "@/lib/utils";
import styles from "./AreaLaunchRail.module.css";

export function AreaLaunchRail({ label, onLaunch, areas = FOCUS_AREAS, details, className }: {
  label: string;
  onLaunch: (area: FocusArea) => void;
  areas?: readonly FocusArea[];
  /** One short line per tile from real data; leave a tile out to show none. */
  details?: Partial<Record<FocusArea, string>>;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(styles.rail, className)}>
      {normaliseFocusAreas(areas).map((area) => {
        const info = FOCUS_AREA_INFO[area];
        const crop = AREA_CROPS[area];
        const detail = details?.[area]?.trim();
        return (
          <button key={area} type="button" aria-haspopup="dialog" onClick={() => onLaunch(area)} className={styles.tile} data-focus-area={area}>
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
