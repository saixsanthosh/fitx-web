/**
 * Film compositions: which authored frame a viewport is served, chosen by aspect alone (never by user agent).
 *
 * `COMPOSITIONS` is the single definition (BRIEF-2 3.1). The runtime picker, the head script's ES5 twin, the cut
 * tests, the lab and `verify.mjs` all read this table and nothing else. A band is `[min, max)` over the viewport
 * aspect `innerWidth / innerHeight`, so a viewport exactly on a boundary goes to the wider composition. The
 * boundaries are the log-midpoints of the neighbouring render aspects, rounded to two decimals.
 *
 * `checkMin` and `checkMax` are the real aspects at which framing and crop are checked: the band's own edges, except
 * the open ends (phone is checked from 0.42; desktop is covered up to 2.20, and wider viewports get a scope matte,
 * side bars, instead of more crop). `worstCrop` is the share of the frame a cover fit loses at those two edges.
 *
 * Pure, with no imports. After C0, film-runtime owns this file; any change needs the coordinator's OK.
 * Serialising note: the last band's `max` is `Infinity`, which JSON writes as `null`.
 */

export type FilmId = "intro" | "welcome";

export type FilmTheme = "dark" | "light";

export type FilmComposition = "phone" | "tablet-p" | "tablet-l" | "laptop" | "desktop";

/** What a film's DOM overlay receives on every stage change and tick. */
export type FilmOverlayProps = {
  film: FilmId;
  stage: number;
  time: number;
  held: boolean;
  comp: FilmComposition;
  firstName: string | null;
};

export type CompositionCrop = { axis: "width" | "height"; share: number };

export type CompositionBand = {
  id: FilmComposition;
  /** Render size of the authored frame, in pixels. */
  width: number;
  height: number;
  /** `width / height`. */
  aspect: number;
  /** The band `[min, max)` of viewport aspects served by this composition. */
  min: number;
  max: number;
  /** The real aspects at which framing and crop are checked. */
  checkMin: number;
  checkMax: number;
  /** Cover crop at `checkMin` and at `checkMax`, as a share of the frame's width or height (rounded to 0.01). */
  worstCrop: { atMin: CompositionCrop; atMax: CompositionCrop };
  authored: boolean;
};

export const FILM_CUT_ATTR = "data-fitx-film-cut";

export const FILM_ATTR = "data-fitx-film";

export const COMPOSITIONS: readonly CompositionBand[] = Object.freeze([
  {
    id: "phone", width: 960, height: 1920, aspect: 960 / 1920, min: 0, max: 0.61, checkMin: 0.42, checkMax: 0.61,
    worstCrop: { atMin: { axis: "width", share: 0.16 }, atMax: { axis: "height", share: 0.18 } }, authored: true,
  },
  {
    id: "tablet-p", width: 1200, height: 1600, aspect: 1200 / 1600, min: 0.61, max: 1.0, checkMin: 0.61, checkMax: 1.0,
    worstCrop: { atMin: { axis: "width", share: 0.19 }, atMax: { axis: "height", share: 0.25 } }, authored: true,
  },
  {
    id: "tablet-l", width: 1600, height: 1200, aspect: 1600 / 1200, min: 1.0, max: 1.54, checkMin: 1.0, checkMax: 1.54,
    worstCrop: { atMin: { axis: "width", share: 0.25 }, atMax: { axis: "height", share: 0.13 } }, authored: true,
  },
  {
    id: "laptop", width: 1920, height: 1080, aspect: 1920 / 1080, min: 1.54, max: 1.89, checkMin: 1.54, checkMax: 1.89,
    worstCrop: { atMin: { axis: "width", share: 0.13 }, atMax: { axis: "height", share: 0.06 } }, authored: true,
  },
  {
    id: "desktop", width: 1920, height: 960, aspect: 1920 / 960, min: 1.89, max: Infinity, checkMin: 1.89, checkMax: 2.2,
    worstCrop: { atMin: { axis: "width", share: 0.06 }, atMax: { axis: "height", share: 0.09 } }, authored: true,
  },
]);

/** The aspect used when the size is not a usable number (zero, negative or not finite): 16:9. */
const FALLBACK_ASPECT = 16 / 9;

/** Log-aspect distances closer than this count as a tie (and a tie goes to the wider composition). */
const TIE = 1e-9;

function aspectOf(width: number, height: number): number {
  const valid = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  return valid ? width / height : FALLBACK_ASPECT;
}

function bandFor(aspect: number): CompositionBand {
  for (const band of COMPOSITIONS) {
    if (aspect >= band.min && aspect < band.max) return band;
  }
  return COMPOSITIONS[COMPOSITIONS.length - 1];
}

/**
 * The composition for a viewport of `width` × `height`.
 *
 * Without `available`, the band's composition. With it (a film that lacks a composition), the band's composition when
 * it is available, otherwise the available composition whose render aspect is nearest the viewport's aspect by
 * log-aspect, ties to the wider. An empty `available` serves the band's composition (nothing to choose from).
 */
export function pickComposition(width: number, height: number, available?: readonly FilmComposition[]): FilmComposition {
  const aspect = aspectOf(width, height);
  const band = bandFor(aspect);
  if (!available || available.length === 0 || available.includes(band.id)) return band.id;
  const target = Math.log(aspect);
  let best: CompositionBand | null = null;
  let bestDistance = Infinity;
  for (const candidate of COMPOSITIONS) {
    if (!available.includes(candidate.id)) continue;
    const distance = Math.abs(Math.log(candidate.aspect) - target);
    // The table runs narrow to wide, so a later candidate at the same distance is the wider one.
    if (distance < bestDistance - TIE || (Math.abs(distance - bestDistance) <= TIE && best && candidate.aspect > best.aspect)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ? best.id : band.id;
}
