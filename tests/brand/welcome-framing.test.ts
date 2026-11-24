// Framing of the welcome film ("The Forge") in node (BRIEF-2 3.2): each shot's real `update()` poses the real rigs and
// props on the stand-in stage the intro's framing test uses (./intro-stage.ts), played as the director plays it (a
// shot's `enter` on each change, `update` every frame), its camera is applied at each composition's render aspect, and
// its `subjects()` are projected and checked with verify.mjs's own functions (scripts/brand/films/lib/framing.mjs), at
// every frame of the film (the lab's verify.mjs --framing checks every 6th frame and each cut ± 1 on the GPU renders).
//
// The subjects are the essential parts each shot is about (the plate being loaded, the loader's face and the hands on
// the plate, the sleeve in the opening macro, the mark at the end), computed from the rigs and the props. Whole bodies
// and the parts a composition crops on purpose (a plate's rim, the sleeve's tip, the athletes round the mark) are
// listed but never `must`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { COMPOSITIONS, type FilmComposition } from "@/components/brand/films/compositions";
import { CAST_ORDER } from "@/components/brand/intro/character/cast";
import type { CharacterInstance } from "@/components/brand/intro/character/assemble";
import { BARBELL } from "@/components/brand/intro/dimensions";
import { applyCameraState, createCameraState, evaluateCameraTrack, type CameraTrack } from "@/components/brand/intro/director/camera";
import type { FilmContext, ShotFrame, ShotModule, SubjectBox } from "@/components/brand/intro/director/shot-types";
import { hideStage, type Stage } from "@/components/brand/intro/director/stage-kit";
import { headBox, landmarkWorld, PALM_HALF_WIDTH } from "@/components/brand/intro/director/subject-boxes";
import { WELCOME_FILM } from "@/components/brand/intro/films/welcome/def";
import { gripAt, LOADS } from "@/components/brand/intro/films/welcome/load-motion";
import { MARK_FLOOR_BOUNDS } from "@/components/brand/intro/films/welcome/mark-floor";
import { BAR_CENTRE, FLOOR_Y, INLAY_TOP, PLATE_SEATS, plateWorld, SLEEVE_LENGTH, sleeveZ, welcomePlates, WELCOME_PLATES } from "@/components/brand/intro/films/welcome/props";
import { dreAction, FIRST_SEAT_OUT, HUB_HALF, WELCOME_LAB } from "@/components/brand/intro/films/welcome/shots";
import { pointOf } from "@/components/brand/intro/rig/skeleton";
import { boxFromNdc, framingFailures, intersect, servedEdges, visibleRegion } from "../../scripts/brand/films/lib/framing.mjs";
import { contextFor } from "./intro-stage";

type Box = { x0: number; y0: number; x1: number; y1: number };
type Projected = SubjectBox & { box: Box | null };
type Played = { index: number; shot: ShotModule; frame: ShotFrame; ctx: FilmContext; subjects: Projected[] };

const COMPS = COMPOSITIONS.map((band) => band.id);
const FRAMES = Array.from({ length: Math.round(WELCOME_FILM.duration * 60) }, (_, index) => index);
const LOADING = [
  { shot: "w1-maya", loader: "maya", index: 0 },
  { shot: "w2-leo", loader: "leo", index: 1 },
  { shot: "w3-dre", loader: "dre", index: 2 },
] as const;

const noop = () => undefined;
const corner = new THREE.Vector3();

function project(subject: SubjectBox, camera: THREE.Camera): Box | null {
  const ndc: [number, number, number][] = [];
  for (const x of [subject.min[0], subject.max[0]]) for (const y of [subject.min[1], subject.max[1]]) for (const z of [subject.min[2], subject.max[2]]) {
    corner.set(x, y, z).project(camera);
    ndc.push([corner.x, corner.y, corner.z]);
  }
  return boxFromNdc(ndc);
}

function shotAt(time: number): ShotModule {
  let shot = WELCOME_FILM.shots[0];
  for (const candidate of WELCOME_FILM.shots) if (time >= candidate.start) shot = candidate;
  return shot;
}

