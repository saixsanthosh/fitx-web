import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPOSITIONS, pickComposition, type FilmComposition } from "@/components/brand/films/compositions";
import { FILM_TIMING } from "@/components/brand/films/timing";
import { STAGE, STAGE_START } from "@/components/brand/intro/timeline";
import { WELCOME_CLEAR, WELCOME_DURATION, WELCOME_STAGE_START } from "@/components/brand/intro/films/welcome/timeline";
import { igniteClear } from "@/components/brand/intro/films/welcome/shots";
import { findRawColors } from "../../scripts/checks/check-raw-colors.mjs";

// BRIEF-2 3.1, the desktop band: "1.89 and wider; cover up to 2.20, a scope matte (side bars) above". The matte is CSS
// (a container query on the film's stage, so the poster gets it from the first paint); this checks that CSS against
// COMPOSITIONS and works out what it draws.

const source = (file: string) => readFileSync(file, "utf8");
const DESKTOP = COMPOSITIONS.find((band) => band.id === "desktop")!;
const FILES = {
  video: "src/components/brand/films/FilmVideo.module.css",
  intro: "src/components/brand/CinematicIntro.module.css",
  welcome: "src/components/brand/films/WelcomeFilm.module.css",
  graphics: "src/components/brand/IntroFilmOverlay.module.css",
} as const;

/** The body of each `@container (min-aspect-ratio: a / b) { … }` block in a stylesheet, with its ratio. */
function scopeBlocks(css: string): { ratio: [number, number]; body: string }[] {
  const blocks: { ratio: [number, number]; body: string }[] = [];
  for (const match of css.matchAll(/@container \(min-aspect-ratio: (\d+) \/ (\d+)\) \{/g)) {
    let depth = 1;
    let at = match.index + match[0].length;
    while (depth > 0 && at < css.length) {
      if (css[at] === "{") depth += 1;
      else if (css[at] === "}") depth -= 1;
      at += 1;
    }
    blocks.push({ ratio: [Number(match[1]), Number(match[2])], body: css.slice(match.index + match[0].length, at - 1) });
  }
  return blocks;
}

const BLOCKS = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, scopeBlocks(source(file))])) as Record<keyof typeof FILES, ReturnType<typeof scopeBlocks>>;
const [NUM, DEN] = BLOCKS.video[0]?.ratio ?? [0, 1];

/**
 * What the CSS draws on a `width` × `height` stage served `comp`: the picture's box (220cqh wide once the container
 * query matches, the whole stage before) and each side bar, and how much of a cut of `cutAspect` a cover fit crops.
 */
function drawn(width: number, height: number, comp: FilmComposition, cutAspect = DESKTOP.aspect) {
  const matte = comp === "desktop" && width * DEN >= height * NUM;
  const frame = matte ? (height * NUM) / DEN : width;
  const box = frame / height;
  const crop = box >= cutAspect ? { axis: "height", share: 1 - cutAspect / box } : { axis: "width", share: 1 - box / cutAspect };
  return { matte, frame, bar: (width - frame) / 2, crop };
}

