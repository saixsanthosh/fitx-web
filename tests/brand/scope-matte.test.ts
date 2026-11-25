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
    // Only the desktop composition gets it (a film without desktop keeps cover on its fallback composition); the intro's
    // vignette only while the side bars are dark (FilmVideo's frame playing, before its tail).
    const target = String.raw`:global\(:root\[data-fitx-film-cut="desktop"\]\) (?:\[data-film-playing\]:not\(\[data-film-tail\]\) ~ )?\.[a-zA-Z]+`;
    for (const rule of block.body.match(/[^{}]+\{/g) ?? []) {
      assert.match(rule.trim(), new RegExp(`^${target}(?:,\\s*${target})* \\{$`), `${key}: ${rule.trim()}`);
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
  assert.match(BLOCKS.intro[0].body, /:global\(:root\[data-fitx-film-cut="desktop"\]\) \.poster,/);
  // The vignette keeps to the picture only while the side bars are the stage dark: full screen it would lift them (the
  // light theme's edge is the page colour) beside the letterbox, which sits above it in the same dark. Before the first
  // frame and from the tail it is full screen: cut to the box, its edge would show on the page colour at the end and in
  // the static mark.
  const ambient = BLOCKS.intro[0].body.match(/[^{},]*\.ambient[^{},]*/g)?.map((selector) => selector.trim());
  assert.deepEqual(ambient, [':global(:root[data-fitx-film-cut="desktop"]) [data-film-playing]:not([data-film-tail]) ~ .ambient']);
  // That state is FilmVideo's frame, which CinematicIntro renders before the vignette, in the same parent (the section).
  const intro = source("src/components/brand/CinematicIntro.tsx");
  assert.ok(intro.indexOf("<FitxIntroVideo") > 0 && intro.indexOf("<FitxIntroVideo") < intro.indexOf("<div className={styles.ambient}"), "the frame comes first");
  assert.match(source("src/components/brand/FitxIntroVideo.tsx"), /return \(\s*<FilmVideo/);
  assert.match(source("src/components/brand/films/FilmVideo.tsx"), /return \(\s*<>\s*<div ref=\{frameRef\}/, "the frame is FilmVideo's first element, no wrapper");
  assert.match(source(FILES.intro), /^\.ambient \{[^}]*inset: 0;/m, "full screen otherwise");
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

test("the letterbox leaves nothing on the screen's edges: its bars slide a whole 2 px past their own height", () => {
  // --bar is fractional on most wide screens (39.75 px at 2400 × 1000, 13.87 px at 852 × 349, 71.8 px at 1920 × 947); a
  // will-change layer moved by exactly -100% kept its last device-pixel row on the top and bottom rows of the screen.
  const css = source(FILES.graphics);
  const frames = Object.fromEntries([...css.matchAll(/@keyframes (bar-(?:top|bottom)-(?:in|out)) \{ ([^\n]*) \}\n/g)].map((match) => [match[1], match[2]]));
  assert.deepEqual(Object.keys(frames).sort(), ["bar-bottom-in", "bar-bottom-out", "bar-top-in", "bar-top-out"]);
  assert.equal(frames["bar-top-in"], "from { transform: translate3d(0, calc(-100% - 2px), 0); } to { transform: none; }");
  assert.equal(frames["bar-bottom-in"], "from { transform: translate3d(0, calc(100% + 2px), 0); } to { transform: none; }");
  assert.equal(frames["bar-top-out"], "from { transform: none; } to { transform: translate3d(0, calc(-100% - 2px), 0); }");
  assert.equal(frames["bar-bottom-out"], "from { transform: none; } to { transform: translate3d(0, calc(100% + 2px), 0); }");
  assert.doesNotMatch(css, /translate3d\(0, -?100%, 0\)/, "no bar is moved by exactly its height");
  // The out animations hold their last frame (fill both), so the bars stay off screen to the end.
  assert.match(css, /\.barsOut \.barTop \{ animation: bar-top-out [^;]* both; \}/);
  assert.match(css, /\.barsOut \.barBottom \{ animation: bar-bottom-out [^;]* both; \}/);
});

/** A rule body's declarations by property, comments already stripped: `{ position: "absolute", left: "0", … }`. */
function declarations(body: string): Record<string, string> {
  const lines = body.split(";").map((line) => line.trim()).filter(Boolean);
  return Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(":")).trim(), line.slice(line.indexOf(":") + 1).trim()]));
}

