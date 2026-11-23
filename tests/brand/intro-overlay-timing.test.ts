// The intro overlay's pure timing (introOverlayTiming.ts) against the film's timeline (BRIEF-2 3.3): the 12.6 s
// film with its 2.0 s brand tail, the end card each cut gets, and every title, callout and matte inside the film.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALLOUTS, FILM_DURATION, LETTERBOX, SHOTS, STAGE, STAGE_START, TITLES } from "@/components/brand/intro/timeline";
import {
  BRAND,
  FILM_END_REVEAL,
  beginningInStage,
  calloutTiming,
  endCardFor,
  letterboxTiming,
  liveDuringStage,
  stageRestTime,
  stageStart,
  titleTiming,
} from "@/components/brand/introOverlayTiming";
import { revealPlan } from "@/components/brand/logo/reveal-plan";

test("the film is 12.6 s: the brand stage starts at 10.6 and lasts 2.0 s, and the stage times are unchanged", () => {
  assert.equal(FILM_DURATION, 12.6);
  assert.deepEqual([...STAGE_START], [0, 1.3, 3.5, 5.1, 7.55, 9.2, 10.6]);
  const brand = SHOTS[SHOTS.length - 1];
  assert.equal(brand.id, "6-brand");
  assert.equal(brand.start, STAGE_START[STAGE.brand]);
  assert.ok(Math.abs(brand.end - brand.start - 2.0) < 1e-9);
  for (let index = 1; index < SHOTS.length; index += 1) assert.equal(SHOTS[index].start, SHOTS[index - 1].end, SHOTS[index].id);
  assert.equal(SHOTS[0].start, 0);
});

test("the film-end reveal fits the tail: it runs 1.8 s from 10.6 and holds to the end", () => {
  assert.equal(FILM_END_REVEAL, revealPlan("film-end").totalMs / 1000);
  assert.equal(FILM_END_REVEAL, 1.8);
  assert.equal(revealPlan("film-end").exits, false, "it holds instead of fading");
  assert.equal(BRAND.at, 10.6);
  assert.ok(BRAND.at + FILM_END_REVEAL <= FILM_DURATION);
});

test("each cut gets the end card its length allows", () => {
  assert.equal(endCardFor(12.6), "film-end");
  assert.equal(endCardFor(756 / 60), "film-end");
  assert.equal(endCardFor(BRAND.at + FILM_END_REVEAL), "film-end", "exactly long enough");
  // The cuts encoded before wave 2 (715 frames at 60 fps) and the 2 s e2e fixture keep the short card.
  assert.equal(endCardFor(715 / 60), "short");
  assert.equal(endCardFor(2), "short");
  // No usable length (the live film, a stand-in): the film's own.
  assert.equal(endCardFor(null), "film-end");
  assert.equal(endCardFor(undefined), "film-end");
  assert.equal(endCardFor(Number.NaN), "film-end");
  assert.equal(endCardFor(0), "film-end");
});

test("the end card source: film-end uses LogoReveal, the short card keeps its backdrop, mark and tagline", () => {
  const tsx = readFileSync("src/components/brand/IntroFilmOverlay.tsx", "utf8");
  assert.match(tsx, /<LogoReveal variant="film-end"/);
  assert.match(tsx, /endCardFor\(playingDuration\(\)\)/);
  assert.match(tsx, /data-film-brand="short"/);
  assert.match(tsx, /data-film-brand="film-end"/);
  const css = readFileSync("src/components/brand/IntroFilmOverlay.module.css", "utf8");
  assert.match(css, /\.brandCard \.filmEndReveal \{[^}]*z-index: 5;/, "kept under the Skip pill (z-index 6)");
});

test("titles and callouts end inside the film and before the brand stage; exits end on their end time", () => {
  for (const item of [...TITLES, ...CALLOUTS]) {
    assert.ok(item.start >= 0 && item.end <= STAGE_START[STAGE.brand] + 1e-9, `${"text" in item ? item.text : item.id}`);
  }
  for (const title of TITLES) {
    const timing = titleTiming(title);
    assert.ok(Math.abs(timing.exitAt + timing.exit - (title.end - title.start)) < 1e-9, title.text);
    assert.ok(timing.rest < timing.exitAt);
  }
  for (const callout of CALLOUTS) {
    const timing = calloutTiming(callout);
    assert.ok(Math.abs(timing.exitAt + timing.exit - (callout.end - callout.start)) < 1e-9, callout.id);
    assert.ok(timing.countAt + timing.count <= timing.exitAt + 1e-9, `${callout.id}: the count lands before the exit`);
  }
});

test("the matte comes in with the film and leaves with the brand stage", () => {
  const timing = letterboxTiming();
  assert.equal(timing.inAt, LETTERBOX.inStart);
  assert.equal(timing.outAt, STAGE_START[STAGE.brand]);
  assert.equal(timing.outStage, STAGE.brand);
  assert.ok(timing.outAt + timing.out < FILM_DURATION);
});

test("stage helpers: items live during a stage, the ones that begin in it, rest times inside the film", () => {
  assert.deepEqual(liveDuringStage(TITLES, STAGE.run).map((title) => title.text), ["TRAIN"]);
  assert.deepEqual(beginningInStage(CALLOUTS, STAGE.refuel).map((callout) => callout.id), ["macros"]);
  assert.equal(stageStart(99), STAGE_START[STAGE.brand]);
  for (let stage = 0; stage <= STAGE.brand; stage += 1) assert.ok(stageRestTime(stage) < FILM_DURATION, `stage ${stage}`);
});