test("one rule in four stylesheets: 11 / 5 is desktop's checkMax, the widest aspect its framing is checked at", () => {
  assert.equal(DESKTOP.checkMax, 2.2);
  assert.equal(DESKTOP.max, Infinity, "desktop is the open band: every wider screen is served it");
  for (const [key, blocks] of Object.entries(BLOCKS)) {
    assert.equal(blocks.length, 1, `${key}: one scope-matte block`);
    assert.deepEqual(blocks[0].ratio, [11, 5], key);
  }
  assert.equal(NUM / DEN, DESKTOP.checkMax);
  // The box is 2.2 × the stage's height, centred: 220cqh wide, from 50% − 110cqh.
  assert.deepEqual([Math.round(DESKTOP.checkMax * 100), Math.round(DESKTOP.checkMax * 50)], [220, 110]);
  for (const [key, block] of [["video", BLOCKS.video[0]], ["intro", BLOCKS.intro[0]], ["welcome", BLOCKS.welcome[0]], ["graphics", BLOCKS.graphics[0]]] as const) {
    assert.match(block.body, /left: calc\(50% - 110cqh\);\s*right: auto;\s*width: 220cqh;/, `${key}: the 2.20:1 box`);
    // Only the desktop composition gets it (a film without desktop keeps cover on its fallback composition).
    for (const rule of block.body.match(/[^{}]+\{/g) ?? []) {
      assert.match(rule.trim(), /^:global\(:root\[data-fitx-film-cut="desktop"\]\) \.[a-zA-Z]+(?:,\s*:global\(:root\[data-fitx-film-cut="desktop"\]\) \.[a-zA-Z]+)* \{$/, `${key}: ${rule.trim()}`);
    }
  }
  // Every wider screen is served desktop, so the matte and the band always go together.
  for (const aspect of [2.2, 2.2001, 2.37, 2.44, 3, 3.56]) assert.equal(pickComposition(Math.round(aspect * 1000), 1000), "desktop", String(aspect));
});

test("at exactly 2.20 the desktop cut still covers the screen: no side bars, 9% of its height cropped", () => {
  const at = drawn(2200, 1000, "desktop");
  assert.equal(at.bar, 0, "the query matches at 2.20, but the box is the whole screen");
  assert.equal(at.frame, 2200);
  assert.deepEqual([at.crop.axis, Math.round(at.crop.share * 100) / 100], [DESKTOP.worstCrop.atMax.axis, DESKTOP.worstCrop.atMax.share]);
  const below = drawn(2199, 1000, "desktop");
  assert.deepEqual([below.matte, below.bar, below.frame], [false, 0, 2199], "just below: plain cover");
  assert.ok(below.crop.share < at.crop.share);
});

test("just above 2.20 it shows side bars instead of cropping more: the picture stays 2.20:1", () => {
  for (const [width, height, bar] of [[2201, 1000, 0.5], [2205, 1000, 2.5], [2210, 1000, 5], [2560, 1080, 92], [3440, 1290, 301]] as const) {
    const above = drawn(width, height, "desktop");
    assert.ok(above.matte, `${width}×${height}`);
    assert.ok(Math.abs(above.bar - bar) < 1e-9, `${width}×${height}: ${above.bar} px bars`);
    assert.ok(Math.abs(above.frame / height - 2.2) < 1e-12, "the picture keeps 2.20:1");
    assert.ok(Math.abs(above.crop.share - drawn(2200, 1000, "desktop").crop.share) < 1e-12, "and the crop never grows past 2.20's");
  }
  // A phone held in landscape under its browser's bars (852 × 349) is the common case: about 42 px a side.
  assert.ok(Math.abs(drawn(852, 349, "desktop").bar - 42.1) < 0.05);
  // Not desktop (a film without that composition): cover, as before.
  assert.equal(drawn(2300, 1000, "laptop", 16 / 9).matte, false);
});

test("the stages are size containers, and the posters, the video and the graphics share the box", () => {
  assert.match(source(FILES.intro), /\.intro \{[^}]*container-type: size;[^}]*\}/);
  assert.match(source(FILES.welcome), /\.stage \{[^}]*container-type: size;[^}]*\}/);
  assert.match(BLOCKS.intro[0].body, /:global\(:root\[data-fitx-film-cut="desktop"\]\) \.poster \{/);
  // The vignette stays full screen: cut to the box, its edge would show on the page colour at the end and in the static mark.
  assert.doesNotMatch(BLOCKS.intro[0].body, /\.ambient/);
  assert.match(BLOCKS.welcome[0].body, /\.poster \{/);
  assert.match(BLOCKS.video[0].body, /\.video \{/);
  // The graphics: the 2.39:1 letterbox, the safe margins and the title size measured on the picture as at 2.20:1, and
  // the letterbox bars reaching across the side bars to the screen's edges.
  const graphics = BLOCKS.graphics[0].body;
  assert.match(graphics, /--bar: clamp\(0px, calc\(\(100cqh - 220cqh \/ 2\.39\) \/ 2\), 14cqh\);/);
  assert.match(graphics, /--safe-l: max\(13\.2cqh, calc\(env\(safe-area-inset-left\) \+ 20px\)\);/);
  assert.equal(Math.round(0.06 * 220 * 10) / 10, 13.2, "6vw at 2.20:1");
  assert.match(graphics, /\.letterbox \{\s*left: calc\(110cqh - 50cqw\);\s*right: calc\(110cqh - 50cqw\);/);
  assert.match(graphics, /\.bar \{ background: var\(--fitx-stage\); \}/, "the letterbox in the side bars' dark: one frame, no seam");
  assert.match(graphics, /\.title \{ font-size: min\(clamp\(56px, 24\.2cqh, 168px\), 26cqh\); \}/);
  const uncommented = source(FILES.graphics).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(uncommented, /^\.title \{[^}]*font-size: min\(clamp\(56px, 11vw, 168px\), 26vh\);/m, "11vw at 2.20:1 is 24.2cqh");
  assert.match(source("src/components/brand/films/FilmVideo.tsx"), /<video\s+ref=\{videoRef\}\s+className=\{`\$\{styles\.surface\} \$\{frameStyles\.video\}`\}/);
});

/** A CSS cubic-bezier(x1, y1, x2, y2) timing function at progress x (Newton steps on the curve's x, then its y). */
function cubicBezier([x1, y1, x2, y2]: number[], x: number) {
  const at = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

test("the bars: hidden without the matte, the page colour until the film plays, dark until the film clears to the page", () => {
  const css = source(FILES.video);
  assert.match(css, /^\.matte \{ display: none; \}$/m);
  const bars = BLOCKS.video[0].body;
  assert.match(bars, /\.matte \{[^}]*display: block;[^}]*width: calc\(50% - 110cqh\);[^}]*background: var\(--fitx-bg\);/);
  assert.match(css, /\.matte::after \{[^}]*background: var\(--fitx-stage\);[^}]*opacity: 0;[^}]*transition: opacity 400ms/);
  assert.match(css, /\.frame\[data-film-playing\]:not\(\[data-film-tail\]\) \.matte::after \{ opacity: 1; \}/);
  // From the tail, the bars clear as long and on the curve the film's own clear takes (the frame carries both).
  assert.match(css, /\.frame\[data-film-tail\] \.matte::after \{\s*transition-duration: var\(--film-tail-ms, 400ms\);\s*transition-timing-function: var\(--film-tail-ease, cubic-bezier\(\.22, \.72, \.2, 1\)\);\s*\}/);
  const player = source("src/components/brand/films/FilmVideo.tsx");
  assert.match(player, /<i className=\{`\$\{frameStyles\.matte\} \$\{frameStyles\.matteLeft\}`\} \/>\s*<i className=\{`\$\{frameStyles\.matte\} \$\{frameStyles\.matteRight\}`\} \/>/);
  assert.match(player, /const frameStyle = \{ "--film-tail-ms": `\$\{tail\.ms\}ms`, "--film-tail-ease": tail\.ease \} as CSSProperties;/);
  assert.match(player, /className=\{`\$\{styles\.canvas\} \$\{frameStyles\.frame\}`\} style=\{frameStyle\}/);
  // Dark with the first frame, and back to the page colour from the film's tail, on the video clock (a timer is armed
  // for the tail as for a stage boundary, so it is never early).
  assert.match(player, /started = true;\s*video\.style\.visibility = "";[\s\S]{0,120}frame\?\.setAttribute\("data-film-playing", ""\);/);
  assert.match(player, /if \(!tail && time >= timing\.tail\.at\) \{\s*tail = true;\s*frame\?\.setAttribute\("data-film-tail", ""\);/);
  assert.match(player, /const boundary = !tail && \(stageBoundary === undefined \|\| timing\.tail\.at < stageBoundary\) \? timing\.tail\.at : stageBoundary;/);
  // Theme tokens only, no raw colour anywhere in the matte.
  assert.deepEqual(findRawColors(css, { file: FILES.video, css: true }), [], "the tail adds none");
  for (const [key, file] of Object.entries(FILES)) {
    const blocks = BLOCKS[key as keyof typeof FILES].map((block) => block.body).join("\n");
    assert.deepEqual(findRawColors(blocks, { file, css: true }), [], key);
  }
  assert.deepEqual(findRawColors(css, { file: FILES.video, css: true }), []);
});

