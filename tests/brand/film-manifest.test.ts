import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { COMPOSITIONS, pickComposition } from "@/components/brand/films/compositions";
import { FILM_MANIFESTS, FILM_POSTER_FILES, RETURN_STING } from "@/components/brand/films/cuts.generated";
import { FIXTURE_BASE, FIXTURE_FILES, FIXTURE_MANIFESTS, FIXTURE_STING, fixtureRequested } from "@/components/brand/films/fixture";
import {
  activeManifests,
  activeSting,
  cutsIn,
  fixtureActive,
  liteRung,
  posterIn,
  type FilmAudio,
  type FilmManifest,
} from "@/components/brand/films/manifest";
import { FILM_DURATION } from "@/components/brand/intro/timeline";
import { WELCOME_DURATION } from "@/components/brand/intro/films/welcome/timeline";
import { MIX } from "../../scripts/brand/films/audio/lib.mjs";
import { STING_DURATION } from "../../scripts/brand/films/audio/sting.cues.mjs";
import { AVC30_SIZES, BUDGET as ENCODER_BUDGET } from "../../scripts/brand/films/lib/encoders.mjs";

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const publicFile = (src: string) => path.join("public", src);
const MB = 1_000_000;

/**
 * BRIEF-2 section 5, film budgets (A, retuned after gate A), for every file under public/brand/films: S6's cuts,
 * posters, the two films' sound and the returning-reveal sting. Decimal, like encode.mjs's `--budget` (71d75b9).
 */
const BUDGET = { hevc60: 3.4 * MB, avc30: 1.6 * MB, poster: 50_000, mix: 300_000, sting: 40_000, total: 105 * MB };

const COMPS = COMPOSITIONS.map((band) => band.id);
const THEMES = ["dark", "light"] as const;
/** Each film is exactly as long as its timeline: the intro 756 frames, the welcome film 720, at 60 fps. */
const DURATIONS = { intro: FILM_DURATION, welcome: WELCOME_DURATION } as const;

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

function everyManifest(): Array<[string, FilmManifest]> {
  return Object.entries(FILM_MANIFESTS).filter((entry): entry is [string, FilmManifest] => entry[1] !== null);
}

/** Every site path the generated manifests name: each cut, each poster, each film's sound and the sting. */
function namedFiles(): string[] {
  const named = everyManifest().flatMap(([, manifest]) => [
    ...manifest.cuts.map((cut) => cut.src),
    ...Object.values(manifest.posters).filter((src): src is string => Boolean(src)),
    ...(manifest.audio ? [manifest.audio.src] : []),
  ]);
  return RETURN_STING ? [...named, RETURN_STING.src] : named;
}

test("every committed film file the manifest names exists, with the size and SHA-256 it records", () => {
  const audio: FilmAudio[] = [];
  for (const [film, manifest] of everyManifest()) {
    assert.ok(manifest.cuts.length > 0, `${film} has cuts`);
    for (const cut of manifest.cuts) {
      assert.equal(cut.film, film, cut.src);
      const file = publicFile(cut.src);
      assert.ok(existsSync(file), `${cut.src} exists`);
      assert.equal(statSync(file).size, cut.bytes, `${cut.src} size`);
      assert.equal(sha(file), cut.sha256, `${cut.src} hash`);
    }
    for (const src of Object.values(manifest.posters)) assert.ok(src && existsSync(publicFile(src)), `poster ${src} exists`);
    if (manifest.audio) audio.push(manifest.audio);
  }
  if (RETURN_STING) audio.push(RETURN_STING);
  for (const sound of audio) {
    assert.equal(statSync(publicFile(sound.src)).size, sound.bytes, sound.src);
    assert.equal(sha(publicFile(sound.src)), sound.sha256, sound.src);
  }
  for (const poster of FILM_POSTER_FILES) {
    assert.equal(statSync(publicFile(poster.src)).size, poster.bytes, poster.src);
    assert.equal(sha(publicFile(poster.src)), poster.sha256, poster.src);
  }
});

