import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { BookOpen, ChartNoAxesColumn, CircleHelp, Dumbbell, House, Settings, Sparkles, UserRound, Utensils } from "lucide-react";
import { HomeWorkoutNavIcon } from "@/components/home-workout/HomeWorkoutNavIcon";
import { ActivityNavIcon } from "@/components/layout/ActivityNavIcon";
import { HOME_WORKOUT } from "@/config/routes";

/** Props a custom (non-lucide) nav icon takes. */
export type NavIconProps = { size?: number; className?: string; active?: boolean };

/**
 * The signed-in app's navigation, defined once. The desktop sidebar, the tablet rail and the phone
 * bar (with its More sheet) all render from these lists, so a section added here shows up everywhere.
 */
export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the tablet rail and the phone bar. */
  shortLabel?: string;
  /** A lucide icon, or an app icon that draws its own active state (marked `fitxNavIcon`). */
  icon: LucideIcon | ComponentType<NavIconProps>;
};

/** Main sections, in order. The first PHONE_TAB_COUNT are the phone bar's tabs. */
export const MAIN_NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/activity", label: "Activity", icon: ActivityNavIcon },
  { href: "/ai-coach", label: "AI Coach", shortLabel: "Coach", icon: Sparkles },
  { href: "/progress", label: "Progress", icon: ChartNoAxesColumn },
  { href: "/exercises", label: "Exercise library", shortLabel: "Library", icon: BookOpen },
  { href: HOME_WORKOUT, label: "Home workout", icon: HomeWorkoutNavIcon },
];

/** Account entries: the sidebar footer, the header account menu and the More sheet. */
export const ACCOUNT_NAV: readonly NavItem[] = [
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Help and feedback", icon: CircleHelp },
];

/** How many main sections the phone bar shows before "More". */
export const PHONE_TAB_COUNT = 4;
export const PHONE_TABS = MAIN_NAV.slice(0, PHONE_TAB_COUNT);
/** Everything else, in the phone's More sheet. */
export const PHONE_MORE = [...MAIN_NAV.slice(PHONE_TAB_COUNT), ...ACCOUNT_NAV];

/** True when `pathname` is the item's page or one of its sub-pages. */
export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True for an app icon that takes `active` (lucide icons take `strokeWidth` instead). */
export function isAppNavIcon(icon: NavItem["icon"]): icon is ComponentType<NavIconProps> {
  return (icon as { fitxNavIcon?: boolean }).fitxNavIcon === true;
}
