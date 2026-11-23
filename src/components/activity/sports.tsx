import { Accessibility, Bike, Footprints, Kayak, Mountain, SportShoe, TreePine, createLucideIcon, type LucideIcon } from "lucide-react";
import { SPORT_INFO, sportFamily } from "@/lib/activity/config";
import type { Sport } from "@/lib/activity/types";

/* Lucide has no mountain bike, e-bike or inline skate: these follow its grid (24 px, 2 px round strokes). */
const MountainBike = createLucideIcon("fitx-mountain-bike", [
  ["circle", { cx: "18.5", cy: "17.5", r: "3.5", key: "rear" }],
  ["circle", { cx: "5.5", cy: "17.5", r: "3.5", key: "front" }],
  ["path", { d: "M12 17.5V14l-3-3 4-3 2 3h2", key: "frame" }],
  ["path", { d: "m14 7 3-4.5 2.5 3.5L21 4", key: "peak" }],
]);
const EBike = createLucideIcon("fitx-e-bike", [
  ["circle", { cx: "18.5", cy: "17.5", r: "3.5", key: "rear" }],
  ["circle", { cx: "5.5", cy: "17.5", r: "3.5", key: "front" }],
  ["path", { d: "M12 17.5V14l-3-3 4-3 2 3h2", key: "frame" }],
  ["path", { d: "m17 2-2 3h3l-2 3", key: "bolt" }],
]);
const InlineSkate = createLucideIcon("fitx-inline-skate", [
  ["path", { d: "M6 3h5v6l5.2 2.1A3 3 0 0 1 18 14v2H6Z", key: "boot" }],
  ["circle", { cx: "7.5", cy: "20", r: "1.5", key: "w1" }],
  ["circle", { cx: "12", cy: "20", r: "1.5", key: "w2" }],
  ["circle", { cx: "16.5", cy: "20", r: "1.5", key: "w3" }],
]);

export const SPORT_ICON: Record<Sport, LucideIcon> = {
  walk: Footprints, run: SportShoe, ride: Bike, hike: Mountain, trail_run: TreePine, mtb: MountainBike, ebike: EBike,
  wheelchair: Accessibility, skate: InlineSkate, paddle: Kayak,
};

export function SportIcon({ sport, size = 18, className }: { sport: Sport; size?: number; className?: string }) {
  const Icon = SPORT_ICON[sport];
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/** Each sport family's colour as Tailwind classes (literal strings, so the build keeps them). */
const FAMILY_TONE = {
  walk: { text: "text-fitx-sport-walk", bg: "bg-fitx-sport-walk-bg", fill: "bg-fitx-sport-walk", border: "border-fitx-sport-walk", stroke: "var(--fitx-sport-walk)" },
  run: { text: "text-fitx-sport-run", bg: "bg-fitx-sport-run-bg", fill: "bg-fitx-sport-run", border: "border-fitx-sport-run", stroke: "var(--fitx-sport-run)" },
  ride: { text: "text-fitx-sport-ride", bg: "bg-fitx-sport-ride-bg", fill: "bg-fitx-sport-ride", border: "border-fitx-sport-ride", stroke: "var(--fitx-sport-ride)" },
} as const;

/** Each sport's colour: the three FITX sport tokens, shared by family (config.ts sportFamily). */
export const SPORT_TONE: Record<Sport, { text: string; bg: string; fill: string; border: string; stroke: string }> = Object.fromEntries(
  (Object.keys(SPORT_INFO) as Sport[]).map((sport) => [sport, FAMILY_TONE[sportFamily(sport)]]),
) as Record<Sport, (typeof FAMILY_TONE)[keyof typeof FAMILY_TONE]>;

/** Plural nouns for headings and filters. */
export const SPORT_PLURAL: Record<Sport, string> = Object.fromEntries((Object.keys(SPORT_INFO) as Sport[]).map((sport) => [sport, SPORT_INFO[sport].plural])) as Record<Sport, string>;

/** The sport's own page. */
export const sportHref = (sport: Sport) => `/activity/${SPORT_INFO[sport].slug}`;
/** The Record screen with the sport chosen. */
export const recordHref = (sport: Sport) => `/activity/record?sport=${sport}`;

/** A sport icon in a round, tinted badge. */
export function SportBadge({ sport, size = 40, className }: { sport: Sport; size?: number; className?: string }) {
  const tone = SPORT_TONE[sport];
  return (
    <span className={`grid shrink-0 place-items-center rounded-full ${tone.bg} ${tone.text} ${className ?? ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <SportIcon sport={sport} size={Math.round(size * 0.48)} />
    </span>
  );
}
