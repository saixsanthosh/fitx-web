// The landing page: its media (generated stills and the cuts of FITX's own film), the food example, the copy rules,
// and the claims each card makes, held to the code that ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { LANDING_MEDIA } from "@/data/landing-media";
import { LANDING2_MEDIA } from "@/data/landing-2-media";
import { pieceFoodFrom, portionNutrition } from "@/components/landing/portion";
import { CAPABILITIES, DECK_SECONDS, nextCard, previousCard } from "@/components/landing/capabilities";
import { CHAPTERS, REEL_SECONDS, chapterAt, chapterProgress, reelAllowed, reelSource, shapeFor } from "@/components/landing/film";

const ROOT = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, ROOT), "utf8");
const staples = JSON.parse(read("src/data/fitx-staples.json"));

for (const [set, media] of [["landing", LANDING_MEDIA], ["landing-2", LANDING2_MEDIA]] as const) {
  test(`every ${set} image is a committed, optimised WebP within the brief's caps`, () => {
    const entries = Object.entries(media);
    assert.ok(entries.length > 0 && entries.length <= 12, "at most 12 images");
    let total = 0;
    for (const [id, image] of entries) {
      const file = new URL(`public${image.src}`, ROOT);
      assert.ok(existsSync(file), id);
      assert.match(image.src, new RegExp(`^/media/${set}/[a-z0-9-]+\\.webp$`));
      const bytes = statSync(file).size;
      assert.ok(bytes <= 350 * 1024, `${id} is ${bytes} bytes`);
      total += bytes;
      assert.ok(Math.max(image.width, image.height) <= 2400);
      assert.match(image.blurDataURL, /^data:image\/webp;base64,/);
      assert.ok(image.alt.length > 10, `${id} has alt text`);
    }
    assert.ok(total <= 4 * 1024 * 1024);
    const onDisk = readdirSync(new URL(`public/media/${set}/`, ROOT)).filter((name) => !name.startsWith("."));
    assert.deepEqual(onDisk.sort(), entries.map(([id]) => `${id}.webp`).sort(), "no stray files");
  });
}

test("the film reel and its stills are cut from FITX's own film, light and dark, landscape and portrait, and stay small", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const shape of ["landscape", "portrait"] as const) {
      const reel = new URL(`public${reelSource(theme, shape)}`, ROOT);
      assert.ok(existsSync(reel), `${theme} ${shape} reel`);
      assert.ok(statSync(reel).size < 2 * 1024 * 1024, `${theme} ${shape} reel under 2 MB`);
      assert.ok(existsSync(new URL(`public/media/landing-film/poster-${theme}-${shape}.webp`, ROOT)), `${theme} ${shape} still`);
    }
    assert.ok(existsSync(new URL(`public/media/landing-film/team-${theme}.webp`, ROOT)), `${theme} team still`);
  }
  const css = read("src/components/landing/landing.module.css");
  for (const file of readdirSync(new URL("public/media/landing-film/", ROOT)).filter((name) => name.endsWith(".webp"))) {
    assert.ok(css.includes(`/media/landing-film/${file}`), `${file} is used`);
  }
});

