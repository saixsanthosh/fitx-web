// The menu's drawn icons, one per section, each with its own small motion (nav-icons.css): it plays when the
// pointer rests on the link or the keyboard focuses it, and once when the section becomes the current page. At
// rest every icon is still, and with reduced motion it never moves. Written with createElement (no JSX) and no
// CSS module, so the navigation config, which imports them, stays loadable by the node:test unit tests.
import { createElement, type ReactNode } from "react";

export type DrawnNavIconProps = { size?: number; className?: string; active?: boolean };

/** The sections that have a drawn icon; the CSS keys its motion on `fitx-navicon--<name>`. */
export const NAV_ICON_NAMES = ["home", "workouts", "nutrition", "coach", "progress", "library", "explore"] as const;
export type NavIconName = (typeof NAV_ICON_NAMES)[number];

const path = (d: string, part?: string, extra: Record<string, unknown> = {}) =>
  createElement("path", { d, className: part ? `fitx-navicon__${part}` : undefined, ...extra });
const dot = (cx: number, cy: number, part: string) =>
  createElement("circle", { cx, cy, r: 1.15, fill: "currentColor", stroke: "none", className: `fitx-navicon__${part}` });

/** What each icon draws, on lucide's 24 px grid and stroke style, so it sits with the account icons. */
const DRAWINGS: Record<NavIconName, () => ReactNode[]> = {
  // A house: the roof settles onto the walls and the door lights, coming home.
  home: () => [
    path("M3.5 11.2 12 4.2l8.5 7", "roof"),
    path("M5.8 9.6V20h12.4V9.6"),
    path("M10 20v-5.4h4V20", "door"),
  ],
  // A dumbbell lifted through one rep.
  workouts: () => [
    createElement("g", { className: "fitx-navicon__lift" },
      path("M7.5 12h9"),
      path("M7.5 7.2v9.6M4.6 9v6"),
      path("M16.5 7.2v9.6M19.4 9v6"),
    ),
  ],
  // A bowl with steam rising from it.
  nutrition: () => [
    path("M4 12.6h16c0 4-3.6 7.4-8 7.4s-8-3.4-8-7.4Z"),
    path("M8.6 9.6c0-1.3 1.1-1.5 1.1-2.8S8.6 5.3 8.6 4", "steam-a"),
    path("M12 9.6c0-1.3 1.1-1.5 1.1-2.8S12 5.3 12 4", "steam-b"),
    path("M15.4 9.6c0-1.3 1.1-1.5 1.1-2.8s-1.1-1.5-1.1-2.8", "steam-c"),
  ],
  // A speech bubble whose dots type a reply.
  coach: () => [
    path("M20 11.4c0 3.9-3.6 7-8 7-1.1 0-2.2-.2-3.2-.6L4 19.4l1.5-3.7c-.9-1.2-1.5-2.7-1.5-4.3 0-3.9 3.6-7 8-7s8 3.1 8 7Z"),
    dot(8.4, 11.4, "dot-a"),
    dot(12, 11.4, "dot-b"),
    dot(15.6, 11.4, "dot-c"),
  ],
  // Three bars rising from the baseline, one after another.
  progress: () => [
    path("M3.8 20.2h16.4"),
    path("M7 20.2v-5", "bar-a"),
    path("M12 20.2v-9", "bar-b"),
    path("M17 20.2v-13", "bar-c"),
  ],
  // An open book; a page turns from right to left.
  library: () => [
    path("M12 6.6C10.2 5.3 7.6 4.7 4 4.9v13.4c3.6-.2 6.2.4 8 1.7 1.8-1.3 4.4-1.9 8-1.7V4.9c-3.6-.2-6.2.4-8 1.7Z"),
    path("M12 6.6V20"),
    path("M12 6.6c1.6-1.1 3.6-1.6 6.2-1.6V18.4c-2.6 0-4.6.5-6.2 1.6", "page"),
  ],
  // A compass whose needle swings and settles on north.
  explore: () => [
    createElement("circle", { cx: 12, cy: 12, r: 8.6 }),
    path("M15.4 8.6 13.5 13.5 8.6 15.4 10.5 10.5Z", "needle", { fill: "currentColor", fillOpacity: 0.18 }),
  ],
};

function drawn(name: NavIconName) {
  function DrawnNavIcon({ size = 24, className, active = false }: DrawnNavIconProps) {
    return createElement(
      "svg",
      {
        width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: active ? 2.2 : 1.8,
        strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false", overflow: "visible",
        className: ["fitx-navicon", `fitx-navicon--${name}`, className].filter(Boolean).join(" "),
        "data-navicon": name,
      },
      // Passed as separate arguments, so React needs no keys for them.
      ...DRAWINGS[name](),
    );
  }
  DrawnNavIcon.displayName = `NavIcon(${name})`;
  /** Marks a nav icon that takes `active` itself (lucide icons take strokeWidth instead). */
  DrawnNavIcon.fitxNavIcon = true as const;
  return DrawnNavIcon;
}

export const HomeNavIcon = drawn("home");
export const WorkoutsNavIcon = drawn("workouts");
export const NutritionNavIcon = drawn("nutrition");
export const CoachNavIcon = drawn("coach");
export const ProgressNavIcon = drawn("progress");
export const LibraryNavIcon = drawn("library");
export const ExploreNavIcon = drawn("explore");