test("each film's tail is when its picture really clears to the page: the intro at its end card, the welcome film with its ignite shot", () => {
  // The intro: its frame is the page colour as the brand stage starts (the end card), so the bars go then, briskly.
  assert.equal(FILM_TIMING.intro.tail.at, STAGE_START[STAGE.brand]);
  assert.equal(FILM_TIMING.intro.revealStage, STAGE.brand);
  assert.deepEqual([FILM_TIMING.intro.tail.ms, FILM_TIMING.intro.tail.ease], [400, "cubic-bezier(.22, .72, .2, 1)"]);
  // The welcome film: its reveal stage starts at 9.29 s, but the frame is still the dark forge then; it clears to the
  // page from 9.75 s to 10.89 s (igniteClear). Bars that cleared at 9.29 s would sit near-white beside a dark picture.
  const welcome = FILM_TIMING.welcome.tail;
  assert.equal(WELCOME_STAGE_START[FILM_TIMING.welcome.revealStage], 9.29);
  assert.ok(welcome.at > WELCOME_STAGE_START[FILM_TIMING.welcome.revealStage], "later than the reveal stage");
  assert.deepEqual([welcome.at, welcome.ms], [WELCOME_CLEAR.start, Math.round((WELCOME_CLEAR.end - WELCOME_CLEAR.start) * 1000)]);
  assert.equal(igniteClear(welcome.at - 0.01), 0, "the picture has not begun to clear before the tail");
  assert.ok(igniteClear(welcome.at + 0.05) > 0, "and begins with it");
  assert.equal(igniteClear(welcome.at + welcome.ms / 1000), 1, "it is clear as the bars are");
  // The bars follow the picture's curve: the CSS timing function within 2% of igniteClear all the way.
  const ease = welcome.ease.match(/^cubic-bezier\(([-.\d]+), ([-.\d]+), ([-.\d]+), ([-.\d]+)\)$/)?.slice(1).map(Number);
  assert.ok(ease, welcome.ease);
  for (let step = 0; step <= 40; step += 1) {
    const time = welcome.at + (step / 40) * (welcome.ms / 1000);
    const bars = cubicBezier(ease, step / 40);
    assert.ok(Math.abs(bars - igniteClear(time)) < 0.02, `at ${time.toFixed(3)} s the bars are ${bars.toFixed(3)} of the way, the picture ${igniteClear(time).toFixed(3)}`);
  }
  // Both films' picture is the page colour from the tail on to the end.
  assert.ok(welcome.at + welcome.ms / 1000 < WELCOME_DURATION);
  assert.equal(igniteClear(WELCOME_DURATION), 1);
});