test("the chapters cover the reel end to end, in the film's order, and the rail follows the clock", () => {
  assert.equal(CHAPTERS[0].start, 0);
  assert.equal(CHAPTERS.at(-1)?.end, REEL_SECONDS);
  for (let index = 1; index < CHAPTERS.length; index += 1) assert.equal(CHAPTERS[index].start, CHAPTERS[index - 1].end, "no gaps");
  assert.deepEqual(CHAPTERS.map((chapter) => chapter.id), ["run", "ride", "lift", "fuel", "together"]);
  assert.equal(chapterAt(0), 0);
  assert.equal(chapterAt(4.5), 2);
  assert.equal(chapterAt(REEL_SECONDS + 0.5), 0, "wraps with the loop");
  assert.equal(chapterAt(Number.NaN), 0);
  assert.ok(chapterProgress(2, CHAPTERS[2].start) < 1e-9);
  assert.equal(chapterProgress(2, CHAPTERS[2].end - 1e-9) > 0.99, true);
  assert.equal(chapterProgress(2, 0), 0);
  assert.equal(chapterProgress(9, 1), 0, "an unknown chapter");
  assert.equal(shapeFor(390, 844), "portrait");
  assert.equal(shapeFor(1440, 900), "landscape");
  assert.equal(reelAllowed({ reducedMotion: true, saveData: false }), false);
  assert.equal(reelAllowed({ reducedMotion: false, saveData: true }), false);
  assert.equal(reelAllowed({ reducedMotion: false, saveData: false }), true);
  // The film's own stage times, moved onto the reel (which starts at film time 1.3 s).
  const timeline = read("src/components/brand/intro/timeline.ts");
  assert.match(timeline, /STAGE_START: readonly number\[\] = \[0, 1\.3, 3\.5, 5\.1, 7\.55, 9\.2, 10\.6\]/);
  assert.deepEqual(CHAPTERS.slice(1).map((chapter) => Math.round((chapter.start + 1.3) * 100) / 100), [3.5, 5.1, 7.55, 9.2]);
});

test("the deck: seven cards, wrapping both ways, unhurried", () => {
  assert.equal(CAPABILITIES.length, 7);
  assert.equal(new Set(CAPABILITIES.map((item) => item.id)).size, 7);
  assert.equal(nextCard(6), 0);
  assert.equal(previousCard(0), 6);
  assert.equal(nextCard(2), 3);
  assert.ok(DECK_SECONDS >= 6, "time to read a card");
  for (const item of CAPABILITIES) assert.ok(item.title.length <= 40 && item.line.length <= 90, `${item.id} stays short`);
});

test("the deck holds still for a reader: focus holds it, a mouse over it waits, Pause stops it, only Play restarts it", () => {
  const deck = read("src/components/landing/CapabilityDeck.tsx");
  // Keyboard focus inside the deck (a tab or a card's link) holds it, so a focused link is never hidden by an auto-advance.
  assert.match(deck, /onFocus=\{onFocusIn\}/);
  assert.match(deck, /const onFocusIn = [^;]*\{\s*if \(event\.target !== toggle\.current\) setHeld\(true\);/);
  assert.match(deck, /const auto = !reduced && !held && !paused && !hovered && visible && inView;/);
  assert.match(deck, /onPointerEnter=\{\(event\) => \{\s*if \(event\.pointerType === "mouse"\) setHovered\(true\);/);
  // A visible 44 px Pause / Play control (WCAG 2.2.2); Pause stops the movement too, and only Play clears the hold.
  assert.match(deck, /aria-label=\{paused \? "Play cards" : "Pause cards"\}/);
  assert.match(deck, /const animate = !reduced && !paused && visible && inView;/);
  assert.match(deck, /if \(paused\) setHeld\(false\);/);
  assert.match(read("src/components/landing/landing.module.css"), /\.deckToggle \{[^}]*width: 44px;[^}]*height: 44px;/);
  // The live region speaks only a change the visitor made, never the auto-advance.
  assert.match(deck, /aria-live="polite">\s*\{announced\}/);
  assert.doesNotMatch(deck, /aria-live="polite">\s*\{current\.tab\}/);
});

test("the idli example comes from the built-in food list and scales by the piece", () => {
  const idli = pieceFoodFrom(staples.foods, "2708346", { pieceLabel: "idli", source: "USDA" });
  assert.ok(idli);
  assert.equal(idli.pieceGrams, 38);
  const two = portionNutrition(idli, 2);
  assert.equal(two.grams, 76);
  assert.equal(two.kcal, Math.round(128 * 0.76));
  assert.equal(pieceFoodFrom(staples.foods, "no-such-food", { pieceLabel: "x", source: "x" }), null);
  assert.equal(pieceFoodFrom([{ id: "1", name: "x", calories: 10, protein: null, carbs: 1, fat: 1, portions: [{ unit: "piece", grams: 10 }] }], "1", { pieceLabel: "x", source: "x" }), null, "an unknown macro is not shown as 0");
  assert.match(CAPABILITIES.find((item) => item.id === "fuel")?.line ?? "", /two idli instead of 76 g/, "the line matches the example's numbers");
});

test("the landing copy avoids the banned phrases and invented claims; the moving examples say so", () => {
  const files = ["src/app/(marketing)/page.tsx", ...readdirSync(new URL("src/components/landing/", ROOT)).filter((f) => /\.tsx?$/.test(f)).map((f) => `src/components/landing/${f}`)];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /Welcome to|Unlock|Supercharge|seamless|journey|all-in-one|AI-powered/i, file);
    assert.doesNotMatch(text, /testimonial|\b\d[\d,]*\+? (users|members|downloads)\b|★/i, file);
  }
  const deck = read("src/components/landing/CapabilityDeck.tsx");
  for (const label of ["Example plan in FITX", "Example question to the AI Coach", "Example week in FITX"]) assert.ok(deck.includes(label), label);
  assert.ok((deck.match(/>Example</g) ?? []).length >= 3, "each made-up example carries a visible Example tag");
});

