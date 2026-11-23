/**
 * Where Home's old deep links go now. Home keeps only the greeting and the daily quote (owner's phase 6):
 * goals moved to Progress, the To-Do list was removed, and planned workouts live in Workouts. So
 * `/dashboard?panel=…`, `/goals?tab=…`, `/planner` and `/tasks` send each old address to its new place
 * (BRIEF 3.7):
 *   goals (and any `new=<template>`) → /progress?panel=goals[&new=<template>]
 *   todo, today                      → /dashboard
 *   week                             → /workouts
 */
import { HOME_PANELS, type HomePanel } from "@/config/routes";
import { GOAL_TEMPLATES, type GoalTemplateKey } from "@/lib/domain/goals";

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** A goal template key, or null for anything else. */
export function goalTemplate(value: unknown): GoalTemplateKey | null {
  return GOAL_TEMPLATES.find((entry) => entry.key === value)?.key ?? null;
}

/** Progress's goals panel, optionally opening the goal editor on a template. */
export function progressGoalsHref(template: GoalTemplateKey | null = null): string {
  return template ? `/progress?panel=goals&new=${template}` : "/progress?panel=goals";
}

export const HOME_HREF = "/dashboard";
export const WORKOUTS_HREF = "/workouts";

/** Where each of Home's old panels lives now. */
export function panelTarget(panel: HomePanel, template: GoalTemplateKey | null = null): string {
  if (panel === "goals") return progressGoalsHref(template);
  if (panel === "week") return WORKOUTS_HREF;
  return HOME_HREF;
}

/** The Goals page's old tabs and the panel each one was. */
const TAB_PANELS: Readonly<Record<string, HomePanel>> = { goals: "goals", today: "todo", week: "week" };

/**
 * Where an old Goals address now lives. A template (`new=`) always opens Goals, as it did on the Goals page;
 * an unknown or missing tab means Goals.
 */
export function legacyGoalsTarget(params: Params): string {
  const template = goalTemplate(first(params.new));
  if (template) return progressGoalsHref(template);
  const tab = first(params.tab);
  return panelTarget((tab && TAB_PANELS[tab]) || "goals");
}

export type PanelRequest = { panel: HomePanel | null; template: GoalTemplateKey | null };

/** Reads `?panel=` and `&new=` off an address. A valid template on its own means the Goals panel. */
export function readPanelRequest(search: URLSearchParams | string): PanelRequest {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const raw = params.get("panel");
  const panel = (HOME_PANELS as readonly string[]).includes(raw ?? "") ? (raw as HomePanel) : null;
  const template = goalTemplate(params.get("new"));
  if (template && (panel === null || panel === "goals")) return { panel: "goals", template };
  return { panel, template: null };
}

/**
 * Where a Home address with old parameters should go, or null when it is plain Home. Any `panel` or `new`
 * parameter (even an unknown one) is resolved and dropped, so Home's address stays clean.
 */
export function homeRedirect(params: Params): string | null {
  const panel = first(params.panel);
  const template = first(params.new);
  if (panel === undefined && template === undefined) return null;
  const search = new URLSearchParams();
  if (panel !== undefined) search.set("panel", panel);
  if (template !== undefined) search.set("new", template);
  const request = readPanelRequest(search);
  return request.panel ? panelTarget(request.panel, request.template) : HOME_HREF;
}
