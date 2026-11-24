import type { FilmComposition, FilmId, FilmTheme } from "./compositions";
import { FILM_MANIFESTS, RETURN_STING } from "@/components/brand/films/cuts.generated";
import { FIXTURE_MANIFESTS, FIXTURE_STING, fixtureRequested } from "./fixture";

/**
 * The encoded films (BRIEF-2 3.1): which cut a browser plays for a film, a theme and a composition, and its poster.
 * The data is `cuts.generated.ts`, which S6 writes from encode.mjs and mix.mjs (its files are under
 * public/brand/films/<film>/<rev8>/). Pure apart from `activeManifests()`, which reads the page's cookies.
 */

/** "hevc60": the full-size 60 fps rung (HEVC first). "avc30": the light rung, 30 fps H.264 at 0.75× the size. */
export type FilmRung = "hevc60" | "avc30";

export type FilmCut = {
  film: FilmId;
  comp: FilmComposition;
  theme: FilmTheme;
  rung: FilmRung;
  /** Site path of the file. */
  src: string;
  /** The RFC 6381 codecs value, e.g. `hvc1.1.6.L123.B0`. */
  codecs: string;
  width: number;
  height: number;
  fps: number;
  bytes: number;
  sha256: string;
};

export type FilmAudio = { src: string; bytes: number; sha256: string; lufs: number; duration: number };

export type FilmPosterKey = `${FilmComposition}-${FilmTheme}`;

export type FilmManifest = {
  rev: string;
  /** Seconds. */
  duration: number;
  /** The compositions this film has cuts for (pickComposition's `available`). */
  comps: readonly FilmComposition[];
  cuts: readonly FilmCut[];
  posters: Partial<Record<FilmPosterKey, string>>;
  audio: FilmAudio | null;
};

export type FilmManifests = Record<FilmId, FilmManifest | null>;

/** The MIME type a `<video>` or `canPlayType` takes for a cut. */
export function cutType(cut: Pick<FilmCut, "codecs">): string {
  return `video/mp4; codecs="${cut.codecs}"`;
}

/** Average bitrate of a cut in bits a second (for Media Capabilities). */
export function cutBitrate(cut: Pick<FilmCut, "bytes">, duration: number): number {
  return duration > 0 ? Math.round((cut.bytes * 8) / duration) : 0;
}

/**
 * The cuts of one manifest for a theme and composition, best first: the 60 fps rung (in manifest order, HEVC first),
 * then the light 30 fps rung. Only the light rung when `lite`.
 */
export function cutsIn(manifest: FilmManifest | null, theme: FilmTheme, comp: FilmComposition, lite: boolean): FilmCut[] {
  if (!manifest) return [];
  const mine = manifest.cuts.filter((cut) => cut.theme === theme && cut.comp === comp);
  const light = mine.filter((cut) => cut.rung === "avc30");
  return lite ? light : [...mine.filter((cut) => cut.rung === "hevc60"), ...light];
}

/** The poster (frame 0) of one manifest for a theme and composition; "" when it has none. */
export function posterIn(manifest: FilmManifest | null, theme: FilmTheme, comp: FilmComposition): string {
  return manifest?.posters[`${comp}-${theme}`] ?? "";
}

/** Whether a document.cookie string carries the fixture cookie (only honoured in a fixture build). */
export function fixtureActive(cookies: string, buildFlag: string | undefined = process.env.NEXT_PUBLIC_FITX_FILM_FIXTURE): boolean {
  return buildFlag === "1" && fixtureRequested(cookies);
}

function pageCookies(): string {
  try {
    return typeof document === "undefined" ? "" : document.cookie;
  } catch {
    return "";
  }
}

/**
 * The manifests this page plays: the fixture's (e2e only: a fixture build and the `fitx_film_fixture=1` cookie),
 * otherwise the generated ones.
 */
export function activeManifests(cookies: string = pageCookies()): FilmManifests {
  return fixtureActive(cookies) ? FIXTURE_MANIFESTS : FILM_MANIFESTS;
}

/** The returning-reveal sting this page may play (S6's, or the fixture's in an e2e page; null in a build without one). */
export function activeSting(cookies: string = pageCookies()) {
  return fixtureActive(cookies) ? FIXTURE_STING : RETURN_STING;
}

export function manifestFor(film: FilmId, cookies?: string): FilmManifest | null {
  return activeManifests(cookies)[film];
}

/** BRIEF-2 3.1: the cuts for a film, theme and composition, HEVC 60 first, then AVC 30 (only AVC 30 when `lite`). */
export function cutsFor(film: FilmId, theme: FilmTheme, comp: FilmComposition, lite: boolean): FilmCut[] {
  return cutsIn(manifestFor(film), theme, comp, lite);
}

/** BRIEF-2 3.1: the poster for a film, theme and composition. */
export function posterFor(film: FilmId, theme: FilmTheme, comp: FilmComposition): string {
  return posterIn(manifestFor(film), theme, comp);
}

type NavigatorHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
};

/**
 * Low-end hardware: start on the light cut (unchanged from wave 1). Bandwidth is measured while the chosen cut buffers
 * (FilmVideo's `bufferAhead`) rather than taken from the browser's guesses.
 */
export function prefersLite(nav: NavigatorHints = navigator as NavigatorHints): boolean {
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 3) return true;
  const android = /Android/i.test(nav.userAgent);
  return android && typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4;
}

/**
 * The light rung: `prefersLite()`, or a coarse pointer on a small screen (a phone, whatever way up it is held), so a
 * phone in landscape takes the desktop composition on the light rung. Never derived from the composition alone.
 */
export function liteRung({
  prefers,
  coarse,
  screenWidth,
  screenHeight,
}: { prefers: boolean; coarse: boolean; screenWidth: number; screenHeight: number }): boolean {
  if (prefers) return true;
  const small = Math.min(screenWidth, screenHeight);
  return coarse && Number.isFinite(small) && small > 0 && small < 600;
}

/** `liteRung` for this browser. */
export function isLite(): boolean {
  let coarse = false;
  try {
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }
  return liteRung({ prefers: prefersLite(), coarse, screenWidth: window.screen?.width ?? 0, screenHeight: window.screen?.height ?? 0 });
}

/**
 * Whether to play a film at all. The video plays smoothly on any device (low-end phones get the light cut), so only an
 * explicit "save data" request or a 2G connection skips it (unchanged from wave 1).
 */
export function filmAllowed(nav: NavigatorHints = navigator as NavigatorHints): boolean {
  const connection = nav.connection;
  if (connection?.saveData === true) return false;
  return !(connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g");
}
