/**
 * Keeping what the live workout says clear of its own bars at the window's foot (round 3d re-check: on a desktop,
 * Finish workout's reason showed under the buttons, its middle under the floating rest timer). The page fixes two bars
 * there: the rest timer (RestDock) while a rest runs and, on a phone, Previous and Next; both rise above the privacy
 * banner while it is open. When the browser brings something into view it keeps clear only what html's scroll padding
 * names (globals.css --fitx-scroll-room-bottom: the shell's phone bar or the open banner, plus 12 px), and it adds the
 * element's own scroll-margin-bottom to that padding; so an element that must also clear the page's bars asks for the
 * rest as its scroll margin, as the AI Coach's end marker does (Coach.module.css .end). Pure apart from the page given.
 */
import { bottomInset, fixedAreaHeight, type InsetBox } from "@/components/layout/bottom-inset";
import { focusLost, type FocusState } from "@/lib/workouts/focus-heading";

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

type Revealable = {
  style: { scrollMarginBottom: string };
  contains(node: unknown): boolean;
  scrollIntoView(options: { block: "nearest" }): void;
};

/**
 * Brings `element` into view clear of the page's bars, scrolling only as far as that needs (nothing moves when it is
 * clear already; the page's own scroll-behavior decides whether it glides), unless the member has moved focus out of it
 * meanwhile (to the header, say): then the page stays where they put it. Focus itself never moves. True when it asked
 * the browser to bring the element into view.
 */
export function revealAboveFoot(element: Revealable, bars: readonly FootBar[], page: FootPage): boolean {
  if (!focusLost(page) && !element.contains(page.activeElement)) return false;
  const hidden = footHidden(bars.map((bar) => (bar ? bar.getBoundingClientRect() : null)), page.viewportHeight);
  element.style.scrollMarginBottom = `${footMargin(hidden, page.scrollPadding)}px`;
  element.scrollIntoView({ block: "nearest" });
  return true;
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
