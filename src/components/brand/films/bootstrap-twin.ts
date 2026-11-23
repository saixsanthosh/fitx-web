import { COMPOSITIONS, type FilmComposition, type FilmId } from "./compositions";
import type { FilmManifest, FilmManifests } from "./manifest";

/**
 * The head script's ES5 twin of `pickComposition` (BRIEF-2 3.1), serialised from the same `COMPOSITIONS` table, so the
 * table stays the single definition. tests/brand/film-cuts.test.ts runs both over the same viewports (the parity
 * test). ES5 only, no backslashes: it is pasted into a template literal and runs before the first paint.
 */

/** `[id, min, max (null = open), render aspect]` per band, narrow to wide. */
export const COMPOSITION_BANDS_ES5 = JSON.stringify(
  COMPOSITIONS.map((band) => [band.id, band.min, Number.isFinite(band.max) ? band.max : null, band.aspect]),
);

/** An ES5 function expression `(width, height, available?) => FilmComposition`, the twin of `pickComposition`. */
export const PICK_COMPOSITION_ES5 = `function (width, height, available) {
  var bands = ${COMPOSITION_BANDS_ES5};
  var ok = typeof width === "number" && typeof height === "number" && isFinite(width) && isFinite(height) && width > 0 && height > 0;
  var aspect = ok ? width / height : 16 / 9;
  var band = bands[bands.length - 1];
  for (var i = 0; i < bands.length; i++) {
    if (aspect >= bands[i][1] && (bands[i][2] === null || aspect < bands[i][2])) { band = bands[i]; break; }
  }
  if (!available || !available.length || available.indexOf(band[0]) !== -1) return band[0];
  var target = Math.log(aspect);
  var best = null;
  var bestDistance = Infinity;
  for (var j = 0; j < bands.length; j++) {
    if (available.indexOf(bands[j][0]) === -1) continue;
    var distance = Math.abs(Math.log(bands[j][3]) - target);
    if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) <= 1e-9 && best && bands[j][3] > best[3])) {
      best = bands[j];
      bestDistance = distance;
    }
  }
  return best ? best[0] : band[0];
}`;

/** What the head script needs of a film: its compositions and posters (never the cuts). */
export type BootstrapFilm = { comps: readonly FilmComposition[]; posters: FilmManifest["posters"] };

export function bootstrapFilms(manifests: FilmManifests): Record<FilmId, BootstrapFilm | null> {
  const pick = (manifest: FilmManifest | null): BootstrapFilm | null => (manifest ? { comps: manifest.comps, posters: manifest.posters } : null);
  return { intro: pick(manifests.intro), welcome: pick(manifests.welcome) };
}
