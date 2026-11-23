import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleHelp, Settings, UserRound } from "lucide-react";
import { ActivityNavIcon } from "@/components/layout/ActivityNavIcon";
import {
  CoachNavIcon,
  ExploreNavIcon,
  HomeNavIcon,
  LibraryNavIcon,
  NutritionNavIcon,
  ProgressNavIcon,
  WorkoutsNavIcon,
} from "@/components/layout/nav-icons";
import { EXPLORE } from "@/config/routes";

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
  /** A lucide icon, or an app icon that draws its own active state and motion (marked `fitxNavIcon`). */
  icon: LucideIcon | ComponentType<NavIconProps>;
};

/**
 * Explore (FITX's social space, phase 14) has its icon and its place in the menu now; the integrator turns it on
 * when the Explore stream is merged, so the menu never links to a page that is not there yet.
 */
export const NAV_INCLUDES_EXPLORE = false;

const HOME: NavItem = { href: "/dashboard", label: "Home", icon: HomeNavIcon };
const WORKOUTS: NavItem = { href: "/workouts", label: "Workouts", icon: WorkoutsNavIcon };
const NUTRITION: NavItem = { href: "/nutrition", label: "Nutrition", icon: NutritionNavIcon };
const ACTIVITY: NavItem = { href: "/activity", label: "Activity", icon: ActivityNavIcon };
const COACH: NavItem = { href: "/ai-coach", label: "AI Coach", shortLabel: "Coach", icon: CoachNavIcon };
const PROGRESS: NavItem = { href: "/progress", label: "Progress", icon: ProgressNavIcon };
const LIBRARY: NavItem = { href: "/exercises", label: "Exercise library", shortLabel: "Library", icon: LibraryNavIcon };
/** Explore's entry, ready for when NAV_INCLUDES_EXPLORE is on. */
export const EXPLORE_NAV: NavItem = { href: EXPLORE, label: "Explore", icon: ExploreNavIcon };

/**
 * The menu's groups, in order: Home on its own at the top, then training, tracking, and the coach and community.
 * AI Form Check is not a menu entry: it is reached from Workouts (and from supported exercises).
 */
export type NavGroup = { id: "home" | "train" | "track" | "connect"; label: string | null; items: readonly NavItem[] };

export function navGroups(includeExplore: boolean = NAV_INCLUDES_EXPLORE): readonly NavGroup[] {
  return [
    { id: "home", label: null, items: [HOME] },
    { id: "train", label: "Train", items: [WORKOUTS, LIBRARY, ACTIVITY] },
    { id: "track", label: "Track", items: [NUTRITION, PROGRESS] },
    { id: "connect", label: "Connect", items: includeExplore ? [COACH, EXPLORE_NAV] : [COACH] },
  ];
}

export const NAV_GROUPS = navGroups();

/**
 * Main sections in the phone's order: the first PHONE_TAB_COUNT are its tabs (the four used most), the rest
 * are in More. Every main section is in exactly one group above.
 */
export const MAIN_NAV: readonly NavItem[] = [HOME, WORKOUTS, NUTRITION, ACTIVITY, COACH, PROGRESS, LIBRARY, ...(NAV_INCLUDES_EXPLORE ? [EXPLORE_NAV] : [])];

/** Account entries: the sidebar footer, the header account menu and the More sheet. */
export const ACCOUNT_NAV: readonly NavItem[] = [
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Help and feedback", icon: CircleHelp },
];

/** How many main sections the phone bar shows before "More". */
export const PHONE_TAB_COUNT = 4;
export const PHONE_TABS = MAIN_NAV.slice(0, PHONE_TAB_COUNT);
/** The main sections in More, grouped as in the sidebar (each group keeps only what the bar does not show). */
export const PHONE_MORE_GROUPS: readonly NavGroup[] = NAV_GROUPS
  .map((group) => ({ ...group, items: group.items.filter((item) => !PHONE_TABS.includes(item)) }))
  .filter((group) => group.items.length > 0);
/** Everything else, in the phone's More sheet. */
export const PHONE_MORE = [...PHONE_MORE_GROUPS.flatMap(({ items }) => items), ...ACCOUNT_NAV];

/** True when `pathname` is the item's page or one of its sub-pages. */
export function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The phone bar's highlighted slot: a tab's index, PHONE_TAB_COUNT for More, or -1 when none is current. */
export function phoneSlot(pathname: string): number {
  const tab = PHONE_TABS.findIndex(({ href }) => isActivePath(pathname, href));
  if (tab >= 0) return tab;
  return PHONE_MORE.some(({ href }) => isActivePath(pathname, href)) ? PHONE_TAB_COUNT : -1;
}

/** True for an app icon that takes `active` (lucide icons take `strokeWidth` instead). */
export function isAppNavIcon(icon: NavItem["icon"]): icon is ComponentType<NavIconProps> {
  return (icon as { fitxNavIcon?: boolean }).fitxNavIcon === true;
}