/** A CSS function's arguments, split at its own commas only (not at those of a call inside it). */
function cssArgs(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at += 1) {
    if (list[at] === "(") depth += 1;
    else if (list[at] === ")") depth -= 1;
    else if (list[at] === "," && depth === 0) {
      parts.push(list.slice(start, at).trim());
      start = at + 1;
    }
  }
  return [...parts, list.slice(start).trim()];
}

/**
 * A CSS length in px: `0`, px, a unit `per100` gives (what 100 of it measures), an env() value `env` gives, calc() of
 * those added and taken away, or min() or max() of any of them. Any other form throws (a product in calc(), an env()
 * with no value given, another unit or function), so a rule written another way fails until this reads it, instead of
 * passing unread.
 */
function cssLength(value: string | undefined, per100: Readonly<Record<string, number>>, env: Readonly<Record<string, number>> = {}): number {
  const call = value?.match(/^(min|max|calc|env)\((.*)\)$/);
  if (call && (call[1] === "min" || call[1] === "max")) return Math[call[1]](...cssArgs(call[2]).map((part) => cssLength(part, per100, env)));
  if (call && call[1] === "env") {
    if (!(call[2] in env)) throw new Error(`an env() this test does not read: ${value}`);
    return env[call[2]];
  }
  if (call && call[1] === "calc") {
    // Terms added or taken away: CSS needs a space either side of + and -, so " + " and " - " outside any call split it.
    const sum = call[2];
    let total = 0;
    let sign = 1;
    let depth = 0;
    let start = 0;
    for (let at = 0; at <= sum.length; at += 1) {
      if (sum[at] === "(") depth += 1;
      else if (sum[at] === ")") depth -= 1;
      else if (at === sum.length || (depth === 0 && (sum.startsWith(" + ", at) || sum.startsWith(" - ", at)))) {
        total += sign * cssLength(sum.slice(start, at).trim(), per100, env);
        sign = sum[at + 1] === "-" ? -1 : 1;
        start = at + 3;
        at += 2;
      }
    }
    return total;
  }
  if (value === "0") return 0;
  const length = value?.match(/^(-?\d*\.?\d+)([a-z%]+)$/);
  if (length?.[2] === "px") return Number(length[1]);
  if (!length || !(length[2] in per100)) throw new Error(`a length this test does not read: ${value}`);
  return (Number(length[1]) / 100) * per100[length[2]];
}

