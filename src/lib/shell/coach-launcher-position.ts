/**
 * Where the floating AI Coach button sits (CoachLauncher.tsx). Pure, so it is unit-tested.
 *
 * The button rests against the left or right edge of the screen, at a height the member chose by dragging it
 * (kept per viewport class: phone, tablet, desktop). It is never placed over anything marked `data-coach-avoid`
 * (the phone's bottom bar, sticky save bars, camera controls…): it moves up above such an element, or to the
 * other edge when there is no room, and keeps clear of the header at the top. On tablets and desktops the menu
 * (the rail or the sidebar, marked `data-coach-edge`) runs down the left side: there the left edge is the page's,
 * beside the menu, so the button never rests on a menu item.
 */

export type ViewportClass = "phone" | "tablet" | "desktop";
export type LauncherSpot = { side: "left" | "right"; /** The button's top as a share of the free height (0 top, 1 bottom). */ y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
/** `leftInset`: the width of the menu column down the left side (0 or absent on phones, which have a bottom bar). */
export type Viewport = { width: number; height: number; safeBottom?: number; leftInset?: number };

/** Pages where the button never shows: the coach itself, onboarding and the focus screens. */
export const LAUNCHER_HIDDEN_ON = ["/ai-coach", "/onboarding", "/workouts/active", "/activity/record", "/workouts/form-check"] as const;

/** localStorage: the dragged spot per viewport class, as JSON `{ phone?: LauncherSpot, tablet?: …, desktop?: … }`. */
export const LAUNCHER_SPOT_KEY = "fitx-coach-launcher-spot";

/** The button's size (px) and its gap to the screen edge and to anything it avoids. */
export const LAUNCHER_SIZE = 52;
export const LAUNCHER_GAP = 12;
/** The top of the screen it leaves free: the phone and tablet header, or the desktop page's own heading area. */
export const LAUNCHER_TOP = 76;

export function launcherHiddenOn(pathname: string): boolean {
  return LAUNCHER_HIDDEN_ON.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function viewportClass(width: number): ViewportClass {
  if (width < 768) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

/** Where the left edge is: after the menu column, if any, and never past the middle of the screen. */
function leftEdge(viewport: Viewport): number {
  const inset = viewport.leftInset ?? 0;
  return Number.isFinite(inset) ? Math.min(viewport.width / 2, Math.max(0, inset)) : 0;
}

/** Phones keep the button at the right edge, low, just above the bottom bar; larger screens in the corner. */
export function defaultSpot(): LauncherSpot {
  return { side: "right", y: 1 };
}

export function edgeGap(kind: ViewportClass): number {
  return kind === "phone" ? LAUNCHER_GAP : 24;
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const inflate = (rect: Rect, by: number): Rect => ({ left: rect.left - by, top: rect.top - by, right: rect.right + by, bottom: rect.bottom + by });

/**
 * The button's top-left corner for a spot, kept on screen and clear of every obstacle. Returns `null` when no
 * place on either edge is free (the button then stays out of the way until there is room).
 */
export function placeLauncher(spot: LauncherSpot, viewport: Viewport, obstacles: readonly Rect[] = [], size = LAUNCHER_SIZE): { x: number; y: number; side: "left" | "right" } | null {
  const kind = viewportClass(viewport.width);
  const gap = edgeGap(kind);
  const top = Math.min(LAUNCHER_TOP, Math.max(0, viewport.height - size - gap));
  const bottom = Math.max(top, viewport.height - size - gap - (viewport.safeBottom ?? 0));
  const wanted = top + Math.min(1, Math.max(0, spot.y)) * (bottom - top);
  const solid = obstacles.filter((rect) => rect.right > rect.left && rect.bottom > rect.top).map((rect) => inflate(rect, LAUNCHER_GAP));

  for (const side of spot.side === "left" ? (["left", "right"] as const) : (["right", "left"] as const)) {
    const x = side === "left" ? leftEdge(viewport) + gap : viewport.width - size - gap;
    let y = wanted;
    // Move up past each obstacle in the way; a few passes settle stacked bars.
    for (let pass = 0; pass < 8; pass += 1) {
      const box = { left: x, top: y, right: x + size, bottom: y + size };
      const hit = solid.find((rect) => overlaps(box, rect));
      if (!hit) return { x, y, side };
      y = hit.top - size;
      if (y < top) break;
    }
  }
  return null;
}

/** After a drag: the edge nearer the button's centre (the page's, beside any menu column) and its height as a share of the free height. */
export function spotFromDrop(x: number, y: number, viewport: Viewport, size = LAUNCHER_SIZE): LauncherSpot {
  const gap = edgeGap(viewportClass(viewport.width));
  const top = Math.min(LAUNCHER_TOP, Math.max(0, viewport.height - size - gap));
  const bottom = Math.max(top, viewport.height - size - gap - (viewport.safeBottom ?? 0));
  const share = bottom > top ? (y - top) / (bottom - top) : 1;
  const left = leftEdge(viewport);
  return { side: x + size / 2 < left + (viewport.width - left) / 2 ? "left" : "right", y: Math.round(Math.min(1, Math.max(0, share)) * 1000) / 1000 };
}

/** The stored spot for a viewport class, or the default when nothing (or something unreadable) is stored. */
export function readSpot(raw: string | null, kind: ViewportClass): LauncherSpot {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<Record<ViewportClass, Partial<LauncherSpot>>>)[kind] : null;
    if (value && (value.side === "left" || value.side === "right") && typeof value.y === "number" && Number.isFinite(value.y)) {
      return { side: value.side, y: Math.min(1, Math.max(0, value.y)) };
    }
  } catch {
    // Unreadable: the default.
  }
  return defaultSpot();
}

/** The stored JSON with one viewport class's spot replaced. */
export function writeSpot(raw: string | null, kind: ViewportClass, spot: LauncherSpot): string {
  let all: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) all = parsed as Record<string, unknown>;
  } catch {
    all = {};
  }
  return JSON.stringify({ ...all, [kind]: spot });
}

/** How far a pointer must move before a press becomes a drag (px), so a tap still opens the coach. */
export const DRAG_THRESHOLD = 6;

/**
 * The coach panel's events (contract with coach-activity's coach-events.ts, which names them COACH_OPEN_EVENT and
 * COACH_CLOSE_EVENT; each side tests the literal value). The launcher dispatches the open event, cancelable; a
 * mounted CoachPanelHost calls preventDefault() and opens the panel; the panel dispatches the close event on close.
 */
export const LAUNCHER_OPEN_EVENT = "fitx:coach-open";
export const LAUNCHER_CLOSE_EVENT = "fitx:coach-close";

type EventTargetish = { dispatchEvent(event: Event): boolean };

/**
 * Asks for the coach panel. When nothing handles it (no panel host is mounted), `fallback` runs instead: the
 * launcher then opens the AI Coach page. Returns whether the panel took it.
 */
export function openCoachPanel(target: EventTargetish, fallback: () => void, source = "launcher"): boolean {
  const event = new CustomEvent(LAUNCHER_OPEN_EVENT, { cancelable: true, detail: { source } });
  const handled = !target.dispatchEvent(event);
  if (!handled) fallback();
  return handled;
}
