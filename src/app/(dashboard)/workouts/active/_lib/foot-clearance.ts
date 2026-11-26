/**
 * Keeping what the live workout says clear of its own bars at the window's foot (round 3d re-check: on a desktop,
 * Finish workout's reason showed under the buttons, its middle under the floating rest timer). The page fixes two bars
 * there: the rest timer (RestDock) while a rest runs and, on a phone, Previous and Next; both rise above the privacy
 * banner while it is open. When the browser brings something into view it keeps clear what html's scroll padding names
 * (globals.css --fitx-scroll-room-bottom, plus 12 px), and it adds the element's own scroll-margin-bottom to that
 * padding. Since round 3f the two bars are in that padding themselves: while they show they set the shell's "foot"
 * inset (bottom-inset.ts, through footBarRef), so a control reached with Tab stops above them too. revealAboveFoot's
 * scroll margin asks only for what goes beyond the padding, which is then nothing; it stays for a bar not measured
 * yet. Pure apart from the page given.
 */
import { bottomInset, fixedAreaHeight, type InsetBox } from "@/components/layout/bottom-inset";
import { focusLost, type FocusState } from "@/lib/workouts/focus-heading";
import type { ActionProblem } from "./action-problem";

/**
 * A callback ref for one of the page's bars fixed over its foot. It keeps `holder` pointing at the bar (what
 * revealAboveFoot measures) and, while the bar is in the page, has `track` keep html's scroll padding clear of it (the
 * shell's trackBottomInset under "foot"; it returns the way to stop). React 19 runs the cleanup returned here when the
 * bar leaves the page (the rest ends), and then nothing is kept clear for it any more.
 */
export function footBarRef<T extends object>(holder: { current: T | null }, track: (bar: T) => () => void) {
  return (bar: T | null) => {
    holder.current = bar;
    if (!bar) return undefined;
    const stop = track(bar);
    return () => {
      stop();
      if (holder.current === bar) holder.current = null;
    };
  };
}

/** The room left between what is brought into view and the bar under it: html's scroll padding leaves the same. */
export const FOOT_ROOM = 12;

/** A bar fixed to the foot, or null while the page does not draw it (no rest running). */
export type FootBar = { getBoundingClientRect(): InsetBox } | null;

/**
 * The px the page's bars hide at the window's foot: from the highest top edge among those showing down to the bottom
 * (bottom-inset.ts bottomInset); 0 when none shows (not drawn, display: none at that width, or below the window).
 */
export function footHidden(bars: readonly (InsetBox | null)[], viewportHeight: number): number {
  return bars.reduce((most, box) => Math.max(most, bottomInset(box, viewportHeight)), 0);
}

/**
 * The scroll-margin-bottom that stops an element FOOT_ROOM px above those bars once html's scroll padding (`padding`,
 * in px) is added to it: only what goes beyond that padding, so the open banner's room is not counted twice; 0 when no
 * bar shows or the padding already clears them.
 */
export function footMargin(hidden: number, padding: number): number {
  if (!(hidden > 0)) return 0;
  const counted = Number.isFinite(padding) && padding > 0 ? padding : 0;
  return Math.max(0, Math.ceil(hidden + FOOT_ROOM - counted));
}

/** What revealAboveFoot reads from the page: where focus is, and the sizes it measures against. */
export type FootPage = FocusState & {
  /** The height bars fixed to the bottom are laid out against (bottom-inset.ts fixedAreaHeight). */
  viewportHeight: number;
  /** html's computed scroll-padding-bottom, in px (NaN when it cannot be read: then none is counted). */
  scrollPadding: number;
};

type Container = { contains(node: unknown): boolean };
type Revealable = Container & {
  style: { scrollMarginBottom: string };
  scrollIntoView(options: { block: "nearest" }): void;
};
/** Something with a place on screen, as getBoundingClientRect gives it. */
type Measured = { getBoundingClientRect(): { bottom: number } };

/**
 * Brings `element` into view clear of the page's bars, scrolling only as far as that needs (nothing moves when it is
 * clear already; the page's own scroll-behavior decides whether it glides), unless the member has moved focus out of
 * `scope` (the element itself, unless another is given) meanwhile (to the header, say): then the page stays where they
 * put it. Focus itself never moves. True when it asked the browser to bring the element into view.
 */
export function revealAboveFoot(element: Revealable, bars: readonly FootBar[], page: FootPage, scope: Container = element): boolean {
  if (!focusLost(page) && !scope.contains(page.activeElement)) return false;
  const hidden = footHidden(bars.map((bar) => (bar ? bar.getBoundingClientRect() : null)), page.viewportHeight);
  element.style.scrollMarginBottom = `${footMargin(hidden, page.scrollPadding)}px`;
  element.scrollIntoView({ block: "nearest" });
  return true;
}

/** Of a reason and the control focus is on beside it, the one lower on the page: bringing that clear brings both. */
export function lowerOf<T extends Measured>(reason: T, focused: T | null): T {
  return focused && focused.getBoundingClientRect().bottom > reason.getBoundingClientRect().bottom ? focused : reason;
}

function isRevealable(node: unknown): node is Revealable & Measured {
  if (!node || typeof node !== "object") return false;
  const { contains, getBoundingClientRect, scrollIntoView, style } = node as Partial<Revealable & Measured>;
  return typeof contains === "function" && typeof getBoundingClientRect === "function" && typeof scrollIntoView === "function" && typeof style === "object" && style !== null;
}

/** Where the live workout shows an action's reason, for revealReason (null: not drawn now). */
export type ReasonPlaces = {
  /**
   * The block holding a place's control and its reason, next to each other: Finish workout's bar, the clock, the paused
   * banner with its reason, Swap's row with its reason, Add set's row with its reason.
   */
  blocks: Record<Exclude<ActionProblem["at"], "set">, Revealable | null>;
  /** A set's reason and the set's own row (the box at fault and the Complete button are in it), when on screen. */
  set(setId: string): { reason: Revealable & Measured; row: Container } | null;
};

/**
 * Brings the reason an action has just given clear of the page's bars at the window's foot: Finish workout's and
 * Abandon's lay under the floating rest timer on a desktop (round 3d re-check), and Swap's, Add set's and a refused
 * set's could on a tablet or phone while resting (round 3e open items); the clock's and the paused banner's sit at the
 * same kind of place. It brings clear the block that holds the control used and its reason; for a set, the lower of
 * the reason and the box or button focus is on in that set's row (a refused box takes focus above its reason, and the
 * current set's Complete set button sits under it), so both show. As revealAboveFoot: focus never moves, and nothing
 * moves when focus has gone elsewhere meanwhile. True when it asked the browser to scroll.
 */
export function revealReason(problem: ActionProblem, places: ReasonPlaces, bars: readonly FootBar[], page: FootPage): boolean {
  if (problem.at !== "set") {
    const block = places.blocks[problem.at];
    return block ? revealAboveFoot(block, bars, page) : false;
  }
  const found = places.set(problem.setId);
  if (!found) return false;
  const focused = isRevealable(page.activeElement) && found.row.contains(page.activeElement) ? page.activeElement : null;
  return revealAboveFoot(lowerOf(found.reason, focused), bars, page, found.row);
}

/** The browser's page for revealAboveFoot (call it in an effect, after the element has been drawn). */
export function browserFootPage(): FootPage {
  const root = document.documentElement;
  return {
    activeElement: document.activeElement,
    body: document.body,
    viewportHeight: fixedAreaHeight(window.innerHeight, root.clientHeight),
    scrollPadding: Number.parseFloat(window.getComputedStyle(root).scrollPaddingBottom),
  };
}
