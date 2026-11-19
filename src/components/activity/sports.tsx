import { Bike, Footprints, SportShoe, type LucideIcon } from "lucide-react";
import type { Sport } from "@/lib/activity/types";

export const SPORT_ICON: Record<Sport, LucideIcon> = { walk: Footprints, run: SportShoe, ride: Bike };

export function SportIcon({ sport, size = 18, className }: { sport: Sport; size?: number; className?: string }) {
  const Icon = SPORT_ICON[sport];
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/** Each sport's colour as Tailwind classes (literal strings, so the build keeps them). */
export const SPORT_TONE: Record<Sport, { text: string; bg: string; fill: string; border: string; stroke: string }> = {
  walk: { text: "text-fitx-sport-walk", bg: "bg-fitx-sport-walk-bg", fill: "bg-fitx-sport-walk", border: "border-fitx-sport-walk", stroke: "var(--fitx-sport-walk)" },
  run: { text: "text-fitx-sport-run", bg: "bg-fitx-sport-run-bg", fill: "bg-fitx-sport-run", border: "border-fitx-sport-run", stroke: "var(--fitx-sport-run)" },
  ride: { text: "text-fitx-sport-ride", bg: "bg-fitx-sport-ride-bg", fill: "bg-fitx-sport-ride", border: "border-fitx-sport-ride", stroke: "var(--fitx-sport-ride)" },
};

/** Plural nouns for headings and filters. */
export const SPORT_PLURAL: Record<Sport, string> = { walk: "Walks", run: "Runs", ride: "Rides" };

/** The sport's own page. */
export const sportHref = (sport: Sport) => `/activity/${sport}`;
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