test("each film covers its compositions in both themes, with a 60 fps rung led by HEVC, the light rung and a poster", () => {
  for (const [film, manifest] of everyManifest()) {
    for (const comp of manifest.comps) {
      assert.ok(COMPOSITIONS.some((band) => band.id === comp), `${film}: ${comp} is a composition`);
      for (const theme of THEMES) {
        const full = cutsIn(manifest, theme, comp, false);
        const light = cutsIn(manifest, theme, comp, true);
        assert.ok(full.length >= 2, `${film} ${comp} ${theme}: a full and a light cut`);
        assert.equal(full[0].rung, "hevc60", `${film} ${comp} ${theme}: 60 fps first`);
        assert.match(full[0].codecs, /^hvc1\./, `${film} ${comp} ${theme}: HEVC first`);
        assert.equal(full[full.length - 1].rung, "avc30", "then the light rung");
        assert.deepEqual(light.map((cut) => cut.rung), ["avc30"], "only the light rung when lite");
        assert.match(light[0].codecs, /^avc1\./);
        assert.ok(posterIn(manifest, theme, comp), `${film} ${comp} ${theme}: poster`);
      }
    }
  }
});

test("S6's films: the intro and the welcome film, all five compositions in both themes, HEVC 60 then AVC 30, a poster each, their sound and the sting", () => {
  assert.deepEqual(Object.keys(FILM_MANIFESTS).sort(), ["intro", "welcome"]);
  const posters: string[] = [];
  for (const film of ["intro", "welcome"] as const) {
    const manifest = FILM_MANIFESTS[film];
    assert.ok(manifest, `${film}: S6's cuts (the welcome film is live: D1's flow plays it after sign-up)`);
    assert.match(manifest.rev, /^[0-9a-f]{8}$/, `${film}: the encode's rev8`);
    const base = `/brand/films/${film}/${manifest.rev}`;
    assert.equal(manifest.duration, DURATIONS[film], `${film}: as long as its timeline`);
    assert.deepEqual(manifest.comps, COMPS, `${film}: every composition`);
    assert.equal(manifest.cuts.length, COMPS.length * THEMES.length * 2, `${film}: one cut of each rung per composition and theme, nothing else`);
    for (const band of COMPOSITIONS) {
      const small = AVC30_SIZES[band.id as keyof typeof AVC30_SIZES];
      assert.deepEqual([small.width, small.height], [band.width * 0.75, band.height * 0.75], `${band.id}: the light rung is 0.75× the frame`);
      for (const theme of THEMES) {
        const label = `${film} ${band.id} ${theme}`;
        const cuts = cutsIn(manifest, theme, band.id, false);
        assert.deepEqual(
          cuts.map((cut) => [cut.rung, cut.src, cut.width, cut.height, cut.fps]),
          [
            ["hevc60", `${base}/${band.id}-${theme}-hevc60.mp4`, band.width, band.height, 60],
            ["avc30", `${base}/${band.id}-${theme}-avc30.mp4`, small.width, small.height, 30],
          ],
          `${label}: HEVC 60 at the frame's size, then AVC 30 (no H.264 60 rung any more)`,
        );
        assert.deepEqual(cutsIn(manifest, theme, band.id, true), [cuts[1]], `${label}: lite plays the AVC 30 cut alone`);
        const poster = posterIn(manifest, theme, band.id);
        assert.equal(poster, `${base}/${band.id}-${theme}.webp`, `${label}: its poster`);
        posters.push(poster);
      }
    }
    assert.equal(Object.keys(manifest.posters).length, COMPS.length * THEMES.length, `${film}: no other poster`);
    // The codec strings the files carry (read from each file's hvcC or avcC box): HEVC Main, high tier, level 4.1 by
    // design (BRIEF-2 D12; this Mac's Chromium reports it supported, smooth and power-efficient), and AVC High at
    // level 3.2 or 4.0, as x264 chose for the frame size.
    assert.deepEqual([...new Set(manifest.cuts.filter((cut) => cut.rung === "hevc60").map((cut) => cut.codecs))], ["hvc1.1.6.H123.90"], film);
    assert.deepEqual([...new Set(manifest.cuts.filter((cut) => cut.rung === "avc30").map((cut) => cut.codecs))].sort(), ["avc1.640020", "avc1.640028"], film);
    // The film's own sound, as long as the film, at the mix's loudness (BRIEF-2 3.4: I −16 ± 1 LU).
    const audio = manifest.audio;
    assert.ok(audio, `${film}: its sound`);
    assert.equal(audio.src, `${base}/sound.m4a`);
    assert.equal(audio.duration, manifest.duration, `${film}: the sound is as long as the picture`);
    assert.ok(Math.abs(audio.lufs - MIX.filmLufs) <= MIX.lufsTolerance, `${film}: ${audio.lufs} LUFS`);
  }
  // The returning-reveal sting: its own rev, about 1.2 s, quieter than the films (−20 LUFS).
  assert.ok(RETURN_STING, "the sting");
  assert.match(RETURN_STING.src, /^\/brand\/films\/return\/[0-9a-f]{8}\/sting\.m4a$/);
  assert.equal(RETURN_STING.duration, STING_DURATION);
  assert.ok(Math.abs(RETURN_STING.lufs - MIX.stingLufs) <= MIX.lufsTolerance, `${RETURN_STING.lufs} LUFS`);
  // FILM_POSTER_FILES holds exactly the posters the manifests name, each once.
  assert.deepEqual(FILM_POSTER_FILES.map((file) => file.src).sort(), posters.sort());
});

