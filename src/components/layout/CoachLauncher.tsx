"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { CoachNavIcon } from "@/components/layout/nav-icons";
import { useHydrated } from "@/components/ui/use-hydrated";
import { COACH_LAUNCHER_CACHE_KEY, COACH_LAUNCHER_PREF_EVENT, loadLauncherPref, type LauncherPrefDetail } from "@/lib/shell/coach-launcher-pref";
import { COACH_SWITCH_CACHE_KEY, loadCoachSwitch } from "@/lib/shell/coach-switch";
import { cachedAnswer, knownAnswer } from "./coach-launcher-reveal";
import {
  DRAG_THRESHOLD,
  LAUNCHER_CLOSE_EVENT,
  LAUNCHER_SIZE,
  LAUNCHER_SPOT_KEY,
  launcherHiddenOn,
  openCoachPanel,
  placeLauncher,
  readSpot,
  spotFromDrop,
  viewportClass,
  writeSpot,
  type LauncherSpot,
  type Rect,
} from "@/lib/shell/coach-launcher-position";
import { cn } from "@/lib/utils";
import styles from "./CoachLauncher.module.css";

type Place = { x: number; y: number; side: "left" | "right" };
type Drag = { id: number; startX: number; startY: number; fromX: number; fromY: number; moved: boolean };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This device's cached answer under `key`, or null on a first visit (coach-launcher-reveal.ts). */
const cached = (key: string) => cachedAnswer(storage(), key);

/** Visible elements the button keeps clear of (`data-coach-avoid`), in viewport coordinates. */
function obstacles(self: HTMLElement | null): Rect[] {
  const rects: Rect[] = [];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-coach-avoid]"))) {
    if (self && (self === element || self.contains(element))) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  return rects;
}

/**
 * The menu column down the left side (the tablet rail or the desktop sidebar, marked `data-coach-edge`): how far it
 * reaches into the screen, or 0 when none shows (phones). The button's left edge is beside it, never on its links.
 */
function menuInset(): number {
  let inset = 0;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-coach-edge]"))) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.left > 1) continue;
    inset = Math.max(inset, rect.right);
  }
  return inset;
}

/**
 * An open modal sheet drawn in the page (role="dialog" with aria-modal, not a top-layer <dialog>). The button sits
 * above the page, so it would float over the sheet and its content: it waits until the sheet closes.
 */
function modalOpen(): boolean {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))) {
    if (element.closest("dialog")) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }
  return false;
}

/** Controls the button must not sit on: anything a member clicks, types into or watches. */
const CONTROL = "a[href], button, input, select, textarea, label, summary, video, canvas, iframe, [role=button], [role=link], [role=slider], [role=switch], [role=tab], [role=checkbox], [role=radio], [tabindex]:not([tabindex='-1'])";

/**
 * Controls under the spot the button would take (`elementsFromPoint` at its centre and near its corners). A control
 * wider than 60% of the screen (a whole clickable card) is left alone: the button then only covers its corner.
 */
function controlsUnder(spot: { x: number; y: number }, self: HTMLElement | null): Rect[] {
  const found = new Map<Element, Rect>();
  const inset = 8;
  const points = [[LAUNCHER_SIZE / 2, LAUNCHER_SIZE / 2], [inset, inset], [LAUNCHER_SIZE - inset, inset], [inset, LAUNCHER_SIZE - inset], [LAUNCHER_SIZE - inset, LAUNCHER_SIZE - inset]];
  for (const [dx, dy] of points) {
    for (const element of document.elementsFromPoint(spot.x + dx, spot.y + dy)) {
      if (self?.contains(element)) continue;
      const control = element.closest(CONTROL);
      if (!control || found.has(control) || self?.contains(control)) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width > window.innerWidth * 0.6 || rect.width === 0) continue;
      found.set(control, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
    }
  }
  return [...found.values()];
}

const typing = (element: Element | null) =>
  element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName))
  && !(element instanceof HTMLInputElement && /^(button|checkbox|radio|range|submit|reset|color|file)$/.test(element.type));

