"use client";

/**
 * BodyMap: FITX's front-and-back muscle map. Artwork in ./body-paths.ts; regions, labels and the load helpers
 * in @/lib/training/anatomy.
 *
 * Modes, freely combined (per region the strongest wins: selected > primary > secondary > level > idle):
 *  - heat      `levels`, 0..1 per region, e.g. loadLevels(muscleLoad(entries)); any level above 0 is visibly tinted.
 *  - two-tone  `primary` and `secondary` region lists, e.g. {...exerciseRegions(primary_muscle, secondary_muscles)}.
 *  - picker    `onSelect` (+ `selected`) turns every region into a toggle button.
 *
 *   <BodyMap title="Muscles worked" primary={["chest"]} secondary={["shoulders", "triceps"]} legend />
 *   <BodyMap title="Training this week" levels={loadLevels(load)} legend size="lg" />
 *   <BodyMap title="Choose a muscle" selected={muscle} onSelect={setMuscle} />
 *
 * Props
 *  title      Accessible name (required). Without `onSelect` the map is one role="img" whose label also names the
 *             highlighted regions; with `onSelect` it is a labelled group of buttons.
 *  view       "both" (default: front and back side by side, captioned), "front" or "back".
 *  levels     0..1 per region; missing or invalid counts as 0, values above 1 count as 1.
 *  primary    Regions in the full accent colour. `secondary`: regions in a lighter accent (a region in both lists
 *             is primary).
 *  selected   The chosen region (picker mode).
 *  onSelect   Called with a region key on click, tap, Enter or Space. Each region is one tab stop with
 *             aria-pressed; a region drawn in both views is focusable in the first one only (its copy in the
 *             other view stays clickable).
 *  size       "sm" | "md" (default) | "lg": the largest width of one figure (96, 150 or 210 px). Below that the
 *             map fills its container width.
 *  legend     Shows a key under the figures for the two-tone and heat modes.
 *  showLabel  Shows the name of the hovered or focused region (else the selected one) under the figures.
 *             Default: on in picker mode.
 *  reveal     Highlighted regions fade in one after another when the map first renders (primary first, then
 *             secondary, then heat levels). Opacity only; nothing moves with reduced motion. Default off.
 *  className  Extra class on the root element.
 *
 * Colours come from theme tokens (BodyMap.module.css), so the map follows the light, dark and inverse themes.
 */
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { BODY_REGIONS, REGIONS, listRegions, regionInView, type RegionKey } from "@/lib/training/anatomy";
import { BODY_ART, BODY_VIEWBOX_ATTR, type BodyView } from "./body-paths";
import styles from "./BodyMap.module.css";

export type BodyMapProps = {
  title: string;
  view?: "front" | "back" | "both";
  levels?: Partial<Record<RegionKey, number>>;
  primary?: readonly RegionKey[];
  secondary?: readonly RegionKey[];
  selected?: RegionKey | null;
  onSelect?: (region: RegionKey) => void;
  size?: "sm" | "md" | "lg";
  legend?: boolean;
  showLabel?: boolean;
  reveal?: boolean;
  className?: string;
};

type RegionState = "selected" | "primary" | "secondary" | "level" | "idle";

const VIEW_NAMES: Record<BodyView, string> = { front: "Front", back: "Back" };
const SIZE_CLASSES = { sm: styles.sm, md: styles.md, lg: styles.lg } as const;

function level01(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, 1) : 0;
}