test("budgets hold for every film file, all under public/brand/films, which holds nothing else (105 MB in all)", () => {
  assert.deepEqual({ hevc60: BUDGET.hevc60, avc30: BUDGET.avc30, poster: BUDGET.poster }, { ...ENCODER_BUDGET }, "the encoder's --budget caps are these");
  for (const src of namedFiles()) assert.match(src, /^\/brand\/films\/(intro|welcome|return)\/[0-9a-f]{8}\/[a-z0-9-]+\.(mp4|webp|m4a)$/, src);
  for (const [, manifest] of everyManifest()) {
    for (const cut of manifest.cuts) assert.ok(cut.bytes <= BUDGET[cut.rung], `${cut.src}: ${cut.bytes} bytes, cap ${BUDGET[cut.rung]}`);
    for (const src of Object.values(manifest.posters).filter((entry): entry is string => Boolean(entry))) {
      assert.ok(statSync(publicFile(src)).size <= BUDGET.poster, src);
    }
    if (manifest.audio) assert.ok(manifest.audio.bytes <= BUDGET.mix, manifest.audio.src);
  }
  if (RETURN_STING) assert.ok(RETURN_STING.bytes <= BUDGET.sting, RETURN_STING.src);
  // No file the manifests do not name (a stale revision, a stray export) ships under public/brand/films.
  const onDisk = filesUnder(path.join("public", "brand", "films")).map((file) => `/${path.relative("public", file).split(path.sep).join("/")}`);
  assert.deepEqual(onDisk.sort(), namedFiles().sort());
  const total = onDisk.reduce((sum, src) => sum + statSync(publicFile(src)).size, 0);
  assert.ok(total <= BUDGET.total, `public/brand/films is ${total} bytes`);
  // The caps' sum stays under the total (2 films × 10 pairs × one cut of each rung and a poster, plus the sound).
  assert.ok(2 * 10 * (BUDGET.hevc60 + BUDGET.avc30 + BUDGET.poster) + 2 * BUDGET.mix + BUDGET.sting <= BUDGET.total);
});

