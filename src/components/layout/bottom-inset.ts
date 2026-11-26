/**
 * What a bar fixed to the bottom of the screen hides, so the page can keep it clear (bugs 12 and 79). Each such bar
 * measures itself and sets its own CSS variable on <html>; globals.css turns the largest into the page's
 * scroll-padding-bottom, so a control reached with Tab (or brought into view by scrollIntoView) stops above the bar
 * with its focus ring showing, and, for the privacy banner, into extra room at the end of the page so even the last
 * control can be scrolled clear of it.
 *
 * No imports and no React, so it is unit-tested; useBottomInsetRef.ts attaches it to an element.
 */

/**
 * The bars and the variables they set: the phone's bottom bar (BottomNav), the privacy banner (AnalyticsConsent), and
 * a page's own bars fixed over its foot ("foot": the live workout's rest timer and, on a phone, its Previous and Next;
 * release 3 fix round 3f). Those rise above the open banner, so only html's scroll padding reads "foot": were the
 * banner's place to read it, as it reads "bar", the banner would rise above bars that rise above it, and neither would
 * ever settle. Several bars can set one variable; it then holds the most any of them hides (trackBottomInset).
 */
export const BOTTOM_INSETS = {
  bar: "--fitx-inset-bottom-bar",
  consent: "--fitx-inset-consent",
  foot: "--fitx-inset-page-foot",
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

/** What each bar tracked under one variable hides now (px), and the value written for them, per <html>. */
type SharedInset = { written: string | null; hidden: Map<object, number> };
const sharedInsets = new WeakMap<object, Map<string, SharedInset>>();

function sharedInset(root: object, variable: string): SharedInset {
  let byVariable = sharedInsets.get(root);
  if (!byVariable) sharedInsets.set(root, (byVariable = new Map()));
  let shared = byVariable.get(variable);
  if (!shared) byVariable.set(variable, (shared = { written: null, hidden: new Map() }));
  return shared;
}

/**
 * Keeps `name`'s variable on <html> equal to what `element` hides, now and through resizes (its own and the
 * window's), the element hiding (display: none at some widths) and another bar's change (a banner above the phone's
 * bar moves when the bar comes or goes). Returns the cleanup, which removes the variable. With several elements
 * tracked under one name (a page's rest timer and its Previous and Next, both "foot"), the variable holds the most any
 * of them hides, and an element's cleanup leaves what the others still hide.
 */
export function trackBottomInset(element: { getBoundingClientRect(): InsetBox }, name: BottomInsetName, host: InsetHost = browserHost()): () => void {
  const { root, view } = host;
  const variable = BOTTOM_INSETS[name];
  const shared = sharedInset(root, variable);
  const self = {};
  let frame = 0;
  const announce = () => view.dispatchEvent(new CustomEvent(BOTTOM_INSET_EVENT, { detail: { name } }));
  // The most the elements tracked under this name hide, or nothing when none hides anything; true when it changed.
  const write = () => {
    const next = insetValue(Math.max(0, ...shared.hidden.values()));
    if (next === shared.written) return false;
    shared.written = next;
    if (next) root.style.setProperty(variable, next);
    else root.style.removeProperty(variable);
    return true;
  };
  const measure = () => {
    frame = 0;
    shared.hidden.set(self, bottomInset(element.getBoundingClientRect(), fixedAreaHeight(view.innerHeight, root.clientHeight)));
    if (write()) announce();
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
    shared.hidden.delete(self);
    if (write()) announce();
  };
}