test("the title scrim keeps to the picture: measured on the graphics' box, the width it had wherever there is no matte", () => {
  const css = source(FILES.graphics).replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (name: string) => css.match(new RegExp(String.raw`^\.${name} \{([^}]*)\}`, "m"))?.[1] ?? "";
  // Its containing block is the graphics' box: .film > .titleBlock > .scrimExit > .titleScrim, each filling the one above.
  assert.match(rule("film"), /position: absolute;\s*inset: 0;/);
  assert.match(rule("titleBlock"), /position: absolute;[^]*inset: 0;/);
  assert.match(rule("scrimExit"), /position: absolute;\s*inset: 0;/);
  const body = rule("titleScrim");
  const scrim = declarations(body);
  assert.deepEqual([scrim.position, scrim.bottom], ["absolute", "var(--bar)"], "on the bottom bar; across, its left and width place it");
  assert.doesNotMatch(BLOCKS.graphics[0].body, /titleScrim/, "so the matte needs no rule of its own for it");
  const overlay = source("src/components/brand/IntroFilmOverlay.tsx");
  assert.match(overlay, /<div ref=\{rootRef\} className=\{styles\.film\}/);
  assert.match(overlay, /className=\{styles\.titleBlock\}[\s\S]{0,700}<span className=\{styles\.scrimExit\}>\s*<span className=\{styles\.titleScrim\} \/>\s*<\/span>/);
  // Without the matte the graphics' box is the stage: fixed to the viewport, and the root does not scroll while the intro
  // plays, so no scrollbar takes width from it and 100% of it is 100vw.
  assert.match(source(FILES.intro), /^\.intro \{[^}]*position: fixed;[^}]*inset: 0;/m);
  assert.match(source(FILES.intro), /:global\(:root\[data-fitx-intro="pending"\]\),\s*:global\(:root\[data-fitx-intro="active"\]\) \{ overflow: hidden; \}/);
  // Where it lies on a W × H screen (px from the screen's left), worked out from the stylesheet's own left and width:
  // % is of the graphics' box (drawn's frame), vw and cqw of the screen, which the stage fills, vh and cqh of its height.
  // The rule it replaced goes through the same working.
  const span = (width: number, height: number, declared: Record<string, string>) => {
    const { frame, bar } = drawn(width, height, pickComposition(width, height));
    const per100 = { "%": frame, vw: width, cqw: width, vh: height, cqh: height };
    const left = bar + cssLength(declared.left, per100);
    return { box: [bar, bar + frame], at: [left, left + cssLength(declared.width, per100)] };
  };
  const before = { left: "0", width: "min(100vw, 1500px)" };
  const inside = ({ box, at }: ReturnType<typeof span>) => at[0] >= box[0] - 1e-9 && at[1] <= box[1] + 1e-9;
  const tenths = ([a, b]: number[]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10];
  const screens = [[852, 349], [2201, 1000], [2400, 1000], [2560, 1080], [3440, 1290], [2200, 1000], [1920, 947], [1440, 900], [1280, 720], [1180, 820], [820, 1180], [390, 844]] as const;
  for (const [width, height] of screens) {
    const now = span(width, height, scrim);
    assert.ok(inside(now), `${width}×${height}: the scrim (${tenths(now.at).join(" to ")} px) ends inside the picture (${tenths(now.box).join(" to ")} px)`);
    if (now.box[0] === 0) assert.deepEqual(now.at, span(width, height, before).at, `${width}×${height}: no side bars, the scrim is as wide as before`);
  }
  // A phone held in landscape (852 × 349, the films check of 2b): the old rule reached 894.1 px, past the box's edge at
  // 809.9, so the same working fails it; the rule now ends on that edge.
  const phone = { now: span(852, 349, scrim), before: span(852, 349, before) };
  assert.deepEqual([tenths(phone.now.box), tenths(phone.before.at), tenths(phone.now.at)], [[42.1, 809.9], [42.1, 894.1], [42.1, 809.9]]);
  assert.equal(inside(phone.before), false, "the old rule fails the check above");
  assert.doesNotMatch(body, /vw/, "nothing in it is measured on the screen");
});