/** Plays the film on `comp` as the director does at `frames` (ascending), handing each frame's projected subjects to `visit`. */
function play(comp: FilmComposition, frames: readonly number[], visit: (played: Played) => void) {
  const ctx = contextFor(comp, "dark");
  for (const burst of [...ctx.fx.grit, ctx.fx.chalk, ...ctx.fx.dust]) Object.assign(burst, { reset: noop });
  Object.assign(ctx.props.rings, { setProgress: noop, setOpacity: noop });
  let active: ShotModule | null = null;
  for (const index of frames) {
    const time = Math.min(WELCOME_FILM.duration, index / 60);
    const shot = shotAt(time);
    const frame: ShotFrame = { time, local: time - shot.start, duration: shot.end - shot.start, progress: Math.min(1, Math.max(0, (time - shot.start) / (shot.end - shot.start))), aspect: ctx.aspect };
    if (shot !== active) {
      hideStage(ctx as unknown as Stage, ctx.cast);
      ctx.sets[shot.set].group.visible = true;
      shot.enter(ctx, frame);
      active = shot;
    }
    const view = shot.update(ctx, frame);
    applyCameraState(ctx.camera, view.camera, ctx.aspect);
    ctx.camera.updateProjectionMatrix();
    ctx.camera.updateMatrixWorld(true);
    const subjects = (shot.subjects?.(ctx, frame) ?? []).map((subject) => ({ ...subject, box: project(subject, ctx.camera) }));
    visit({ index, shot, frame, ctx, subjects });
  }
}

const loaderAction = (shot: string, local: number) => (shot === "w3-dre" ? dreAction(local) : local);
const within = (point: THREE.Vector3, subject: SubjectBox, eps = 1e-9) => [0, 1, 2].every((c) => point.getComponent(c) >= subject.min[c] - eps && point.getComponent(c) <= subject.max[c] + eps);
const byId = (subjects: readonly SubjectBox[], id: string) => {
  const found = subjects.find((subject) => subject.id === id);
  assert.ok(found, `subject ${id} is listed`);
  return found;
};

// ------------------------------------------------------------------------------------------------- what is must, and when

test("the loading shots: the plate being loaded until the palms leave it, the face and hands while the palms are on it", () => {
  for (const { shot: id, loader, index } of LOADING) {
    const spec = LOADS[loader];
    const plate = `plate-${index + 1}`;
    const counts = { hub: 0, face: 0, hands: 0 };
    play("laptop", FRAMES, ({ shot, frame, subjects }) => {
      if (shot.id !== id) return;
      const action = loaderAction(id, frame.local);
      const onPlate = gripAt(spec, action) > 0.5;
      const where = `${id} at ${frame.time.toFixed(3)} s (action ${action.toFixed(3)})`;
      assert.equal(byId(subjects, `${plate}-hub`).must, action < spec.handsOn || onPlate, `${where}: the hub of the plate being loaded`);
      assert.equal(byId(subjects, `${loader}-face`).must, onPlate, `${where}: the face while the palms are on the plate`);
      assert.equal(byId(subjects, "hands").must, onPlate, `${where}: the hands while they are on the plate`);
      assert.equal(byId(subjects, plate).must, false, `${where}: the whole plate (its rim may leave a close frame)`);
      assert.equal(byId(subjects, loader).must, false, `${where}: the whole body`);
      if (action >= spec.seat && action < spec.release) {
        for (const must of [`${plate}-hub`, `${loader}-face`, "hands"]) assert.equal(byId(subjects, must).must, true, `${where}: ${must} at the seat`);
      }
      counts.hub += Number(byId(subjects, `${plate}-hub`).must);
      counts.face += Number(byId(subjects, `${loader}-face`).must);
      counts.hands += Number(byId(subjects, "hands").must);
    });
    // The palms are on the plate for most of each shot (the clip's handsOn to release).
    assert.ok(counts.face > 40 && counts.hands > 40 && counts.hub > counts.face, `${id}: ${JSON.stringify(counts)}`);
  }
});

test("the opening macro keeps the sleeve's inner end, the ignite shot the mark; the crane and the bodies are never must", () => {
  const seen = new Set<string>();
  play("laptop", FRAMES.filter((index) => index % 6 === 0), ({ shot, subjects }) => {
    seen.add(shot.id);
    if (shot.id === "w0-light") {
      assert.equal(byId(subjects, "sleeve").must, true);
      assert.equal(byId(subjects, "sleeve-tip").must, false, "the tip runs past the frame's edge in the macro");
    }
    if (shot.id === "w4-crane") assert.ok(subjects.every((subject) => !subject.must), "the crane is the way to the mark");
    if (shot.id === "w5-ignite") assert.deepEqual(subjects.map((subject) => [subject.id, subject.must]), [["mark", true]]);
  });
  assert.deepEqual([...seen], WELCOME_FILM.shots.map((shot) => shot.id));
});

