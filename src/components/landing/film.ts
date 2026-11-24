/**
 * The landing page's film reel: a cut of FITX's own intro film (the procedural 3D film), from the sprint start to the
 * team walk (film time 1.3 s to 10.6 s), rendered by the film lab (scripts/brand/films, job `landing-reel`) and encoded
 * for the web in public/media/landing-film/ (light and dark, landscape and portrait). Its chapters double as the tour
 * of what FITX does.
 */

export type FilmTheme = "light" | "dark";
export type FilmShape = "landscape" | "portrait";

/** Seconds of the reel (film time 1.3 to 10.6). */
export const REEL_SECONDS = 9.3;

export type Chapter = {
  id: "run" | "ride" | "lift" | "fuel" | "together";
  /** Chapter label on the rail. */
  label: string;
  /** What FITX does for it, in a few words. */
  line: string;
  /** Reel seconds. */
  start: number;
  end: number;
};

/** The film's stages (src/components/brand/intro/timeline.ts STAGE_START) moved onto the reel's clock. */
export const CHAPTERS: readonly Chapter[] = [
  { id: "run", label: "Run", line: "Live GPS route, distance and pace", start: 0, end: 2.2 },
  { id: "ride", label: "Ride", line: "Rides tracked the same way", start: 2.2, end: 3.8 },
  { id: "lift", label: "Lift", line: "Gym plans and AI Form Check", start: 3.8, end: 6.25 },
  { id: "fuel", label: "Fuel", line: "Food by the gram or the piece", start: 6.25, end: 7.9 },
  { id: "together", label: "Progress", line: "Every part of your week in one place", start: 7.9, end: REEL_SECONDS },
];

/** The chapter playing at reel time `seconds` (wrapped into the reel). */
export function chapterAt(seconds: number): number {
  const t = wrap(seconds);
  for (let index = CHAPTERS.length - 1; index >= 0; index -= 1) {
    if (t >= CHAPTERS[index].start) return index;
  }
  return 0;
}

/** 0 to 1 through chapter `index` at reel time `seconds` (0 before it, 1 after it). */
export function chapterProgress(index: number, seconds: number): number {
  const chapter = CHAPTERS[index];
  if (!chapter) return 0;
  const t = wrap(seconds);
  return Math.min(1, Math.max(0, (t - chapter.start) / (chapter.end - chapter.start)));
}

function wrap(seconds: number) {
  if (!Number.isFinite(seconds)) return 0;
  return ((seconds % REEL_SECONDS) + REEL_SECONDS) % REEL_SECONDS;
}

/**
 * The reel file for a theme and a viewport shape (portrait below an aspect of 0.9). Every cut is 30 fps H.264; the
 * portrait one (540 × 960, about 1.35 MB) is the phone cut, the landscape one (1280 × 720, about 1.65 MB) is for wider
 * screens.
 */
export function reelSource(theme: FilmTheme, shape: FilmShape): string {
  return `/media/landing-film/reel-${theme}-${shape}.mp4`;
}

/**
 * The still shown first and kept with reduced motion or Save-Data: the same cut `POSTER_SECONDS` in (film time
 * 2.05 s, the film lab's `landing-reel` job), not its frame 0.
 */
export function posterSource(theme: FilmTheme, shape: FilmShape): string {
  return `/media/landing-film/poster-${theme}-${shape}.webp`;
}

/**
 * Reel seconds of the still: the `landing-reel` job takes both posters at film time 2.05 s, and the reel starts at
 * film time 1.3 s. The reel starts playing here (FilmHero), so its fade-in dissolves the still into the same frame
 * instead of rewinding the sprint to its start; the loop then runs from 0.
 */
export const POSTER_SECONDS = 0.75;

export function shapeFor(width: number, height: number): FilmShape {
  return height > 0 && width / height < 0.9 ? "portrait" : "landscape";
}

/** Whether the reel may play at all: never with reduced motion or Save-Data (the still frame stays). */
export function reelAllowed({ reducedMotion, saveData }: { reducedMotion: boolean; saveData: boolean }): boolean {
  return !reducedMotion && !saveData;
}

/** Longest wait for an idle moment once the page has loaded, in ms. */
export const REEL_IDLE_TIMEOUT_MS = 2500;

type IdleHandle = number;
/** The parts of `window` the reel's start-up gate uses (a stub in tests). */
export type ReelWindow = {
  document: { readyState: string };
  addEventListener(type: "load", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "load", listener: () => void): void;
  setTimeout(handler: () => void, ms: number): IdleHandle;
  clearTimeout(handle: IdleHandle): void;
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => IdleHandle;
  cancelIdleCallback?: (handle: IdleHandle) => void;
};

/**
 * Calls `start` once the page has finished loading (the `load` event, or at once when it already has) and the browser
 * then has an idle moment (or after `timeout` ms, or a short timer where requestIdleCallback is missing, as in Safari).
 * So the poster, the fonts and the first screen's images always come first and the reel never competes with them.
 * Returns a cancel function; after it, `start` is never called.
 */
export function afterLoadAndIdle(win: ReelWindow, start: () => void, timeout = REEL_IDLE_TIMEOUT_MS): () => void {
  let cancelled = false;
  let idle: IdleHandle | null = null;
  let timer: IdleHandle | null = null;
  const run = () => {
    if (!cancelled) {
      cancelled = true;
      start();
    }
  };
  const whenIdle = () => {
    if (cancelled) return;
    if (typeof win.requestIdleCallback === "function") idle = win.requestIdleCallback(run, { timeout });
    else timer = win.setTimeout(run, 200);
  };
  const onLoad = () => whenIdle();
  if (win.document.readyState === "complete") whenIdle();
  else win.addEventListener("load", onLoad, { once: true });
  return () => {
    cancelled = true;
    win.removeEventListener("load", onLoad);
    if (idle !== null) win.cancelIdleCallback?.(idle);
    if (timer !== null) win.clearTimeout(timer);
  };
}
