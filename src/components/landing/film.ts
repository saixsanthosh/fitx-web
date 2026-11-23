/**
 * The landing page's film reel: a cut of FITX's own intro film (public/brand/intro, the procedural 3D film), from the
 * sprint start to the team walk (film time 1.3 s to 10.6 s), re-encoded for the web in public/media/landing-film/
 * (light and dark, landscape and portrait). Its chapters double as the tour of what FITX does.
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

/** The reel file for a theme and a viewport shape (portrait below an aspect of 0.9). */
export function reelSource(theme: FilmTheme, shape: FilmShape): string {
  return `/media/landing-film/reel-${theme}-${shape}.mp4`;
}

export function shapeFor(width: number, height: number): FilmShape {
  return height > 0 && width / height < 0.9 ? "portrait" : "landscape";
}

/** Whether the reel may play at all: never with reduced motion or Save-Data (the still frame stays). */
export function reelAllowed({ reducedMotion, saveData }: { reducedMotion: boolean; saveData: boolean }): boolean {
  return !reducedMotion && !saveData;
}