/**
 * The floating AI Coach button (phase 15). Small and draggable: it rests against the left or right edge where the
 * member drops it (remembered per phone, tablet and desktop size; on tablets and desktops the left edge is the page's,
 * beside the menu rail or sidebar, so it never sits on a menu item), keeps clear of the bottom bar and of anything
 * marked `data-coach-avoid` and of any button, link or field it would otherwise sit on, and hides on the coach page, onboarding and the focus screens (live workout, AI Form
 * Check camera, activity recorder), while a modal sheet is open, on phones while the keyboard is up, and while FITX Admin
 * has the AI coach switched off (lib/shell/coach-switch.ts). "Hide AI Coach button" hides it for this
 * page load only (back on refresh); Settings turns it off for good. Pressing it opens the coach panel through the
 * fitx:coach-open event, or the AI Coach page when no panel is mounted.
 */
export function CoachLauncher() {
  const pathname = usePathname();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const spot = useRef<LauncherSpot>({ side: "right", y: 1 });
  const hydrated = useHydrated();
  // The account's answer once known (or a change from Settings); until then this device's cached choice. A device
  // with none cached (a first visit) waits for the account, so the button never shows and then vanishes.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const enabled = hydrated ? knownAnswer(chosen, cached(COACH_LAUNCHER_CACHE_KEY)) : null;
  // FITX Admin's AI coach switch: this device's last answer at once, then a fresh read (the same wait on a first visit).
  const [switchedOn, setSwitchedOn] = useState<boolean | null>(null);
  const coachOn = hydrated ? knownAnswer(switchedOn, cached(COACH_SWITCH_CACHE_KEY)) : null;
  const [dismissed, setDismissed] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [dragging, setDragging] = useState(false);
  const [settled, setSettled] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  // The Settings choice: this device's cache at once (no flash), then the account's.
  useEffect(() => {
    let live = true;
    void loadLauncherPref().then(({ on }) => {
      if (live) setChosen(on);
    });
    const onPref = (event: Event) => setChosen((event as CustomEvent<LauncherPrefDetail>).detail.on);
    window.addEventListener(COACH_LAUNCHER_PREF_EVENT, onPref);
    return () => {
      live = false;
      window.removeEventListener(COACH_LAUNCHER_PREF_EVENT, onPref);
    };
  }, []);

  // Re-read on each page change (at most once a minute: loadCoachSwitch keeps the last answer that long).
  useEffect(() => {
    let live = true;
    void loadCoachSwitch().then((on) => {
      if (live) setSwitchedOn(on);
    });
    return () => {
      live = false;
    };
  }, [pathname]);

  // Shown only once both are known to be on: unknown (null, a first visit before the answers) hides it.
  const hidden = enabled !== true || coachOn !== true || dismissed || launcherHiddenOn(pathname) || keyboard;

  const layout = useCallback(() => {
    if (drag.current?.moved) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight, leftInset: menuInset() };
    // Clear of the marked bars first, then of any control the spot would cover, a few times over. None while a
    // modal sheet is open.
    const avoid = obstacles(root.current);
    let next = modalOpen() ? null : placeLauncher(spot.current, viewport, avoid);
    for (let pass = 0; next && pass < 4; pass += 1) {
      const under = controlsUnder(next, root.current);
      if (!under.length) break;
      avoid.push(...under);
      next = placeLauncher(spot.current, viewport, avoid);
    }
    setPlace((before) => (next && before && before.x === next.x && before.y === next.y && before.side === next.side ? before : next));
  }, []);

  // Where it sits: the remembered spot for this screen size, re-checked when the page, the size or the elements
  // it avoids change.
  useLayoutEffect(() => {
    if (hidden) return;
    const kind = () => viewportClass(window.innerWidth);
    let currentKind = kind();
    spot.current = readSpot(storage()?.getItem(LAUNCHER_SPOT_KEY) ?? null, currentKind);
    layout();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const now = kind();
        if (now !== currentKind) {
          currentKind = now;
          spot.current = readSpot(storage()?.getItem(LAUNCHER_SPOT_KEY) ?? null, now);
        }
        layout();
      });
    };
    // While the page scrolls the button holds still; once it stops, the button checks what is under it.
    let scrolling = 0;
    const onScroll = () => {
      window.clearTimeout(scrolling);
      scrolling = window.setTimeout(schedule, 160);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-coach-avoid", "hidden", "open"] });
    // Sticky bars that slide in with CSS change no attribute: a slow check catches them.
    const slow = window.setInterval(schedule, 1200);
    const settle = window.setTimeout(() => setSettled(true), 60);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.clearTimeout(scrolling);
      observer.disconnect();
      window.clearInterval(slow);
      window.clearTimeout(settle);
      if (frame) window.cancelAnimationFrame(frame);
      // Forget the spot: when the button comes back (the keyboard closes, a page without it is left) it is placed
      // for the page as it is then, instead of appearing where it last was and gliding across, over the control
      // that was just pressed, which then lost the release and the click. On a page change the new spot is set
      // in the same commit, so the button does not blink.
      setPlace(null);
    };
  }, [hidden, pathname, layout]);

  // Phones: out of the way while the on-screen keyboard is up (a text field has focus).
  useEffect(() => {
    const update = () => setKeyboard(window.innerWidth < 768 && typing(document.activeElement));
    const later = () => window.setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
    };
  }, []);

  // The panel gives focus back to the button when it closes.
  useEffect(() => {
    const onClose = () => button.current?.focus({ preventScroll: true });
    window.addEventListener(LAUNCHER_CLOSE_EVENT, onClose);
    return () => window.removeEventListener(LAUNCHER_CLOSE_EVENT, onClose);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !place) return;
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, fromX: place.x, fromY: place.y, moved: false };
    // Captured at once, so a quick flick that leaves the button before it counts as a drag still moves it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone.
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      current.moved = true;
      setDragging(true);
    }
    const x = Math.min(window.innerWidth - LAUNCHER_SIZE, Math.max(0, current.fromX + dx));
    const y = Math.min(window.innerHeight - LAUNCHER_SIZE, Math.max(0, current.fromY + dy));
    setPlace({ x, y, side: x + LAUNCHER_SIZE / 2 < window.innerWidth / 2 ? "left" : "right" });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current || current.id !== event.pointerId || !current.moved) return;
    swallowClick.current = true;
    setDragging(false);
    const x = Math.min(window.innerWidth - LAUNCHER_SIZE, Math.max(0, current.fromX + event.clientX - current.startX));
    const y = Math.min(window.innerHeight - LAUNCHER_SIZE, Math.max(0, current.fromY + event.clientY - current.startY));
    const viewport = { width: window.innerWidth, height: window.innerHeight, leftInset: menuInset() };
    spot.current = spotFromDrop(x, y, viewport);
    const store = storage();
    try {
      store?.setItem(LAUNCHER_SPOT_KEY, writeSpot(store.getItem(LAUNCHER_SPOT_KEY), viewportClass(viewport.width), spot.current));
    } catch {
      // Storage blocked: the spot holds for this page load.
    }
    layout();
  }

  function onPointerCancel() {
    if (drag.current?.moved) {
      setDragging(false);
      drag.current = null;
      layout();
    }
    drag.current = null;
  }

  function open() {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    openCoachPanel(window, () => router.push("/ai-coach"));
  }

  if (hidden || !place) return null;
  return (
    <div
      ref={root}
      className={cn(styles.launcher, place.side === "left" && styles.left, settled && !dragging && styles.settling, dragging && styles.dragging)}
      style={{ transform: `translate3d(${place.x}px, ${place.y}px, 0)` }}
      data-coach-launcher=""
    >
      <button
        ref={button}
        type="button"
        aria-label="Open AI Coach"
        title="AI Coach"
        className={cn("fitx-nav-link", styles.button)}
        onClick={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      >
        <span className={styles.ring} aria-hidden="true" />
        <CoachNavIcon size={24} className={styles.icon} />
      </button>
      <button type="button" aria-label="Hide AI Coach button" title="Hide until you reload" className={styles.hide} onClick={() => setDismissed(true)}>
        <X size={12} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}