export function BodyMap({
  title, view = "both", levels, primary, secondary, selected = null, onSelect, size = "md", legend = false, showLabel, reveal = false, className,
}: BodyMapProps) {
  const [hovered, setHovered] = useState<RegionKey | null>(null);
  const [focused, setFocused] = useState<RegionKey | null>(null);
  const interactive = typeof onSelect === "function";
  const views: BodyView[] = view === "both" ? ["front", "back"] : [view];
  const visible = (key: RegionKey) => views.some((side) => regionInView(key, side));

  const primarySet = new Set<RegionKey>(primary ?? []);
  const secondarySet = new Set<RegionKey>((secondary ?? []).filter((key) => !primarySet.has(key)));
  const levelOf = (key: RegionKey) => level01(levels?.[key]);
  const stateOf = (key: RegionKey): RegionState => {
    if (key === selected) return "selected";
    if (primarySet.has(key)) return "primary";
    if (secondarySet.has(key)) return "secondary";
    return levelOf(key) > 0 ? "level" : "idle";
  };

  // Reveal: highlighted regions in order (selected and primary first, then secondary, then the strongest levels).
  const revealOrder = new Map<RegionKey, number>();
  if (reveal) {
    const rank = (key: RegionKey) => ({ selected: 0, primary: 0, secondary: 1, level: 2 - levelOf(key), idle: 9 })[stateOf(key)];
    BODY_REGIONS.filter((key) => stateOf(key) !== "idle").sort((a, b) => rank(a) - rank(b)).forEach((key, index) => revealOrder.set(key, index));
  }

  // The view in which a region takes keyboard focus: the first one that draws it.
  const tabView = new Map<RegionKey, BodyView>();
  for (const side of views) for (const key of BODY_REGIONS) if (BODY_ART[side].regions[key] && !tabView.has(key)) tabView.set(key, side);

  const labelled = showLabel ?? interactive;
  const active = hovered ?? focused;
  const labelKey = active ?? selected;
  const shown = BODY_REGIONS.filter(visible);
  const hasPrimary = shown.some((key) => primarySet.has(key));
  const hasSecondary = shown.some((key) => secondarySet.has(key));
  const hasLevels = shown.some((key) => levelOf(key) > 0);

  const leave = (key: RegionKey) => setHovered((current) => (current === key ? null : current));
  const onKey = (key: RegionKey) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect?.(key);
  };

  const region = (side: BodyView, key: RegionKey) => {
    const paths = BODY_ART[side].regions[key];
    if (!paths?.length) return null;
    const state = stateOf(key);
    const order = revealOrder.get(key);
    const vars: Record<string, string> = {};
    if (state === "level") vars["--level"] = levelOf(key).toFixed(3);
    if (order !== undefined) vars["--reveal-delay"] = `${Math.min(order, 12) * 70 + 120}ms`;
    const shared = {
      className: cn(styles.region, active === key && styles.active),
      "data-region": key,
      "data-state": state,
      style: Object.keys(vars).length ? (vars as CSSProperties) : undefined,
    };
    const plates = paths.map((d, index) => <path key={index} className={styles.plate} d={d} />);
    const hover = { onPointerEnter: () => setHovered(key), onPointerLeave: () => leave(key) };
    if (!interactive) return <g key={key} {...shared} {...(labelled ? hover : {})}>{plates}</g>;
    const pointer = { onClick: () => onSelect?.(key), ...hover };
    if (tabView.get(key) !== side) return <g key={key} {...shared} {...pointer} aria-hidden="true">{plates}</g>;
    return (
      <g
        key={key}
        {...shared}
        {...pointer}
        role="button"
        tabIndex={0}
        aria-label={REGIONS[key].label}
        aria-pressed={key === selected}
        onKeyDown={onKey(key)}
        onFocus={() => setFocused(key)}
        onBlur={() => setFocused((current) => (current === key ? null : current))}
      >
        {plates}
      </g>
    );
  };

  const figure = (side: BodyView) => {
    const art = BODY_ART[side];
    const svgRole = interactive ? { role: "group", "aria-label": VIEW_NAMES[side] } : { "aria-hidden": true as const };
    return (
      <div key={side} className={styles.figure}>
        <svg className={styles.svg} viewBox={BODY_VIEWBOX_ATTR} xmlns="http://www.w3.org/2000/svg" {...svgRole}>
          <path className={styles.silhouette} d={art.silhouette} />
          {art.details.map((d, index) => <path key={`detail-${index}`} className={styles.plate} d={d} />)}
          {BODY_REGIONS.map((key) => region(side, key))}
        </svg>
        {views.length > 1 && <span className={styles.caption} aria-hidden="true">{VIEW_NAMES[side]}</span>}
      </div>
    );
  };

  const rootRole = interactive
    ? { role: "group", "aria-label": title }
    : { role: "img", "aria-label": describe(title, shown, primarySet, secondarySet, levelOf, selected) };

  return (
    <div className={cn(styles.root, SIZE_CLASSES[size], views.length > 1 ? styles.pair : styles.single, interactive && styles.interactive, reveal && styles.reveal, className)} {...rootRole}>
      <div className={styles.views}>{views.map(figure)}</div>
      {legend && (hasPrimary || hasSecondary || hasLevels) && (
        <ul className={styles.legend} aria-hidden={interactive ? undefined : true}>
          {hasPrimary && <li><span className={styles.swatch} data-state="primary" />Primary</li>}
          {hasSecondary && <li><span className={styles.swatch} data-state="secondary" />Secondary</li>}
          {hasLevels && <li className={styles.scale}>Less<span className={styles.ramp} />More</li>}
        </ul>
      )}
      {labelled && (
        <p className={styles.label} aria-hidden="true">{labelKey ? REGIONS[labelKey].label : " "}</p>
      )}
    </div>
  );
}

/** The image label: the title, then what is highlighted (only regions drawn in the shown views). */
function describe(
  title: string,
  shown: readonly RegionKey[],
  primary: ReadonlySet<RegionKey>,
  secondary: ReadonlySet<RegionKey>,
  levelOf: (key: RegionKey) => number,
  selected: RegionKey | null,
): string {
  const sentences: string[] = [];
  if (selected && shown.includes(selected)) sentences.push(`Selected: ${listRegions([selected])}`);
  const primaryShown = shown.filter((key) => primary.has(key));
  const secondaryShown = shown.filter((key) => secondary.has(key));
  if (primaryShown.length) sentences.push(`Primary: ${listRegions(primaryShown)}`);
  if (secondaryShown.length) sentences.push(`Secondary: ${listRegions(secondaryShown)}`);
  const levelled = shown
    .filter((key) => !primary.has(key) && !secondary.has(key) && key !== selected && levelOf(key) > 0)
    .sort((a, b) => levelOf(b) - levelOf(a));
  if (levelled.length) sentences.push(`${levelled.length > 1 ? "Highlighted, most first" : "Highlighted"}: ${listRegions(levelled)}`);
  if (!sentences.length) sentences.push("No muscles highlighted");
  const lead = title.trim();
  return `${/[.!?]$/.test(lead) ? lead : `${lead}.`} ${sentences.join(". ")}.`;
}
