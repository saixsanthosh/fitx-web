import type { LucideIcon } from "lucide-react";
import { BookOpen, CalendarDays, ChartNoAxesColumn, Dumbbell, House, Settings, Target, UserRound, Utensils } from "lucide-react";

/**
 * The signed-in app's navigation, defined once. The desktop sidebar, the tablet rail and the phone
 * bar (with its More sheet) all render from these lists, so a section added here shows up everywhere.
 */
export type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the tablet rail and the phone bar. */
  shortLabel?: string;
  icon: LucideIcon;
};

/** Main sections, in order. */
export const MAIN_NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/nutrition", label: "Nutrition", icon: Utensils },
  { href: "/progress", label: "Progress", icon: ChartNoAxesColumn },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/exercises", label: "Exercise library", shortLabel: "Library", icon: BookOpen },
];

/** Account entries: the sidebar footer, the header account menu and the More sheet. */
export const ACCOUNT_NAV: readonly NavItem[] = [
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
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
