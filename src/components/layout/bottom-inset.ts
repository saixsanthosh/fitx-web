/**
 * What a bar fixed to the bottom of the screen hides, so the page can keep it clear (bugs 12 and 79). Each such bar
 * measures itself and sets its own CSS variable on <html>; globals.css turns the larger one into the page's
 * scroll-padding-bottom, so a control reached with Tab (or brought into view by scrollIntoView) stops above the bar
 * with its focus ring showing, and, for the privacy banner, into extra room at the end of the page so even the last
 * control can be scrolled clear of it.
 *
 * No imports and no React, so it is unit-tested; useBottomInsetRef.ts attaches it to an element.
 */

/** The bars and the variables they set: the phone's bottom bar (BottomNav) and the privacy banner (AnalyticsConsent). */
export const BOTTOM_INSETS = {
  bar: "--fitx-inset-bottom-bar",
  consent: "--fitx-inset-consent",
} as const;
export type BottomInsetName = keyof typeof BOTTOM_INSETS;

/** Fired on window when a bar's inset changes, so a bar stacked above another one measures itself again. */
export const BOTTOM_INSET_EVENT = "fitx:bottom-inset";

export type InsetBox = { top: number; width: number; height: number };

/**
 * The px a fixed element hides at the bottom of the screen: from its top edge down to the bottom of the viewport,
 * which takes in any gap under it (a banner floating 12 px up still hides those 12 px for a focus ring). 0 when it
 * is not shown (no size, as with display: none) or lies wholly below the viewport.
 */
export function bottomInset(box: InsetBox | null, viewportHeight: number): number {
  if (!box || !(box.width > 0) || !(box.height > 0) || !(viewportHeight > 0)) return 0;
  const hidden = viewportHeight - box.top;
  if (!Number.isFinite(hidden) || hidden <= 0) return 0;
  return Math.ceil(Math.min(hidden, viewportHeight));
}

/**
 * The height of the area a bar fixed to the bottom is laid out in, which its top edge is measured against. On a phone
 * that area grows when the browser's URL bar or toolbar collapses as the member scrolls, and the bar moves down with
 * it, while <html>'s clientHeight (the initial containing block) keeps the toolbar-shown height; innerHeight follows
 * the visible height. Measured against clientHeight, the bar's 67 px came to about 11 px on Chrome for Android, and
 * could come to nothing on iOS, once the URL bar hid (review of bug 12). The larger of the two, because innerHeight
 * follows the visual viewport, which a pinch zoom or the on-screen keyboard can make smaller than that area (the bar
 * does not move then); on a desktop with a horizontal scrollbar it only makes the inset a little larger, which does
 * no harm.
 */
export function fixedAreaHeight(innerHeight: number, clientHeight: number): number {
  const finite = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  return Math.max(finite(innerHeight), finite(clientHeight));
}

/** The variable's value for an inset, or null to remove the variable (nothing hidden). */
export function insetValue(px: number): string | null {
  return Number.isFinite(px) && px > 0 ? `${Math.ceil(px)}px` : null;
}

/** The parts of the page the tracker uses (the browser's by default; tests pass stand-ins). */
export type InsetHost = {
  root: { clientHeight: number; style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown } };
  view: Pick<Window, "innerHeight" | "addEventListener" | "removeEventListener" | "dispatchEvent" | "requestAnimationFrame" | "cancelAnimationFrame">;
  /** Calls `onResize` whenever the element's size changes (a ResizeObserver); returns the way to stop. */
  watchSize(element: object, onResize: () => void): () => void;
};

function browserHost(): InsetHost {
  return {
    root: document.documentElement,
    view: window,
    watchSize(element, onResize) {
      if (typeof ResizeObserver !== "function") return () => undefined;
      const observer = new ResizeObserver(onResize);
      observer.observe(element as Element);
      return () => observer.disconnect();
    },
  };
}

/**
 * Keeps `name`'s variable on <html> equal to what `element` hides, now and through resizes (its own and the
 * window's), the element hiding (display: none at some widths) and another bar's change (a banner above the phone's
 * bar moves when the bar comes or goes). Returns the cleanup, which removes the variable.
 */
export function trackBottomInset(element: { getBoundingClientRect(): InsetBox }, name: BottomInsetName, host: InsetHost = browserHost()): () => void {
  const { root, view } = host;
  const variable = BOTTOM_INSETS[name];
  let frame = 0;
  let current: string | null = null;
  const announce = () => view.dispatchEvent(new CustomEvent(BOTTOM_INSET_EVENT, { detail: { name } }));
  const measure = () => {
    frame = 0;
    const next = insetValue(bottomInset(element.getBoundingClientRect(), fixedAreaHeight(view.innerHeight, root.clientHeight)));
    if (next === current) return;
    current = next;
    if (next) root.style.setProperty(variable, next);
    else root.style.removeProperty(variable);
    announce();
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(measure);
  };
  const onOther = (event: Event) => {
    if ((event as CustomEvent<{ name?: string }>).detail?.name !== name) schedule();
  };
  measure();
  const stopWatching = host.watchSize(element, schedule);
  view.addEventListener("resize", schedule);
  view.addEventListener(BOTTOM_INSET_EVENT, onOther);
  return () => {
    if (frame) view.cancelAnimationFrame(frame);
    stopWatching();
    view.removeEventListener("resize", schedule);
    view.removeEventListener(BOTTOM_INSET_EVENT, onOther);
    root.style.removeProperty(variable);
    if (current) announce();
  };
}
