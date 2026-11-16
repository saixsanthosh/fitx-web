import { Bike, Footprints, SportShoe, type LucideIcon } from "lucide-react";
import type { Sport } from "@/lib/activity/types";

export const SPORT_ICON: Record<Sport, LucideIcon> = { walk: Footprints, run: SportShoe, ride: Bike };

export function SportIcon({ sport, size = 18, className }: { sport: Sport; size?: number; className?: string }) {
  const Icon = SPORT_ICON[sport];
  return <Icon size={size} className={className} aria-hidden="true" />;
}
