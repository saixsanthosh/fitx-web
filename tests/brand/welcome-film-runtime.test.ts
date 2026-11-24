import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { bootstrapFilms } from "@/components/brand/films/bootstrap-twin";
import { pickComposition } from "@/components/brand/films/compositions";
import { FILM_MANIFESTS } from "@/components/brand/films/cuts.generated";
import { FIXTURE_MANIFESTS } from "@/components/brand/films/fixture";
import { activeManifests, cutsIn, liteRung } from "@/components/brand/films/manifest";
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

test("no welcome manifest (D1's dormant case, a build without welcome cuts): the film is never rendered, whatever else is true", () => {
  for (const reduced of [false, true]) {
    for (const filmAllowed of [false, true]) assert.equal(welcomeMode({ hasManifest: false, reduced, filmAllowed }), "none");
  }
  const film = source("src/components/brand/films/WelcomeFilm.tsx");
  assert.match(film, /if \(chosen === "none"\) \{\s*endNow\(\);/, "it calls onEnd straight away");
  assert.match(film, /if \(mode === null \|\| mode === "none"\) return null;/, "and renders nothing");
});

test("release 2b: S6's welcome cuts are in the manifest, so a member's page takes the film case (D1 is live)", () => {
  const welcome = FILM_MANIFESTS.welcome;
  assert.ok(welcome, "S6's welcome manifest");
  assert.equal(activeManifests("").welcome, welcome, "a member's page (no fixture cookie) reads it");
  assert.equal(welcomeMode({ hasManifest: welcome !== null, reduced: false, filmAllowed: true }), "film");
  // The head script gets its compositions and posters too, so the account gate and ?intro=welcome claim it.
  assert.deepEqual(bootstrapFilms(FILM_MANIFESTS).welcome, { comps: welcome.comps, posters: welcome.posters });
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
});

test("6.1b registers WelcomeOverlay, which WelcomeFilm draws only in its film case, so only with a welcome manifest", () => {
  // registry.ts imports WelcomeOverlay.tsx, which `node --test` cannot load (JSX), so the wiring is checked in the source.
  const registry = source("src/components/brand/films/registry.ts");
  assert.match(registry, /^import \{ WelcomeOverlay \} from "\.\/welcome\/WelcomeOverlay";$/m);
  assert.match(registry, /^export const WELCOME_FILM_OVERLAY: ComponentType<FilmOverlayProps> \| null = WelcomeOverlay;$/m);

  // The registry's only reader is WelcomeFilm, ...
  const REGISTRY = "src/components/brand/films/registry";
  const resolve = (file: string, specifier: string) =>
    specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(file), specifier) : specifier;
  const readers = (readdirSync("src", { recursive: true }) as string[])
    .map((file) => `src/${file.split(path.sep).join("/")}`)
    .filter((file) => /\.tsx?$/.test(file) && [...source(file).matchAll(/from "([^"]+)"/g)].some(([, specifier]) => resolve(file, specifier) === REGISTRY));
  assert.deepEqual(readers, ["src/components/brand/films/WelcomeFilm.tsx"]);
  // ... which reads its manifest once, returns nothing in the "none" case (no manifest: onEnd at once) and hands the overlay
  // to FilmVideo only in its film case, ...
  const film = source("src/components/brand/films/WelcomeFilm.tsx");
  assert.match(film, /useState<FilmManifest \| null>\(\(\) => \(typeof document === "undefined" \? null : manifestFor\("welcome"\)\)\)/);
  assert.match(film, /const chosen = welcomeMode\(\{ hasManifest: manifest !== null, reduced, filmAllowed: filmAllowed\(\) \}\);\s*if \(chosen === "none"\) \{\s*endNow\(\);\s*return;/);
  assert.equal(film.split("WELCOME_FILM_OVERLAY").length - 1, 2, "imported once, used once");
  const nothing = film.indexOf('if (mode === null || mode === "none") return null;');
  const handed = film.indexOf("overlay={WELCOME_FILM_OVERLAY ?? undefined}");
  assert.ok(nothing > 0 && handed > film.indexOf('if (mode === "still")') && handed > nothing, "only the film case passes the overlay on");
  // ... and FilmVideo draws it only beside its own playing film, which the overlay requires to be the welcome film.
  assert.match(source("src/components/brand/films/FilmVideo.tsx"), /\{Overlay && <Overlay film=\{film\} stage=\{clock\.stage\}/);
  assert.match(source("src/components/brand/films/welcome/WelcomeOverlay.tsx"), /if \(film !== "welcome"\) return null;/);

  // A member's page (no fixture cookie) reads the generated manifests, which hold S6's welcome cuts since release 2b;
  // a build with welcome null would make WelcomeFilm "none" and draw no overlay.
  assert.equal(activeManifests("").welcome, FILM_MANIFESTS.welcome);
  const dormant = { intro: FILM_MANIFESTS.intro, welcome: null };
  for (const reduced of [false, true]) {
    for (const filmAllowed of [false, true]) assert.equal(welcomeMode({ hasManifest: false, reduced, filmAllowed }), "none");
  }
  // Every way into the welcome film asks for its manifest first: the head script's account gate and ?intro=welcome,
  // Replay and the account gate in CinematicIntro, the onboarding sequence and Settings' "Replay welcome film".
  assert.equal(bootstrapFilms(dormant).welcome, null);
  const bootstrap = source("src/components/brand/introBootstrap.ts");
  assert.match(bootstrap, /asked === "welcome"\) return films\.welcome \? "replay" : null;/);
  assert.match(bootstrap, /\(gate === "account" && films\.welcome\) \? "welcome" : "intro"/);
  assert.match(source("src/components/brand/CinematicIntro.tsx"), /if \(manifestFor\("welcome"\)\) return "welcome";\s*return requested === "welcome" \? null : "intro";/);
  assert.match(source("src/components/onboarding/PostOnboardingSequence.tsx"), /hasFilm: POST_ONBOARDING_FILM !== null && manifestFor\("welcome"\) !== null/);
  assert.match(source("src/app/(dashboard)/settings/SettingsAppearance.tsx"), /setWelcomeFilm\(manifestFor\("welcome"\) !== null\);/);
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
  // S6's welcome film: the desktop composition's 1440×720 AVC 30 cut, alone.
  const welcome = FILM_MANIFESTS.welcome!;
  assert.equal(pickComposition(852, 393, welcome.comps), "desktop");
  assert.deepEqual(cutsIn(welcome, "dark", "desktop", lite).map((cut) => [cut.src, cut.width, cut.height, cut.fps]), [
    [`/brand/films/welcome/${welcome.rev}/desktop-dark-avc30.mp4`, 1440, 720, 30],
  ]);
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
