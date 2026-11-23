/**
 * The films' encoded cuts, posters and sound (BRIEF-2 3.1). S6 regenerates this file from encode.mjs and mix.mjs
 * (codec strings read from ffprobe; files under public/brand/films/<film>/<rev8>/). Coordinator only after this seed.
 *
 * SEED (film-runtime, wave 2 round A): `intro` points at today's 16 files in public/brand/intro/, so every member
 * keeps the cuts that play now. `phone` and `tablet-p` take the portrait cuts, the rest the landscape ones. The 60 fps
 * rung lists the HEVC cut first and today's 60 fps H.264 cut second, kept only as the HEVC fallback until S6 (wave 2
 * drops the H.264 60 rung); the light rung is today's 30 fps cut. Sizes and SHA-256 were read from the files.
 * `welcome` is null (D1 dormant), and there is no sound or sting yet.
 */
import type { FilmComposition, FilmTheme } from "./compositions";
import type { FilmAudio, FilmCut, FilmManifests } from "./manifest";

type SeedFile = { bytes: number; sha256: string };
type SeedShape = "portrait" | "landscape";

const SEED_FILES: Record<`${FilmTheme}-${SeedShape}`, { hevc60: SeedFile; avc60: SeedFile; avc30: SeedFile; poster: SeedFile }> = {
  "dark-landscape": {
    hevc60: { bytes: 2800974, sha256: "191a512ed8371e38fdd078e16f68759d0c718b522fb5a51b774d293ea81b1330" },
    avc60: { bytes: 5009881, sha256: "ce62687277c50ad3dfc47d0a75d293f42d4576c616e7f7ef6054811ee3c91c8c" },
    avc30: { bytes: 1121905, sha256: "83e43706da5584fd3c0aaa129345fef804be627e928c0b927cdc1230fc33631c" },
    poster: { bytes: 38114, sha256: "167f6e35d1302143f13b63cc178fd0ef4deaed1f3d6084abde9d989197091507" },
  },
  "dark-portrait": {
    hevc60: { bytes: 3307207, sha256: "83e42b93a2ca2f9eed3278b070f7ffd248d9b971dea69d9d7f47185a3187098f" },
    avc60: { bytes: 5622957, sha256: "7080566e18d3091cab400344c2283cdeb6f8829e76eb2ec85ee332015ef5f3c7" },
    avc30: { bytes: 1230816, sha256: "d99ce746c73765adff2daa290ba127af9a64ea29faa66deaa42b334121b87f63" },
    poster: { bytes: 36070, sha256: "d612c22830dae209f31792ee303d1246600e25d077e512d09136727c6ce0731e" },
  },
  "light-landscape": {
    hevc60: { bytes: 2823180, sha256: "076d57f8ac3b6677203aacd9e443ffe3bfe5c1907c0cd6b9a981818341ade2e8" },
    avc60: { bytes: 5126506, sha256: "6b8b505dc4b02513d176f925ebe80d09bd923c93ed82c3fc96830986b876e8a6" },
    avc30: { bytes: 1143706, sha256: "d55aed543bed33d3913119f581d9b44f3f2c0fa09cedb85582295fc0d9f71850" },
    poster: { bytes: 40498, sha256: "1150858da0087b69e84e0bb1ada38c62bd063d637703cef919e3fd37ec5c692b" },
  },
  "light-portrait": {
    hevc60: { bytes: 3360358, sha256: "67cb20f082b4af78a5d614dc0b47e908f151fe53af494152468a0ff59f3eefa8" },
    avc60: { bytes: 5608938, sha256: "97034d4ab88ba00fa3aefdd9aefe6b27447804b33fcc12c5beb8da45a4fe306e" },
    avc30: { bytes: 1233080, sha256: "ffd0886d7d7dec1579b1589f55e49cccc21bec99add646e6550d7737fde01768" },
    poster: { bytes: 36428, sha256: "2a0978d5b23b356766b225148e09273b68a20950c44be60ef77ae650adfd7688" },
  },
};

const SEED_COMPS: readonly FilmComposition[] = ["phone", "tablet-p", "tablet-l", "laptop", "desktop"];
const SEED_THEMES: readonly FilmTheme[] = ["dark", "light"];
const shapeOf = (comp: FilmComposition): SeedShape => (comp === "phone" || comp === "tablet-p" ? "portrait" : "landscape");

function seedCuts(): FilmCut[] {
  const cuts: FilmCut[] = [];
  for (const comp of SEED_COMPS) {
    for (const theme of SEED_THEMES) {
      const shape = shapeOf(comp);
      const files = SEED_FILES[`${theme}-${shape}`];
      const base = `/brand/intro/fitx-intro-${theme}-${shape}`;
      const [w, h] = shape === "landscape" ? [1920, 1080] : [1080, 1920];
      cuts.push(
        { film: "intro", comp, theme, rung: "hevc60", src: `${base}-60.hevc.mp4`, codecs: "hvc1.1.6.L123.B0", width: w, height: h, fps: 60, ...files.hevc60 },
        { film: "intro", comp, theme, rung: "hevc60", src: `${base}-60.mp4`, codecs: "avc1.64002A", width: w, height: h, fps: 60, ...files.avc60 },
        { film: "intro", comp, theme, rung: "avc30", src: `${base}-30.mp4`, codecs: "avc1.64001E", width: w / 2, height: h / 2, fps: 30, ...files.avc30 },
      );
    }
  }
  return cuts;
}

function seedPosters() {
  const posters: Record<string, string> = {};
  for (const comp of SEED_COMPS) {
    for (const theme of SEED_THEMES) posters[`${comp}-${theme}`] = `/brand/intro/fitx-intro-${theme}-${shapeOf(comp)}.webp`;
  }
  return posters;
}

/** Every committed film file of the seed with its size and hash, for tests/brand/film-manifest.test.ts. */
export const SEED_POSTER_FILES: ReadonlyArray<{ src: string } & SeedFile> = (Object.keys(SEED_FILES) as Array<keyof typeof SEED_FILES>).map((key) => ({
  src: `/brand/intro/fitx-intro-${key}.webp`,
  ...SEED_FILES[key].poster,
}));

export const FILM_MANIFESTS: FilmManifests = {
  intro: {
    rev: "seed-w1",
    // 715 frames at 60 fps.
    duration: 715 / 60,
    comps: SEED_COMPS,
    cuts: seedCuts(),
    posters: seedPosters(),
    audio: null,
  },
  welcome: null,
};

export const RETURN_STING: FilmAudio | null = null;
