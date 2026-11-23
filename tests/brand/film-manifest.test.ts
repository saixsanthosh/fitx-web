import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { COMPOSITIONS, pickComposition } from "@/components/brand/films/compositions";
import { FILM_MANIFESTS, RETURN_STING, SEED_POSTER_FILES } from "@/components/brand/films/cuts.generated";
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

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const publicFile = (src: string) => path.join("public", src);
const MB = 1_000_000;

/**
 * BRIEF-2 section 5, film budgets (A, retuned after gate A). They hold for the S6 outputs under public/brand/films;
 * the seed's files (today's cuts in public/brand/intro, which S6 deletes) are checked for presence, size and hash only.
 */
const BUDGET = { hevc60: 3.4 * MB, avc30: 1.6 * MB, poster: 50_000, mix: 300_000, sting: 40_000, total: 105 * MB };

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

function everyManifest(): Array<[string, FilmManifest]> {
  return Object.entries(FILM_MANIFESTS).filter((entry): entry is [string, FilmManifest] => entry[1] !== null);
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
  for (const poster of SEED_POSTER_FILES) {
    assert.equal(statSync(publicFile(poster.src)).size, poster.bytes, poster.src);
    assert.equal(sha(publicFile(poster.src)), poster.sha256, poster.src);
  }
});

test("each film covers its compositions in both themes, with a 60 fps rung led by HEVC, the light rung and a poster", () => {
  for (const [film, manifest] of everyManifest()) {
    for (const comp of manifest.comps) {
      assert.ok(COMPOSITIONS.some((band) => band.id === comp), `${film}: ${comp} is a composition`);
      for (const theme of ["dark", "light"] as const) {
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

test("the seed keeps today's cuts: portrait for phone and tablet-p, landscape for the rest; no welcome film, no sound", () => {
  const intro = FILM_MANIFESTS.intro!;
  assert.deepEqual(intro.comps, ["phone", "tablet-p", "tablet-l", "laptop", "desktop"]);
  for (const comp of intro.comps) {
    const shape = comp === "phone" || comp === "tablet-p" ? "portrait" : "landscape";
    assert.deepEqual(cutsIn(intro, "dark", comp, false).map((cut) => cut.src), [
      `/brand/intro/fitx-intro-dark-${shape}-60.hevc.mp4`,
      `/brand/intro/fitx-intro-dark-${shape}-60.mp4`,
      `/brand/intro/fitx-intro-dark-${shape}-30.mp4`,
    ]);
    assert.equal(posterIn(intro, "light", comp), `/brand/intro/fitx-intro-light-${shape}.webp`);
  }
  // Exactly the codec strings wave 1 played.
  assert.deepEqual([...new Set(intro.cuts.map((cut) => cut.codecs))], ["hvc1.1.6.L123.B0", "avc1.64002A", "avc1.64001E"]);
  assert.equal(FILM_MANIFESTS.welcome, null, "D1 dormant until S6");
  assert.equal(intro.audio, null);
  assert.equal(RETURN_STING, null);
});

test("budgets hold for every S6 output under public/brand/films (105 MB in all)", () => {
  for (const [, manifest] of everyManifest()) {
    for (const cut of manifest.cuts.filter((entry) => entry.src.startsWith("/brand/films/"))) {
      assert.ok(cut.bytes <= BUDGET[cut.rung], `${cut.src}: ${cut.bytes} bytes, cap ${BUDGET[cut.rung]}`);
    }
    for (const src of Object.values(manifest.posters).filter((entry): entry is string => Boolean(entry?.startsWith("/brand/films/")))) {
      assert.ok(statSync(publicFile(src)).size <= BUDGET.poster, src);
    }
    if (manifest.audio?.src.startsWith("/brand/films/")) assert.ok(manifest.audio.bytes <= BUDGET.mix, manifest.audio.src);
  }
  if (RETURN_STING?.src.startsWith("/brand/films/")) assert.ok(RETURN_STING.bytes <= BUDGET.sting, RETURN_STING.src);
  const total = filesUnder("public/brand/films").reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(total <= BUDGET.total, `public/brand/films is ${total} bytes`);
  // The caps' sum stays under the total (2 films × 10 pairs × one cut of each rung and a poster, plus the sound).
  assert.ok(2 * 10 * (BUDGET.hevc60 + BUDGET.avc30 + BUDGET.poster) + 2 * BUDGET.mix + BUDGET.sting <= BUDGET.total);
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