test("the controls keep to the picture: on a wider screen the top line sits where it sits on the picture at 2.20:1", () => {
  // Sound and Skip share one top line on each film's stage (CinematicIntro's .intro, WelcomeFilm's .stage). The stage is
  // fixed over the whole screen and the top line is absolute in it, so its right is measured from the screen's edge.
  const strip = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(strip(FILES.intro), /^\.intro \{[^}]*position: fixed;[^}]*inset: 0;/m);
  assert.match(strip(FILES.welcome), /^\.stage \{[^}]*position: fixed;[^}]*inset: 0;/m);
  assert.match(strip(FILES.intro), /^\.topline,\s*\.staticBrand \{\s*position: absolute;/m);
  assert.match(strip(FILES.welcome), /^\.topline \{\s*position: absolute;/m);
  // The rule that places each top line on its stage, and the one the matte puts over it on the desktop composition.
  const placed = (key: "intro" | "welcome") => {
    const own = [...strip(FILES[key]).matchAll(/^\.topline \{([^}]*)\}/gm)].map((match) => declarations(match[1])).filter((rule) => "right" in rule);
    const matte = BLOCKS[key][0].body.match(/^\s*:global\(:root\[data-fitx-film-cut="desktop"\]\) \.topline \{([^}]*)\}/m)?.[1];
    assert.equal(own.length, 1, `${key}: one rule places the top line on the stage`);
    assert.ok(matte, `${key}: the matte places it too`);
    return { own: own[0].right, matte: declarations(matte) };
  };
  const intro = placed("intro");
  const welcome = placed("welcome");
  // Where there is no matte it is where it was: 4vw from the screen's edge, never nearer than the safe area allows (the
  // matte's rule is only in the container query, for the desktop composition: the first test holds its selector).
  assert.equal(intro.own, "max(4vw, calc(24px + env(safe-area-inset-right)))");
  // The matte moves it across and nothing else, and the welcome film's top line is where the intro's is: the intro's
  // says "Skip welcome film" until that film starts with its own top line, so the two must not differ.
  assert.deepEqual(Object.keys(intro.matte), ["right"]);
  assert.deepEqual([welcome.own, welcome.matte], [intro.own, intro.matte]);

  // Where the top line ends on a W × H screen with a safe area of `inset` px on the right, in px from the screen's left.
  // The matte's rule applies once its query matches on the desktop composition (from 2.20:1, where the bars are still
  // 0 wide); its selector outranks the stage's own rule and the narrow screens' rule in @media. vw and cqw are the
  // screen's width (the stage fills it), cqh its height.
  const at = (width: number, height: number, inset: number, rule?: string) => {
    const comp = pickComposition(width, height);
    const query = comp === "desktop" && width * DEN >= height * NUM;
    const right = cssLength(rule ?? (query ? intro.matte.right : intro.own), { vw: width, cqw: width, cqh: height }, { "safe-area-inset-right": inset });
    const { frame, bar } = drawn(width, height, comp);
    return { end: width - right, right, edge: bar + frame, frame, query };
  };
  const tenth = (n: number) => Math.round(n * 10) / 10;
  // What the films check of 2c measured with the stage's rule alone (its phone is emulated, so env() is 0 there): Skip
  // ended at 817.9 px on a phone held in landscape, past the picture's edge at 809.9, and at 2304 px at 2400 × 1000,
  // past 2300. The same working gives both numbers, and it ran into the side bar from 2.392:1, where the bar is wider
  // than 4vw.
  const before = (width: number, height: number) => at(width, height, 0, intro.own);
  assert.deepEqual([tenth(before(852, 349).end), tenth(before(852, 349).edge)], [817.9, 809.9]);
  assert.deepEqual([tenth(before(2400, 1000).end), tenth(before(2400, 1000).edge)], [2304, 2300]);
  assert.equal(Array.from({ length: 400 }, (_, step) => 2200 + step).find((width) => before(width, 1000).end > before(width, 1000).edge), 2392);
  // Now it ends 4% of the picture's width inside the picture's edge, as at 2.20:1: at 779.2 and 2212 px.
  assert.deepEqual([tenth(at(852, 349, 0).end), tenth(at(2400, 1000, 0).end)], [779.2, 2212]);
  // At exactly 2.20:1 (the query matches, the bars are 0) both rules give the same place, so nothing jumps where the
  // bars begin: 88 px from the edge at 2200 × 1000, which is 4vw.
  for (const inset of [0, 47, 59]) assert.ok(Math.abs(at(2200, 1000, inset).right - at(2200, 1000, inset, intro.own).right) < 1e-9, String(inset));
  assert.equal(tenth(at(2200, 1000, 0).right), 88);

  // On every screen, with no safe area and with a phone's in landscape (47 or 59 px): the top line ends at least 4% of
  // the picture's width inside the picture, and never nearer the screen's edge than the safe area allows; under the
  // matte exactly 4% wherever the safe area asks for less, as at 2.20:1.
  const screens = [[852, 349], [915, 360], [2201, 1000], [2400, 1000], [2560, 1080], [2560, 950], [3440, 1290], [3840, 1100], [2200, 1000], [1920, 947], [1440, 900], [1280, 720], [1180, 820], [820, 1180]] as const;
  for (const inset of [0, 47, 59]) {
    for (const [width, height] of screens) {
      const now = at(width, height, inset);
      const label = `${width}×${height}, safe area ${inset} px: the top line ends at ${tenth(now.end)}, the picture at ${tenth(now.edge)}`;
      assert.ok(now.edge - now.end >= 0.04 * now.frame - 1e-6, `${label}: at least 4% of the picture inside its edge`);
      assert.ok(now.right >= 24 + inset - 1e-9, `${label}: clear of the safe area`);
      if (now.query && width - now.edge + 0.04 * now.frame >= 24 + inset) {
        assert.ok(Math.abs(now.edge - now.end - 0.04 * now.frame) < 1e-6, `${label}: 4% of the picture inside its edge, as at 2.20:1`);
      }
    }
  }
  // And on any wider screen, the bars growing from 0 px: always inside the picture, never in a side bar.
  for (const height of [349, 360, 720, 1000, 1440]) {
    for (let step = 0; step <= 140; step += 1) {
      const width = Math.round((2.2 + step / 100) * height);
      const now = at(width, height, 0);
      assert.ok(now.edge - now.end >= 0.04 * now.frame - 1e-6, `${width}×${height}: ends at ${tenth(now.end)}, the picture at ${tenth(now.edge)}`);
    }
  }
});