test("no welcome shot holds a whole body as must: no cast id, no box from a head to its feet", () => {
  for (const comp of COMPS) {
    play(comp, FRAMES.filter((index) => index % 6 === 0), ({ shot, frame, ctx, subjects }) => {
      for (const subject of subjects) {
        if (!subject.must) continue;
        assert.ok(!(CAST_ORDER as readonly string[]).includes(subject.id), `${shot.id} ${comp} ${frame.time}: ${subject.id} is a whole body`);
        for (const id of CAST_ORDER) {
          const instance = ctx.cast[id] as CharacterInstance | undefined;
          if (!instance?.group.visible) continue;
          const head = instance.rig.bones.head.getWorldPosition(new THREE.Vector3());
          const feet = (["foot_L", "foot_R"] as const).map((bone) => instance.rig.bones[bone].getWorldPosition(new THREE.Vector3()));
          assert.ok(!(within(head, subject) && feet.some((foot) => within(foot, subject))), `${shot.id} ${comp} ${frame.time}: ${subject.id} spans ${id} head to foot`);
        }
      }
    });
  }
});

// ------------------------------------------------------------------------------------------------- what the boxes hold

test("a landmark carried by its bone sits at its bind position on the rest pose", () => {
  const ctx = contextFor("laptop", "dark");
  const maya = ctx.cast.maya as CharacterInstance;
  maya.group.position.set(0, 0, 0);
  maya.group.rotation.set(0, 0, 0);
  maya.rig.resetPose();
  maya.group.updateMatrixWorld(true);
  for (const [bone, landmark] of [["head", "eyeMid"], ["head", "chin"], ["hand_L", "handTip_L"], ["hand_R", "handTip_R"]] as const) {
    const at = landmarkWorld(maya, bone, landmark);
    const bind = pointOf(maya.rig.bind, landmark);
    assert.ok(at.distanceTo(new THREE.Vector3(...bind)) < 1e-9, `${landmark} on ${bone}`);
  }
});

