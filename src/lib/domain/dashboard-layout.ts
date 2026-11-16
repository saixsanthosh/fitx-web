/**
 * The Home dashboard's widgets: which exist, the default arrangement, and how a stored arrangement
 * (user_preferences.dashboard_layout) is read back and changed.
 *
 * The stored value is `{ version: 1, items: [{ id, visible }] }`. Reading is forgiving: unknown or
 * repeated ids are dropped, widgets released after the layout was saved are added hidden (so Home
 * never changes unasked), and shown widgets always come before hidden ones.
 *
 * No imports, so `node --test` can load this file directly.
 */

export const WIDGETS = {
  today: { title: "Today", description: "Calories and protein against your targets" },
  todo: { title: "To-Do", description: "Today's tasks and workouts" },
  goals: { title: "Goals", description: "Your daily, weekly and long-term goals" },
  weight: { title: "Weight", description: "Latest weigh-in and your target" },
  water: { title: "Water", description: "Today's water, with quick add" },
  workout: { title: "Today's workout", description: "What's planned and what's done" },
  week: { title: "This week", description: "Workouts this week against your plan" },
  macros: { title: "Macros", description: "Protein, carbs and fat against targets" },
} as const;

export type WidgetId = keyof typeof WIDGETS;
export type LayoutItem = { id: WidgetId; visible: boolean };
export type StoredLayout = { version: 1; items: LayoutItem[] };

export const LAYOUT_VERSION = 1;
export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];
/** Shown on a new account, in this order: the brief's minimal Home. Everything else starts hidden. */
export const DEFAULT_VISIBLE: readonly WidgetId[] = ["today", "todo", "goals", "weight"];

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WIDGETS, value);
}

export function defaultLayout(): LayoutItem[] {
  return [
    ...DEFAULT_VISIBLE.map((id) => ({ id, visible: true })),
    ...WIDGET_IDS.filter((id) => !DEFAULT_VISIBLE.includes(id)).map((id) => ({ id, visible: false })),
  ];
}

/** Shown widgets first, hidden after, each group keeping its order. */
function normalize(items: LayoutItem[]): LayoutItem[] {
  return [...items.filter((item) => item.visible), ...items.filter((item) => !item.visible)];
}

/** Reads a stored layout (or anything else) into a complete, valid arrangement. */
export function sanitizeLayout(raw: unknown): LayoutItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : null;
  if (!list) return defaultLayout();
  const seen = new Set<WidgetId>();
  const items: LayoutItem[] = [];
  for (const entry of list) {
    const id = entry && typeof entry === "object" ? (entry as { id?: unknown }).id : entry;
    if (!isWidgetId(id) || seen.has(id)) continue;
    seen.add(id);
    const visible = entry && typeof entry === "object" ? (entry as { visible?: unknown }).visible !== false : true;
    items.push({ id, visible });
  }
  if (!items.length) return defaultLayout();
  for (const id of WIDGET_IDS) if (!seen.has(id)) items.push({ id, visible: false });
  return normalize(items);
}

export function serializeLayout(items: LayoutItem[]): StoredLayout {
  return { version: LAYOUT_VERSION, items: normalize(items).map(({ id, visible }) => ({ id, visible })) };
}

export function visibleIds(items: LayoutItem[]): WidgetId[] {
  return items.filter((item) => item.visible).map((item) => item.id);
}

export function hiddenIds(items: LayoutItem[]): WidgetId[] {
  return items.filter((item) => !item.visible).map((item) => item.id);
}

export function sameLayout(a: LayoutItem[], b: LayoutItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id && item.visible === b[index].visible);
}

export type LayoutAction =
  /** Move a shown widget up (negative) or down (positive) among the shown widgets. */
  | { type: "move"; id: WidgetId; delta: number }
  /** The shown widgets in a new order (a drag). Ids that are not shown are ignored. */
  | { type: "reorder"; order: WidgetId[] }
  /** Show a hidden widget at the end of Home. */
  | { type: "show"; id: WidgetId }
  /** Hide a shown widget. */
  | { type: "hide"; id: WidgetId }
  | { type: "reset" }
  | { type: "replace"; items: LayoutItem[] };

/** Returns the same array when the action changes nothing, so callers can skip a save. */
export function layoutReducer(state: LayoutItem[], action: LayoutAction): LayoutItem[] {
  const shown = state.filter((item) => item.visible);
  const hidden = state.filter((item) => !item.visible);
  let next: LayoutItem[] = state;
  switch (action.type) {
    case "move": {
      const from = shown.findIndex((item) => item.id === action.id);
      if (from < 0 || !Number.isFinite(action.delta)) break;
      const to = Math.max(0, Math.min(shown.length - 1, from + Math.trunc(action.delta)));
      if (to === from) break;
      const moved = [...shown];
      const [item] = moved.splice(from, 1);
      moved.splice(to, 0, item);
      next = [...moved, ...hidden];
      break;
    }
    case "reorder": {
      const byId = new Map(shown.map((item) => [item.id, item]));
      const ordered: LayoutItem[] = [];
      for (const id of action.order) {
        const item = byId.get(id);
        if (item && !ordered.includes(item)) ordered.push(item);
      }
      for (const item of shown) if (!ordered.includes(item)) ordered.push(item);
      next = [...ordered, ...hidden];
      break;
    }
    case "show": {
      const item = hidden.find((entry) => entry.id === action.id);
      if (!item) break;
      next = [...shown, { id: item.id, visible: true }, ...hidden.filter((entry) => entry !== item)];
      break;
    }
    case "hide": {
      const item = shown.find((entry) => entry.id === action.id);
      if (!item) break;
      next = [...shown.filter((entry) => entry !== item), { id: item.id, visible: false }, ...hidden];
      break;
    }
    case "reset":
      next = defaultLayout();
      break;
    case "replace":
      next = sanitizeLayout(action.items);
      break;
  }
  return sameLayout(next, state) ? state : next;
}

/** "Weight moved to position 2 of 4", for a live region after a move. */
export function describePosition(items: LayoutItem[], id: WidgetId): string {
  const shown = visibleIds(items);
  const index = shown.indexOf(id);
  const name = WIDGETS[id].title;
  return index < 0 ? `${name} is hidden` : `${name}, position ${index + 1} of ${shown.length}`;
}