test("each cut and poster is what the manifest says (ffprobe): codec, tag, size, frame rate and every frame", () => {
  // A file path relative to the checkout (its path can hold a space, "all files"). ffprobe is not on every machine:
  // without it this check is skipped and the sizes and hashes above still hold; any other failure fails the test.
  const probe = (src: string, entries: string, extra: string[] = []) => {
    try {
      return JSON.parse(execFileSync("ffprobe", ["-v", "error", ...extra, "-select_streams", "v:0", "-show_entries", entries, "-of", "json", publicFile(src)], { encoding: "utf8" })).streams[0];
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  };
  for (const [film, manifest] of everyManifest()) {
    for (const cut of manifest.cuts) {
      const stream = probe(cut.src, "stream=codec_name,codec_tag_string,width,height,r_frame_rate,nb_read_packets", ["-count_packets"]);
      if (stream === null) return;
      const hevc = cut.codecs.startsWith("hvc1.");
      assert.deepEqual(
        [stream.codec_name, stream.codec_tag_string, stream.width, stream.height, stream.r_frame_rate, Number(stream.nb_read_packets)],
        [hevc ? "hevc" : "h264", hevc ? "hvc1" : "avc1", cut.width, cut.height, `${cut.fps}/1`, Math.round(manifest.duration * cut.fps)],
        `${cut.src}: every frame of the ${film} film at ${cut.fps} fps`,
      );
    }
    for (const band of COMPOSITIONS.filter((entry) => manifest.comps.includes(entry.id))) {
      for (const theme of THEMES) {
        const stream = probe(posterIn(manifest, theme, band.id), "stream=width,height");
        if (stream === null) return;
        assert.deepEqual([stream.width, stream.height], [band.width, band.height], `${film} ${band.id} ${theme}: the poster is the frame's size`);
      }
    }
  }
});

test("the light rung: low-end hardware, or a coarse pointer on a small screen, never the composition alone", () => {
  assert.equal(liteRung({ prefers: true, coarse: false, screenWidth: 1920, screenHeight: 1080 }), true);
  // A phone held in landscape (852×393): the desktop composition, on the light rung.
  assert.equal(pickComposition(852, 393), "desktop");
  assert.equal(liteRung({ prefers: false, coarse: true, screenWidth: 852, screenHeight: 393 }), true);
  assert.equal(liteRung({ prefers: false, coarse: true, screenWidth: 393, screenHeight: 852 }), true);
  assert.equal(liteRung({ prefers: false, coarse: true, screenWidth: 820, screenHeight: 1180 }), false, "a tablet plays the full rung");
  assert.equal(liteRung({ prefers: false, coarse: false, screenWidth: 500, screenHeight: 400 }), false, "a small desktop window is not a phone");
  assert.equal(liteRung({ prefers: false, coarse: true, screenWidth: 0, screenHeight: 0 }), false);
});

test("the fixture: its files are tests/e2e/fixtures/films (under 100 KB, never in public/), only with the build flag and the cookie", () => {
  const dir = "tests/e2e/fixtures/films";
  const index = JSON.parse(readFileSync(path.join(dir, "fixtures.json"), "utf8")) as { total: number; files: Record<string, { bytes: number; sha256: string; codecs?: string }> };
  assert.ok(index.total < 100_000);
  for (const file of Object.values(FIXTURE_FILES)) {
    const disk = path.join(dir, file.name);
    assert.equal(statSync(disk).size, file.bytes, file.name);
    assert.equal(sha(disk), file.sha256, file.name);
    assert.deepEqual(index.files[file.name], { bytes: file.bytes, sha256: file.sha256, ...("codecs" in file ? { codecs: file.codecs } : {}) });
  }
  assert.equal(filesUnder("public").some((file) => file.includes("__fitx-fixture") || file.endsWith("pattern-hevc60.mp4")), false);
  for (const manifest of Object.values(FIXTURE_MANIFESTS)) {
    assert.ok(manifest && manifest.cuts.every((cut) => cut.src.startsWith(`${FIXTURE_BASE}/`)));
    assert.ok(manifest?.audio?.src.startsWith(`${FIXTURE_BASE}/`));
  }
  assert.ok(FIXTURE_STING.src.startsWith(`${FIXTURE_BASE}/`));

  assert.equal(fixtureRequested("a=1; fitx_film_fixture=1"), true);
  assert.equal(fixtureRequested("fitx_film_fixture=0; xfitx_film_fixture=1"), false);
  assert.equal(fixtureActive("fitx_film_fixture=1", "1"), true);
  assert.equal(fixtureActive("fitx_film_fixture=1", undefined), false, "a build without the flag never takes it");
  assert.equal(fixtureActive("", "1"), false, "nor a page without the cookie");
  // Without the build flag: the generated manifests, whatever the cookie says.
  if (process.env.NEXT_PUBLIC_FITX_FILM_FIXTURE !== "1") {
    assert.equal(activeManifests("fitx_film_fixture=1"), FILM_MANIFESTS);
    assert.equal(activeSting("fitx_film_fixture=1"), RETURN_STING);
  }
  assert.equal(activeManifests(""), FILM_MANIFESTS);
});
