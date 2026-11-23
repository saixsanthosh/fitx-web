import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WELCOME_DURATION,
  WELCOME_SCORE_HITS,
  WELCOME_SHOTS,
  WELCOME_STAGE,
  WELCOME_STAGE_START,
  welcomeStageAt,
} from "@/components/brand/intro/films/welcome/timeline";

/** BRIEF-2 3.3's planned stage starts, before C0 snapped them to score #5's measured hits. */
const PLANNED = [0, 1.6, 3.4, 5.0, 6.8, 9.4];
const SNAP_WINDOW = 0.25;

test("the welcome film lasts 12.0 s, with six stages in order", () => {
  assert.equal(WELCOME_DURATION, 12.0);
  assert.equal(WELCOME_STAGE_START.length, 6);
  assert.deepEqual(Object.values(WELCOME_STAGE), [0, 1, 2, 3, 4, 5]);
  assert.equal(WELCOME_STAGE_START[0], 0);
  for (let index = 1; index < WELCOME_STAGE_START.length; index += 1) {
    assert.ok(WELCOME_STAGE_START[index] > WELCOME_STAGE_START[index - 1], `stage ${index} starts after stage ${index - 1}`);
  }
  assert.ok(WELCOME_STAGE_START[WELCOME_STAGE_START.length - 1] < WELCOME_DURATION);
});

test("the stage starts are snapped to score #5's measured hits", () => {
  assert.deepEqual(WELCOME_STAGE_START, [0, 1.4, 3.6, 4.88, 6.91, 9.29]);
  WELCOME_STAGE_START.slice(1).forEach((start, offset) => {
    const planned = PLANNED[offset + 1];
    assert.ok(WELCOME_SCORE_HITS.includes(start), `${start} is a measured hit`);
    assert.ok(Math.abs(start - planned) <= SNAP_WINDOW, `${start} is within ${SNAP_WINDOW} s of the planned ${planned}`);
    const inWindow = WELCOME_SCORE_HITS.filter((hit) => Math.abs(hit - planned) <= SNAP_WINDOW);
    assert.deepEqual(inWindow, [start], `the only hit within ${SNAP_WINDOW} s of ${planned}`);
  });
});

test("the measured hits are in order and inside the score", () => {
  assert.equal(WELCOME_SCORE_HITS.length, 22);
  for (let index = 1; index < WELCOME_SCORE_HITS.length; index += 1) {
    assert.ok(WELCOME_SCORE_HITS[index] > WELCOME_SCORE_HITS[index - 1]);
  }
  assert.ok(WELCOME_SCORE_HITS[0] > 0 && WELCOME_SCORE_HITS[WELCOME_SCORE_HITS.length - 1] < WELCOME_DURATION);
});

test("one shot per stage, in order, covering the film without gaps", () => {
  assert.deepEqual(WELCOME_SHOTS.map(({ id }) => id), ["w0-light", "w1-maya", "w2-leo", "w3-dre", "w4-crane", "w5-ignite"]);
  WELCOME_SHOTS.forEach((shot, index) => {
    assert.equal(shot.stage, index, shot.id);
    assert.equal(shot.start, WELCOME_STAGE_START[index], `${shot.id} starts with its stage`);
    assert.equal(shot.end, index + 1 < WELCOME_SHOTS.length ? WELCOME_SHOTS[index + 1].start : WELCOME_DURATION, `${shot.id} ends where the next begins`);
    assert.ok(shot.end > shot.start, shot.id);
  });
});

test("welcomeStageAt follows the stage starts", () => {
  assert.equal(welcomeStageAt(0), 0);
  assert.equal(welcomeStageAt(1.39), 0);
  assert.equal(welcomeStageAt(1.4), 1);
  assert.equal(welcomeStageAt(4.88), 3);
  assert.equal(welcomeStageAt(9.28), 4);
  assert.equal(welcomeStageAt(9.29), 5);
  assert.equal(welcomeStageAt(WELCOME_DURATION), 5);
});
