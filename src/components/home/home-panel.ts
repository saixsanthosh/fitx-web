/**
 * Home's deep links. Goals, the To-Do list and the week plan live on Home now; their old addresses
 * (/goals?tab=…, /planner, /tasks) redirect to `/dashboard?panel=…`, and Home reads the panel back:
 * "goals" and "todo" scroll to that section, "week" opens the week plan, and `new=<template>` opens the
 * goal editor on that template.
 */
import { HOME_PANELS, homePanel, type HomePanel } from "@/config/routes";
import { GOAL_TEMPLATES, type GoalTemplateKey } from "@/lib/domain/goals";

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A goal template key, or null for anything else. */
export function goalTemplate(value: unknown): GoalTemplateKey | null {
  return GOAL_TEMPLATES.find((entry) => entry.key === value)?.key ?? null;
}

/** The Goals page's old tabs and where each one is on Home. */
const TAB_PANELS: Readonly<Record<string, HomePanel>> = { goals: "goals", today: "todo", week: "week" };

/**
 * Where an old Goals address now lives on Home. A template (`new=`) always opens Goals, as it did on the
 * Goals page; an unknown or missing tab means Goals.
 */
export function legacyGoalsTarget(params: Params): string {
  const template = goalTemplate(first(params.new));
  if (template) return homePanel("goals", { new: template });
  const tab = first(params.tab);
  return homePanel((tab && TAB_PANELS[tab]) || "goals");
}

export type PanelRequest = { panel: HomePanel | null; template: GoalTemplateKey | null };

/** Reads `?panel=` and `&new=` off Home's address. A valid template on its own means the Goals panel. */
export function readPanelRequest(search: URLSearchParams | string): PanelRequest {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = params.get("panel");
  const panel = (HOME_PANELS as readonly string[]).includes(raw ?? "") ? (raw as HomePanel) : null;
  const template = goalTemplate(params.get("new"));
  if (template && (panel === null || panel === "goals")) return { panel: "goals", template };
  return { panel, template: null };
}

/** The element id of each panel's section on Home. */
export const PANEL_SECTION: Readonly<Record<Exclude<HomePanel, "week">, string>> = { goals: "home-goals", todo: "home-todo" };