test("the boxes are the parts they name, from the posed rigs and the props", () => {
  for (const { shot: id, loader, index } of LOADING) {
    const spec = LOADS[loader];
    let checked = false;
    play("laptop", FRAMES, ({ shot, frame, ctx, subjects }) => {
      if (shot.id !== id || checked || loaderAction(id, frame.local) < spec.seat) return;
      checked = true;
      const instance = ctx.cast[loader] as CharacterInstance;
      // The face: the intro's head box, widened to the rig's own face landmarks (a face turned to profile stays in it).
      const face = byId(subjects, `${loader}-face`);
      const head = headBox(instance, "head", true);
      for (let c = 0; c < 3; c += 1) assert.ok(face.min[c] <= head.min[c] && face.max[c] >= head.max[c], `${id}: the face box holds the intro's head box`);
      for (const landmark of ["eyeMid", "chin"] as const) assert.ok(within(landmarkWorld(instance, "head", landmark), face), `${id}: the face box holds ${landmark}`);
      // The hands: wrist to fingertip, padded by half a palm.
      const hands = byId(subjects, "hands");
      for (const side of ["L", "R"] as const) {
        const wrist = instance.rig.bones[`hand_${side}`].getWorldPosition(new THREE.Vector3());
        const tip = landmarkWorld(instance, `hand_${side}`, `handTip_${side}`);
        for (const point of [wrist, tip]) for (const offset of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]] as const) {
          assert.ok(within(point.clone().addScaledVector(new THREE.Vector3(...offset), PALM_HALF_WIDTH - 1e-6), hands), `${id}: hand ${side}`);
        }
      }
      // The plate: its hub (the intro's 3a-plate box) and, not must, the whole disc.
      const centre = plateWorld(welcomePlates(ctx.props.barbell)[index], new THREE.Vector3());
      const hub = byId(subjects, `plate-${index + 1}-hub`);
      const whole = byId(subjects, `plate-${index + 1}`);
      const { diameter, thickness } = WELCOME_PLATES[index];
      for (let c = 0; c < 3; c += 1) {
        assert.ok(Math.abs(hub.min[c] - (centre.getComponent(c) - HUB_HALF)) < 1e-9 && Math.abs(hub.max[c] - (centre.getComponent(c) + HUB_HALF)) < 1e-9, `${id}: the hub box`);
        const half = c === 2 ? thickness / 2 : diameter / 2;
        assert.ok(Math.abs(whole.max[c] - whole.min[c] - 2 * half) < 1e-9, `${id}: the whole plate's size on axis ${c}`);
      }
    });
    assert.ok(checked, `${id} reached its seat`);
  }
  assert.equal(HUB_HALF, 0.05, "the intro's 3a-plate hub box");
  // The sleeve: the inner collar out over the first plate's seat, at the sleeve's own radius; the tip beyond it.
  assert.equal(FIRST_SEAT_OUT, PLATE_SEATS[0] + WELCOME_PLATES[0].thickness / 2);
  const ctx = contextFor("laptop", "dark");
  const w0 = WELCOME_FILM.shots[0];
  const frame: ShotFrame = { time: 1, local: 1, duration: w0.end - w0.start, progress: 1 / (w0.end - w0.start), aspect: ctx.aspect };
  w0.enter(ctx, frame);
  w0.update(ctx, frame);
  const [sleeve, tip] = w0.subjects!(ctx, frame);
  assert.deepEqual([sleeve.id, sleeve.min[2], sleeve.max[2], tip.id, tip.min[2], tip.max[2]], ["sleeve", sleeveZ(0), sleeveZ(FIRST_SEAT_OUT), "sleeve-tip", sleeveZ(FIRST_SEAT_OUT), sleeveZ(SLEEVE_LENGTH)]);
  assert.ok(Math.abs(sleeve.max[0] - sleeve.min[0] - 2 * BARBELL.sleeveRadius) < 1e-12 && Math.abs((sleeve.min[1] + sleeve.max[1]) / 2 - BAR_CENTRE.y) < 1e-12);
  // The mark: the inlaid pieces' outline bounds on the platform.
  const w5 = WELCOME_FILM.shots[5];
  const [mark] = w5.subjects!(ctx, { ...frame, time: w5.start, local: 0 });
  assert.deepEqual([mark.min, mark.max], [[MARK_FLOOR_BOUNDS.minX, FLOOR_Y, MARK_FLOOR_BOUNDS.minZ], [MARK_FLOOR_BOUNDS.maxX, INLAY_TOP, MARK_FLOOR_BOUNDS.maxZ]]);
});

// ------------------------------------------------------------------------------------------------- on every screen

/** The part of each composition's frame visible at every edge of the bands it serves (unshrunk). */
function visibleArea(comp: FilmComposition): Box {
  const band = COMPOSITIONS.find((entry) => entry.id === comp)!;
  let box: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  for (const edge of servedEdges(comp)) box = intersect(box, visibleRegion(band.aspect, edge));
  return box;
}

test("no essential part is ever cut off: every must box stays inside the frame seen at both edges of its band", () => {
  const cut: string[] = [];
  for (const comp of COMPS) {
    const area = visibleArea(comp);
    play(comp, FRAMES, ({ index, shot, subjects }) => {
      for (const subject of subjects) {
        if (!subject.must) continue;
        const b = subject.box;
        if (!b) cut.push(`${comp} ${index} ${shot.id} ${subject.id}: behind the camera`);
        else if (b.x0 < area.x0 - 1e-6 || b.y0 < area.y0 - 1e-6 || b.x1 > area.x1 + 1e-6 || b.y1 > area.y1 + 1e-6) cut.push(`${comp} ${index} ${shot.id} ${subject.id}`);
      }
    });
  }
  assert.deepEqual(cut, []);
});

/**
 * The overhangs that remain past the protected box (the visible frame shrunk 9% a side), every one inside the visible
 * frame (above), so not cut off on any screen; measured at every frame, as a share of the frame. They may shrink, never
 * grow, and an entry that no longer occurs is removed.
 */
