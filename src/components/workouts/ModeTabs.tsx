"use client";

/**
 * ModeTabs: the Home and Gym switch at the top of Workouts and the Exercise library (phases 7 and 12). A tablist
 * with two tabs named "Home" and "Gym", drawn as two photo slides: the chosen one is lit, the other rests dimmed.
 * Arrow keys, Home and End move between them (automatic activation). Motion is opacity and transform only and
 * stops under reduced motion (ModeTabs.module.css).
 *
 *   <ModeTabs mode={mode} onChange={setMode} panelId="workouts-panel" idPrefix="workouts" />
 *   <ModePanel mode={mode} direction={direction} id="workouts-panel" labelledBy={`workouts-tab-${mode}`}>…</ModePanel>
 */
import Image from "next/image";
import { useRef, type ReactNode } from "react";
import { Dumbbell, House } from "lucide-react";
import { WORKOUTMODES_MEDIA } from "@/data/workout-modes-media";
import { cn } from "@/lib/utils";
import { MODE_LABELS, WORKOUT_MODES, modeForKey, type WorkoutMode } from "@/lib/training/workout-mode";
import styles from "./ModeTabs.module.css";

const ICONS = { home: House, gym: Dumbbell } as const;

export function ModeTabs({ mode, onChange, panelId, idPrefix, label = "Workout mode", details, className }: {
  mode: WorkoutMode;
  onChange: (mode: WorkoutMode) => void;
  panelId: string;
  idPrefix: string;
  label?: string;
  /** One short line per tab from real data ("12 you can do"); leave a tab out to show none. */
  details?: Partial<Record<WorkoutMode, string>>;
  className?: string;
}) {
  const refs = useRef<Partial<Record<WorkoutMode, HTMLButtonElement | null>>>({});
  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = modeForKey(event.key, mode);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn(styles.tabs, className)} onKeyDown={onKeyDown} data-mode={mode}>
      {WORKOUT_MODES.map((value) => {
        const on = value === mode;
        const Icon = ICONS[value];
        const art = WORKOUTMODES_MEDIA[value];
        const detail = details?.[value]?.trim();
        return (
          <button
            key={value}
            ref={(element) => { refs.current[value] = element; }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${value}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => { if (!on) onChange(value); }}
            className={cn(styles.tab, on && styles.on)}
          >
            <Image src={art.src} alt="" fill sizes="(min-width: 1024px) 420px, 50vw" placeholder="blur" blurDataURL={art.blurDataURL} className={styles.art} />
            <span className={styles.scrim} aria-hidden="true" />
            <span className={styles.text}>
              <span className={styles.label}><Icon size={17} aria-hidden="true" />{MODE_LABELS[value]}</span>
              {detail && <span className={styles.detail}>{detail}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The panel a ModeTabs controls. Its content enters from the side the member moved towards. */
export function ModePanel({ mode, direction, id, labelledBy, children, className }: {
  mode: WorkoutMode;
  /** +1 towards Gym, -1 towards Home, 0 on the first render (no entrance). */
  direction: 1 | -1 | 0;
  id: string;
  labelledBy: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={labelledBy} tabIndex={-1} className={cn(styles.panel, className)}>
      <div key={mode} className={styles.enter} data-direction={direction > 0 ? "next" : direction < 0 ? "previous" : "none"}>
        {children}
      </div>
    </div>
  );
}
