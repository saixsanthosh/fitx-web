import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickComposition } from "@/components/brand/films/compositions";
import { FILM_MANIFESTS } from "@/components/brand/films/cuts.generated";
import { FIXTURE_MANIFESTS } from "@/components/brand/films/fixture";
import { cutsIn, liteRung } from "@/components/brand/films/manifest";
import { WELCOME_FILM_OVERLAY } from "@/components/brand/films/registry";
import { FILM_TIMING } from "@/components/brand/films/timing";
import {
  filmSeenRecently,
  markFilmSeen,
  REPORT_RETRY_MS,
  reportIntroComplete,
  WELCOME_EXIT_MS,
  WELCOME_STILL_MS,
  welcomeLine,
  welcomeMode,
} from "@/components/brand/films/welcome-runtime";
import { FILM_SEEN_KEY } from "@/components/brand/introKeys";
import { WELCOME_STAGE_START } from "@/components/brand/intro/films/welcome/timeline";

const source = (file: string) => readFileSync(file, "utf8");
const DAY = 24 * 60 * 60 * 1000;

test("no welcome manifest: the film is never rendered (D1 dormant), whatever else is true", () => {
  for (const reduced of [false, true]) {
    for (const filmAllowed of [false, true]) assert.equal(welcomeMode({ hasManifest: false, reduced, filmAllowed }), "none");
  }
  assert.equal(FILM_MANIFESTS.welcome, null, "and today there is none");
  const film = source("src/components/brand/films/WelcomeFilm.tsx");
  assert.match(film, /if \(chosen === "none"\) \{\s*endNow\(\);/, "it calls onEnd straight away");
  assert.match(film, /if \(mode === null \|\| mode === "none"\) return null;/, "and renders nothing");
});

test("reduced motion: the still mark and 'Welcome, <first name>' for 2.0 s, then onEnd", () => {
  assert.equal(welcomeMode({ hasManifest: true, reduced: true, filmAllowed: true }), "still");
  assert.equal(welcomeMode({ hasManifest: true, reduced: true, filmAllowed: false }), "still");
  assert.equal(WELCOME_STILL_MS, 2000);
  assert.equal(welcomeLine("Asha"), "Welcome, Asha");
  assert.equal(welcomeLine("  "), "Welcome to FITX", "no name: no made-up one");
  assert.equal(welcomeLine(null), "Welcome to FITX");
  const film = source("src/components/brand/films/WelcomeFilm.tsx");
  assert.match(film, /window\.setTimeout\(endNow, WELCOME_STILL_MS\)/);
  assert.match(film, /\{welcomeLine\(firstName\)\}/);
});

test("Save-Data or 2G, or a video that cannot play: LogoReveal 'welcome' alone, whose Skip is the only one", () => {
  assert.equal(welcomeMode({ hasManifest: true, reduced: false, filmAllowed: false }), "reveal");
  assert.equal(welcomeMode({ hasManifest: true, reduced: false, filmAllowed: true, unsupported: true }), "reveal");
  assert.equal(welcomeMode({ hasManifest: true, reduced: false, filmAllowed: true }), "film");
  const film = source("src/components/brand/films/WelcomeFilm.tsx");
  const reveal = film.slice(film.indexOf('if (mode === "reveal")'), film.indexOf('if (mode === "still")'));
  assert.match(reveal, /<LogoReveal variant="welcome" onDone=\{endNow\} \/>/);
  assert.equal(/<button/.test(reveal), false, "no Skip of its own beside LogoReveal's");
});

test("exactly one Skip control while the film plays: WelcomeFilm's own, since film-end has none", () => {
  const film = source("src/components/brand/films/WelcomeFilm.tsx");
  const playing = film.slice(film.indexOf("const revealing = "));
  assert.equal((playing.match(/<button/g) ?? []).length, 1);
  assert.match(playing, />\s*<span>Skip welcome film<\/span>/);
  assert.match(playing, /<LogoReveal variant="film-end" \/>/);
  assert.match(playing, /<SoundControl sound=\{sound\} \/>/, "Sound sits beside Skip");
  // LogoReveal's film-end variant hides its Skip (frozen file, checked here).
  assert.match(source("src/components/brand/logo/LogoReveal.module.css"), /\.filmEnd \.skip \{ display: none; \}/);
  // Inside the intro overlay (the account gate, Replay), the overlay's own Skip makes way for WelcomeFilm's.
  const intro = source("src/components/brand/CinematicIntro.tsx");
  assert.match(intro, /\{!welcome && \(\s*<div className=\{styles\.topline\}>/);
  assert.match(intro, /<WelcomeFilm onEnd=\{finish\} firstName=\{memberName\} record=\{false\}/);
});

test("the film ends on the reveal at the last stage, fades its stage out over 300 ms, then onEnd", () => {
  assert.equal(FILM_TIMING.welcome.revealStage, WELCOME_STAGE_START.length - 1);
  assert.equal(WELCOME_STAGE_START[FILM_TIMING.welcome.revealStage], 9.29);
  assert.equal(WELCOME_EXIT_MS, 300);
  assert.match(source("src/components/brand/films/WelcomeFilm.tsx"), /exitTimer\.current = window\.setTimeout\(endNow, WELCOME_EXIT_MS\)/);
  assert.equal(WELCOME_FILM_OVERLAY, null, "the integrator sets WelcomeOverlay in 6.1b");
});

test("when it starts: the seen flag (ISO time), and the completion call with keepalive, retried once after 2 s", async () => {
  const stored = new Map<string, string>();
  const now = new Date("2026-11-24T10:00:00.000Z");
  assert.equal(markFilmSeen({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) }, now), true);
  assert.equal(stored.get(FILM_SEEN_KEY), "2026-11-24T10:00:00.000Z");
  assert.equal(markFilmSeen({ getItem: () => null, setItem: () => { throw new Error("blocked"); } }), false, "blocked storage never throws");

  const calls: Array<{ input: string; init: RequestInit }> = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const ok = await reportIntroComplete({ fetcher: async (input, init) => (calls.push({ input, init }), { ok: true }), setTimer: (fn, ms) => timers.push({ fn, ms }) });
  assert.equal(ok, true);
  assert.deepEqual(calls.map(({ input, init }) => [input, init.method, init.keepalive, init.credentials]), [["/api/intro/complete", "POST", true, "same-origin"]]);
  assert.equal(timers.length, 0, "no retry after a success");
});

test("the POST fails twice: the film still plays to the end, and the flag stops the account gate replaying it", async () => {
  let calls = 0;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const result = reportIntroComplete({
    fetcher: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { ok: false };
    },
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timers.map(({ ms }) => ms), [REPORT_RETRY_MS]);
  assert.equal(REPORT_RETRY_MS, 2000);
  timers[0].fn();
  assert.equal(await result, false);
  assert.equal(calls, 2, "tried twice, no more");
  // Nothing in WelcomeFilm waits on the call: it is fired and forgotten, so playback never depends on it.
  assert.match(source("src/components/brand/films/WelcomeFilm.tsx"), /void reportIntroComplete\(/);
  // The flag: within 7 days the account gate skips the film (introBootstrap.ts; tests/unit/intro-bootstrap.test.ts).
  const at = Date.parse("2026-11-24T10:00:00.000Z");
  assert.equal(filmSeenRecently("2026-11-24T10:00:00.000Z", at + 6 * DAY), true);
  assert.equal(filmSeenRecently("2026-11-24T10:00:00.000Z", at + 7 * DAY), false);
  assert.equal(filmSeenRecently("2026-11-24T10:00:00.000Z", at - 1000), false, "a time in the future does not count");
  assert.equal(filmSeenRecently("not a time", at), false);
  assert.equal(filmSeenRecently(null, at), false);
});

test("a phone in landscape (852×393): the desktop composition on the avc30 rung", () => {
  const comp = pickComposition(852, 393, FIXTURE_MANIFESTS.welcome!.comps);
  assert.equal(comp, "desktop");
  const lite = liteRung({ prefers: false, coarse: true, screenWidth: 852, screenHeight: 393 });
  assert.equal(lite, true);
  const cuts = cutsIn(FIXTURE_MANIFESTS.welcome, "dark", comp, lite);
  assert.deepEqual(cuts.map((cut) => [cut.comp, cut.rung]), [["desktop", "avc30"]]);
  assert.match(source("src/components/brand/films/FilmVideo.tsx"), /chooseCut\(manifest, filmTheme, comp, isLite\(\)\)/, "the player asks the same rule");
});

test("the onboarding sequence plays WelcomeFilm, with the member's first name, only while its cuts exist", () => {
  const slot = source("src/components/onboarding/post-onboarding-film.ts");
  assert.match(slot, /POST_ONBOARDING_FILM: ComponentType<\{ onEnd: \(\) => void; firstName\?: string \| null \}> \| null = WelcomeFilm;/);
  const sequence = source("src/components/onboarding/PostOnboardingSequence.tsx");
  assert.match(sequence, /hasFilm: POST_ONBOARDING_FILM !== null && manifestFor\("welcome"\) !== null/);
  assert.match(sequence, /<Film onEnd=\{next\} firstName=\{firstName\} \/>/);
  const flow = source("src/app/(auth)/onboarding/OnboardingFlow.tsx");
  assert.match(flow, /<PostOnboardingSequence onDone=\{\(\) => window\.location\.assign\("\/dashboard"\)\} firstName=\{form \? firstName\(form\.name\) : null\} \/>/);
});