const REMAINING: Record<string, number> = {
  "phone w1-maya maya-face": 0.0162,
  "phone w2-leo leo-face": 0.0362,
  "tablet-p w3-dre dre-face": 0.0058,
  "tablet-p w3-dre plate-3-hub": 0.0046,
  "tablet-l w5-ignite mark": 0.0064,
  "laptop w1-maya maya-face": 0.0206,
  "laptop w1-maya plate-1-hub": 0.0599,
  "laptop w3-dre plate-3-hub": 0.0679,
  "laptop w3-dre hands": 0.0495,
  "laptop w5-ignite mark": 0.0092,
  "desktop w1-maya maya-face": 0.0335,
  "desktop w1-maya plate-1-hub": 0.0728,
  "desktop w3-dre plate-3-hub": 0.0808,
  "desktop w3-dre hands": 0.0624,
};

test("every must box stays inside the protected box, but for the measured remaining overhangs, which may only shrink", () => {
  const worst = new Map<string, number>();
  for (const comp of COMPS) {
    play(comp, FRAMES, ({ shot, subjects }) => {
      const failures = framingFailures({ comp, subjects: subjects.map((subject) => ({ id: subject.id, must: subject.must, box: subject.box })) }) as { id: string; box?: Box; area?: Box; problem: string }[];
      for (const failure of failures) {
        assert.ok(failure.box && failure.area, `${comp} ${shot.id} ${failure.id}: ${failure.problem}`);
        const { box, area } = failure as { box: Box; area: Box };
        const over = Math.max(area.x0 - box.x0, box.x1 - area.x1, area.y0 - box.y0, box.y1 - area.y1);
        const key = `${comp} ${shot.id} ${failure.id}`;
        worst.set(key, Math.max(worst.get(key) ?? 0, over));
      }
    });
  }
  for (const [key, over] of worst) {
    assert.ok(key in REMAINING, `${key}: ${over.toFixed(4)} past the protected box`);
    assert.ok(over <= REMAINING[key] + 5e-5, `${key}: ${over.toFixed(4)}, more than the measured ${REMAINING[key]}`);
  }
  for (const key of Object.keys(REMAINING)) assert.ok(worst.has(key), `${key} no longer overhangs: remove it from REMAINING`);
});

// ------------------------------------------------------------------------------------------------- the camera changes

test("the framing fixes are per composition (dolly and truck only); every other composition frames exactly as keyed", () => {
  const changed: Record<string, readonly FilmComposition[]> = { LEO_TRACK: ["tablet-l", "laptop", "desktop"], DRE_TRACK: ["phone", "tablet-l"] };
  for (const name of ["LIGHT_TRACK", "MAYA_TRACK", "LEO_TRACK", "DRE_TRACK"] as const) {
    const track = WELCOME_LAB[name] as CameraTrack;
    const comps = changed[name] ?? [];
    assert.deepEqual(Object.keys(track.compositions ?? {}).sort(), [...comps].sort(), `${name}: the compositions it changes`);
    for (const spec of Object.values(track.compositions ?? {})) {
      assert.equal(spec.keys, undefined, `${name}: same keys`);
      assert.equal(spec.focalScale, undefined, `${name}: same lens`);
    }
    const keyed: CameraTrack = { ...track, compositions: undefined };
    const a = createCameraState();
    const b = createCameraState();
    for (const band of COMPOSITIONS) {
      if (comps.includes(band.id)) continue;
      for (let t = 0; t <= 2.4; t += 0.1) {
        evaluateCameraTrack(track, t, band.aspect, a);
        evaluateCameraTrack(keyed, t, band.aspect, b);
        assert.ok(a.position.distanceTo(b.position) < 1e-12 && a.target.distanceTo(b.target) < 1e-12 && Math.abs(a.focal - b.focal) < 1e-12 && a.roll === b.roll, `${name} ${band.id} at ${t}`);
      }
    }
  }
});

test("the intro's shot helpers are the shared, node-safe subject boxes", () => {
  const common = readFileSync(new URL("../../src/components/brand/intro/director/shots/common.ts", import.meta.url), "utf8");
  assert.match(common, /export \{ bodyBox, headBox, jointsBox, pointBox \} from "\.\.\/subject-boxes";/);
  const shots = readFileSync(new URL("../../src/components/brand/intro/films/welcome/shots.ts", import.meta.url), "utf8");
  assert.match(shots, /from "\.\.\/\.\.\/director\/subject-boxes";/);
  assert.doesNotMatch(shots, /bodyBox\([^)]*,\s*true\)/, "no whole body is must");
});