test("each card claims only what the code does", () => {
  const line = (id: string) => CAPABILITIES.find((item) => item.id === id)?.line ?? "";
  assert.match(line("form"), /33 body points/);
  assert.match(read("src/lib/pose/landmarks.ts"), /LANDMARK_COUNT = 33\b/, "33 body points");
  assert.match(line("form"), /never leaves your phone/);
  assert.match(read("src/lib/pose/camera.ts"), /getUserMedia/, "the camera is read in the browser");
  assert.match(line("fuel"), /scan a barcode/);
  assert.ok(existsSync(new URL("src/components/app/BarcodeScanner.tsx", ROOT)), "a barcode scanner exists");
  assert.match(line("move"), /walk, run and ride|GPS/i);
  assert.match(read("src/lib/activity/recorder.ts"), /watchPosition/, "live GPS");
  const sports = read("src/lib/activity/types.ts").match(/export type Sport = ([^;]+);/)?.[1] ?? "";
  for (const sport of ["walk", "run", "ride"]) assert.match(sports, new RegExp(`"${sport}"`), sport);
  assert.equal(CAPABILITIES.find((item) => item.id === "form")?.href, "/workouts/form-check", "Form Check opens AI Form Check itself");
  assert.match(line("explore"), /Photo posts, follows and comments/);
  const social = read("supabase/migrations/20261123100060_fitx_social_v1.sql");
  for (const table of ["social_posts", "social_post_media", "social_follows", "social_comments"]) assert.match(social, new RegExp(`create table if not exists public\\.${table}\\b`), table);
  assert.match(line("explore"), /private account approves each follower/);
  assert.match(social, /is_private/, "private accounts");
  assert.match(social, /'pending'/, "follow requests wait for approval");
  for (const item of CAPABILITIES) {
    const route = item.href.split("?")[0];
    assert.ok(existsSync(new URL(`src/app/(dashboard)${route}/page.tsx`, ROOT)), `${item.id} links to a real page (${route})`);
  }
});

test("the home page: four screens, the visitor intro film still mounted, contact read from the one source", () => {
  const page = read("src/app/(marketing)/page.tsx");
  assert.match(page, /<CinematicIntro \/>/);
  const order = ["<FilmHero", "<CapabilityDeck", "<VisionReel", "<ContactBlock"].map((tag) => page.indexOf(tag));
  assert.ok(order.every((at) => at > 0) && order.every((at, index) => index === 0 || at > order[index - 1]), "film, deck, idea, contact");
  const hero = read("src/components/landing/FilmHero.tsx");
  assert.match(hero, /aria-label=\{paused \? "Play film" : "Pause film"\}/, "the moving film can be paused");
  assert.match(hero, /muted/);
  assert.match(hero, /playsInline/);
});
