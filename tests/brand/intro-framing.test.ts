// Framing of every intro shot on every composition (BRIEF-2 3.1, 3.2 and 3.2a), in node: each shot's real `update()`
// poses real rigs (createRig + the motion drivers) on a stand-in stage (./intro-stage.ts), its camera is applied at the
// composition's render aspect, and its `subjects()` are projected. Every `must` subject stays inside the composition's
// protected box (visible at both edges of its band, shrunk by 9% a side) and, unless it says otherwise, clear of the
// overlay's zones on screen at that time (overlay-zones.ts). The lab's verify.mjs --framing runs the same check on the
// GPU renders; this one needs no browser, so a camera edit that pushes a lead subject out fails `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CameraTrack } from "@/components/brand/intro/director/camera";
import { INTRO_FILM } from "@/components/brand/intro/director/intro-def";
import type { ShotFrame } from "@/components/brand/intro/director/shot-types";
import { ACT1_LAB } from "@/components/brand/intro/director/shots/act1-track";
import { ACT2_LAB } from "@/components/brand/intro/director/shots/act2-gym";
import { ACT3_LAB } from "@/components/brand/intro/director/shots/act3-finale";
import { checkShot, contextFor, frameAt, ids, samples } from "./intro-stage";

// ---------------------------------------------------------------------------------- tests

const TRACKS: Record<string, CameraTrack> = {
  ...Object.fromEntries(Object.entries(ACT1_LAB).filter(([key]) => key.endsWith("_TRACK"))),
  ...Object.fromEntries(Object.entries(ACT2_LAB).filter(([key]) => key.endsWith("_TRACK"))),
  ...Object.fromEntries(Object.entries(ACT3_LAB).filter(([key]) => key.endsWith("_TRACK"))),
} as Record<string, CameraTrack>;

test("every intro camera track authors all five compositions", () => {
  assert.equal(Object.keys(TRACKS).length, 12, Object.keys(TRACKS).join(", "));
  for (const [name, track] of Object.entries(TRACKS)) {
    assert.ok(track.compositions, `${name} has compositions`);
    assert.deepEqual(Object.keys(track.compositions).sort(), [...ids].sort(), name);
  }
});

test("every intro shot says what it frames (subjects), and every shot with a cast has a must subject", () => {
  for (const shot of INTRO_FILM.shots) {
    assert.equal(typeof shot.subjects, "function", shot.id);
    const ctx = contextFor("laptop", "dark");
    const time = (shot.start + shot.end) / 2;
    const frame: ShotFrame = { time, local: time - shot.start, duration: shot.end - shot.start, progress: 0.5, aspect: ctx.aspect };
    shot.enter(ctx, frame);
    shot.update(ctx, frame);
    const boxes = shot.subjects!(ctx, frame);
    for (const box of boxes) for (let c = 0; c < 3; c += 1) assert.ok(box.min[c] <= box.max[c] && Number.isFinite(box.min[c]) && Number.isFinite(box.max[c]), `${shot.id} ${box.id}`);
  }
  const withMust = INTRO_FILM.shots.filter((shot) => shot.id !== "5b-rise" && shot.id !== "6-brand" && shot.id !== "3d-drop");
  for (const shot of withMust) {
    const any = samples(shot).some((time) => frameAt(shot, "laptop", time).subjects.some((subject) => subject.must));
    assert.ok(any, `${shot.id} holds a must subject somewhere`);
  }
});

test("the lead subjects stay inside the protected box and clear of the overlay, on every composition", () => {
  const failures: string[] = [];
  for (const shot of INTRO_FILM.shots) checkShot(shot, failures);
  assert.deepEqual(failures, []);
});

test("the tail lands exactly on the page colour by 11.8 s and holds it to 12.6 s", () => {
  const brand = INTRO_FILM.shots[INTRO_FILM.shots.length - 1];
  assert.equal(brand.id, "6-brand");
  assert.equal(brand.end, 12.6);
  for (const theme of ["light", "dark"] as const) {
    const at = (time: number) => frameAt(brand, "laptop", time, theme).view;
    const early = at(10.75).fade!;
    assert.ok(early.amount > 0 && early.amount < 1, `${theme}: the frame is still clearing at 10.75 (${early.amount})`);
    const veil = at(10.89 + 0.01).fade!;
    assert.ok(veil.amount >= ACT3_LAB.BRAND_TAIL.veil - 1e-6 && veil.amount < 1, `${theme}: the light falls off under the veil (${veil.amount})`);
    for (const time of [11.8, 12.2, 12.59]) {
      const fade = at(time).fade!;
      assert.equal(fade.amount, 1, `${theme} at ${time}`);
      assert.equal(fade.color, ACT3_LAB.BRAND_BG[theme], "the page colour");
    }
    // The fall-off never steps back toward the scene.
    let previous = 0;
    for (let time = 10.6; time < 11.8; time += 0.02) {
      const amount = at(time).fade!.amount;
      assert.ok(amount >= previous - 1e-9, `${theme} ${time}`);
      previous = amount;
    }
  }
});
