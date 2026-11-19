/**
 * The Home dashboard's widgets: which exist, the default arrangement, and how a stored arrangement
 * (user_preferences.dashboard_layout) is read back and changed.
 *
 * Home always shows its fixed parts first: the Today ring (the hero), then the To-Do list and Goals side by
 * side. The widgets here come after them, in the member's order. "today", "todo" and "goals" were widgets in
 * an older FITX; they are now fixed parts of Home (FIXED_PARTS), so a stored layout's entries for them are
 * dropped on read and never written back.
 *
 * The stored value is `{ version: 1, items: [{ id, visible }] }`. Reading is forgiving: unknown or
 * repeated ids are dropped, widgets released after the layout was saved are added hidden (so Home
 * never changes unasked) and reported as `fresh`, so Home can offer them once, and shown widgets always
 * come before hidden ones. A retired id is read as the widget that replaced it ("workout", Today's
 * workout, is now "plan", Today's plan, in the same place).
 *
 * No imports, so `node --test` can load this file directly.
 */

export const WIDGETS = {
  plan: { title: "Today's plan", description: "Your workout, a rest day or what to plan" },
  next: { title: "Focus next", description: "What your logs suggest next" },
  muscles: { title: "Muscles this week", description: "Muscles your logged sets worked" },
  weight: { title: "Weight", description: "Latest weigh-in and your target" },
  water: { title: "Water", description: "Today's water, with quick add" },
  week: { title: "This week", description: "Workouts against your plan" },
  macros: { title: "Macros", description: "Protein, carbs and fat" },
} as const;

/** Parts of Home that are always there, ahead of the widgets; once widgets, now never stored. */
export const FIXED_PARTS = ["today", "todo", "goals"] as const;

export type WidgetId = keyof typeof WIDGETS;
export type LayoutItem = { id: WidgetId; visible: boolean };
export type StoredLayout = { version: 1; items: LayoutItem[] };

export const LAYOUT_VERSION = 1;
export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];
/**
 * Shown on a new account under the fixed parts: weight and water, the two things logged from Home. Everything
 * else starts hidden and is one tap away in Customise.
 */
export const DEFAULT_VISIBLE: readonly WidgetId[] = ["weight", "water"];
/** Ids an older FITX stored, and the widget that took each one's place. */
export const RETIRED_IDS: Readonly<Record<string, WidgetId>> = { workout: "plan" };
/** Widgets that span the whole Home grid. */
export const WIDE_WIDGETS: ReadonlySet<WidgetId> = new Set<WidgetId>(["plan"]);

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

export type ReadLayout = {
  items: LayoutItem[];
  /**
   * Widgets the stored arrangement did not know about (released after it was saved), added hidden. Empty for
   * a new account (no stored layout): the default arrangement already includes everything worth showing.
   * A retired id that was hidden does not count as knowing its replacement, so it is offered too.
   */
  fresh: WidgetId[];
};

/** Reads a stored layout (or anything else) into a complete, valid arrangement and the widgets new to it. */
export function readLayout(raw: unknown): ReadLayout {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : null;
  if (!list) return { items: defaultLayout(), fresh: [] };
  const seen = new Set<WidgetId>();
  const known = new Set<WidgetId>();
  const items: LayoutItem[] = [];
  for (const entry of list) {
    const storedId = entry && typeof entry === "object" ? (entry as { id?: unknown }).id : entry;
    const retired = typeof storedId === "string" && Object.prototype.hasOwnProperty.call(RETIRED_IDS, storedId);
    const id = retired ? RETIRED_IDS[storedId as string] : storedId;
    if (!isWidgetId(id) || seen.has(id)) continue;
    const visible = entry && typeof entry === "object" ? (entry as { visible?: unknown }).visible !== false : true;
    seen.add(id);
    // A hidden retired widget never showed its replacement, so the replacement is still new to this member.
    if (!retired || visible) known.add(id);
    items.push({ id, visible });
  }
  if (!items.length) return { items: defaultLayout(), fresh: [] };
  for (const id of WIDGET_IDS) if (!seen.has(id)) items.push({ id, visible: false });
  return { items: normalize(items), fresh: WIDGET_IDS.filter((id) => !known.has(id) && !items.some((item) => item.id === id && item.visible)) };
}

/** Reads a stored layout (or anything else) into a complete, valid arrangement. */
export function sanitizeLayout(raw: unknown): LayoutItem[] {
  return readLayout(raw).items;
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
  /** Show several hidden widgets at once (accepting new widgets): a wide widget goes first, the rest at the end. */
  | { type: "adopt"; ids: WidgetId[] }
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
    case "adopt": {
      const wanted = hidden.filter((entry) => action.ids.includes(entry.id));
      if (!wanted.length) break;
      const lead = wanted.filter((entry) => WIDE_WIDGETS.has(entry.id)).map((entry) => ({ id: entry.id, visible: true }));
      const tail = wanted.filter((entry) => !WIDE_WIDGETS.has(entry.id)).map((entry) => ({ id: entry.id, visible: true }));
      next = [...lead, ...shown, ...tail, ...hidden.filter((entry) => !wanted.includes(entry))];
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

/** "Today's plan, Focus next and Muscles this week", for the new-widgets hint. */
export function widgetNames(ids: readonly WidgetId[]): string {
  const names = ids.map((id) => WIDGETS[id].title);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
