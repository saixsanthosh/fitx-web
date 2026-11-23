/**
 * The film fixture (BRIEF-2 3.4, "Fixtures"), so the e2e run covers sound and the welcome film before S6 exists.
 *
 * Selected only when the build has `NEXT_PUBLIC_FITX_FILM_FIXTURE=1` (the e2e build; next.config.ts refuses it on a
 * Vercel production build) **and** the page has the cookie `fitx_film_fixture=1` (set by flows 01, 22 and 23 only).
 * Its URLs are under /__fitx-fixture/films/, which nothing in the app serves: the flows fulfil them with `page.route`
 * from tests/e2e/fixtures/films/ (made by make.mjs there): a 2 s 64×64 test pattern in HEVC and H.264, a WebP poster
 * and a 2 s 440 Hz tone. The sizes, hashes and codecs below are that folder's fixtures.json (checked by
 * tests/brand/film-manifest.test.ts). Each file stands in for every composition and theme, under the path shape S6
 * uses, so a flow can tell which one the runtime asked for.
 */
import type { FilmComposition, FilmId, FilmTheme } from "./compositions";
import type { FilmAudio, FilmCut, FilmManifest, FilmManifests } from "./manifest";

export const FIXTURE_COOKIE = "fitx_film_fixture";

/** Where the fixtures are served (by the flows' page.route; nothing in the app serves this path). */
export const FIXTURE_BASE = "/__fitx-fixture/films";

export const FIXTURE_FILES = {
  hevc60: { name: "pattern-hevc60.mp4", bytes: 11105, sha256: "ff167926772fe1c2ecefbcc9b4bce03241206112defcfe9864e18edba16ed411", codecs: "hvc1.1.6.L30.B0" },
  avc30: { name: "pattern-avc30.mp4", bytes: 11182, sha256: "4506240140f6fb17036765dcce037596f9f5956ff9dc19e9217886e9573ddf61", codecs: "avc1.64000A" },
  poster: { name: "poster.webp", bytes: 1150, sha256: "db9cd6ac2f8c5f927347760d773c4f5e38493161dc8ff72e3457188d166cfc03" },
  tone: { name: "tone.m4a", bytes: 17587, sha256: "761429f5542f94ef9554edbf4905a24d8cd8ef97a6ec7963afa69c8855ca77e2" },
} as const;

/** Whether a document.cookie string asks for the fixture (exact name and value). */
export function fixtureRequested(cookies: string): boolean {
  return cookies.split(";").some((part) => part.trim() === `${FIXTURE_COOKIE}=1`);
}

const COMPS: readonly FilmComposition[] = ["phone", "tablet-p", "tablet-l", "laptop", "desktop"];
const THEMES: readonly FilmTheme[] = ["dark", "light"];
const DURATION = 2;

function fixtureAudio(film: FilmId | "return"): FilmAudio {
  const file = film === "return" ? "sting.m4a" : "sound.m4a";
  return { src: `${FIXTURE_BASE}/${film}/${file}`, bytes: FIXTURE_FILES.tone.bytes, sha256: FIXTURE_FILES.tone.sha256, lufs: -16, duration: DURATION };
}

function fixtureManifest(film: FilmId): FilmManifest {
  const cuts: FilmCut[] = [];
  const posters: FilmManifest["posters"] = {};
  for (const comp of COMPS) {
    for (const theme of THEMES) {
      const base = `${FIXTURE_BASE}/${film}/${comp}-${theme}`;
      cuts.push(
        { film, comp, theme, rung: "hevc60", src: `${base}-hevc60.mp4`, codecs: FIXTURE_FILES.hevc60.codecs, width: 64, height: 64, fps: 60, bytes: FIXTURE_FILES.hevc60.bytes, sha256: FIXTURE_FILES.hevc60.sha256 },
        { film, comp, theme, rung: "avc30", src: `${base}-avc30.mp4`, codecs: FIXTURE_FILES.avc30.codecs, width: 64, height: 64, fps: 30, bytes: FIXTURE_FILES.avc30.bytes, sha256: FIXTURE_FILES.avc30.sha256 },
      );
      posters[`${comp}-${theme}`] = `${base}.webp`;
    }
  }
  return { rev: "fixture", duration: DURATION, comps: COMPS, cuts, posters, audio: fixtureAudio(film) };
}

export const FIXTURE_MANIFESTS: FilmManifests = { intro: fixtureManifest("intro"), welcome: fixtureManifest("welcome") };

export const FIXTURE_STING: FilmAudio = fixtureAudio("return");
