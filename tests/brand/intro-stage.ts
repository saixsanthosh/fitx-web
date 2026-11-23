// A stand-in stage for the intro's shots in node (tests/brand/intro-framing.test.ts): real rigs posed by the real
// shot `update()`, real camera tracks and presets, and no-op props and effects. Projects each shot's `subjects()` into
// its composition's frame and checks them against the protected box and the overlay zones.
import * as THREE from "three";
import { COMPOSITIONS, type FilmComposition } from "@/components/brand/films/compositions";
import { CAST, CAST_ORDER } from "@/components/brand/intro/character/cast";
import type { CharacterId } from "@/components/brand/intro/character/types";
import { BARBELL, PLATFORM, TABLE, TRACK } from "@/components/brand/intro/dimensions";
import { applyCameraState } from "@/components/brand/intro/director/camera";
import { INTRO_FILM } from "@/components/brand/intro/director/intro-def";
import type { FilmContext, ShotFrame, ShotModule } from "@/components/brand/intro/director/shot-types";
import { computeBindPose } from "@/components/brand/intro/rig/skeleton";
import { createRig } from "@/components/brand/intro/rig/three-rig";
import { gymPreset, kitchenPreset, studioPreset, trackPreset } from "@/components/brand/intro/sets";
import { frameZones } from "@/components/brand/overlay-zones";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export const ids = COMPOSITIONS.map((band) => band.id);

// ---------------------------------------------------------------------------------- the protected box

export function visibleRegion(frameAspect: number, viewAspect: number): Box {
  if (viewAspect < frameAspect) {
    const share = viewAspect / frameAspect;
    return { x0: (1 - share) / 2, y0: 0, x1: (1 + share) / 2, y1: 1 };
  }
  const share = frameAspect / viewAspect;
  return { x0: 0, y0: (1 - share) / 2, x1: 1, y1: (1 + share) / 2 };
}

export function protectedBox(comp: FilmComposition): Box {
  const band = COMPOSITIONS.find((entry) => entry.id === comp)!;
  const a = visibleRegion(band.aspect, band.checkMin);
  const b = visibleRegion(band.aspect, band.checkMax);
  const box = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  return { x0: box.x0 + w * 0.09, y0: box.y0 + h * 0.09, x1: box.x1 - w * 0.09, y1: box.y1 - h * 0.09 };
}

export const inside = (box: Box, area: Box, tolerance = 0.004) =>
  box.x0 >= area.x0 - tolerance && box.y0 >= area.y0 - tolerance && box.x1 <= area.x1 + tolerance && box.y1 <= area.y1 + tolerance;
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// ---------------------------------------------------------------------------------- a stand-in stage

const noop = () => undefined;
const burst = () => ({ trigger: noop, update: noop, setLight: noop, setAmbient: noop });

function anchorsOf(group: THREE.Group, list: Record<string, [number, number, number]>) {
  const anchors: Record<string, THREE.Object3D> = {};
  for (const [name, position] of Object.entries(list)) {
    const anchor = new THREE.Object3D();
    anchor.position.set(...position);
    group.add(anchor);
    anchors[name] = anchor;
  }
  return anchors;
}

function setOf(name: string, theme: "light" | "dark", preset: (theme: "light" | "dark", variant: string) => unknown, anchors: Record<string, [number, number, number]>) {
  const group = new THREE.Group();
  return { name, group, anchors: anchorsOf(group, anchors), environment: null, variants: [], theme, timings: {}, lighting: (variant?: string) => preset(theme, variant ?? "base"), applyTheme: noop, update: noop, dispose: noop };
}

/** The barbell's plate and collar layout, as `createBarbell` builds it (sleeve groups at ±sleeveStart). */
function barbellStandIn() {
  const group = new THREE.Group();
  const plates: { left: { object: THREE.Object3D; restX: number; kind: string }[]; right: { object: THREE.Object3D; restX: number; kind: string }[] } = { left: [], right: [] };
  const collars: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.x = BARBELL.sleeveStart * side;
    group.add(pivot);
    let x = 0.002;
    for (const spec of BARBELL.plates) {
      const plate = new THREE.Group();
      const restX = (x + spec.thickness / 2) * side;
      plate.position.x = restX;
      pivot.add(plate);
      (side > 0 ? plates.left : plates.right).push({ object: plate, restX, kind: spec.color });
      x += spec.thickness + 0.0015;
    }
    const collar = new THREE.Group();
    collar.position.x = (x + 0.024) * side;
    collar.userData.restX = collar.position.x;
    pivot.add(collar);
    collars.push(collar);
  }
  return { group, plates, collars, setBend: noop, setSleeveSpin: noop, setCollarClamp: noop, dispose: noop };
}

function castMember(id: CharacterId) {
  const rig = createRig(computeBindPose(CAST[id].proportions));
  const group = new THREE.Group();
  group.add(rig.root);
  return { id, rig, group, meshes: {}, face: { setExpression: noop, setBlink: noop, setGaze: noop }, setHandPose: noop, setAccessoryVisible: noop, dispose: noop };
}

const cast = Object.fromEntries(CAST_ORDER.map((id) => [id, castMember(id)]));

export function contextFor(comp: FilmComposition, theme: "light" | "dark"): FilmContext {
  const band = COMPOSITIONS.find((entry) => entry.id === comp)!;
  const stand = {
    camera: new THREE.PerspectiveCamera(35, band.aspect, 0.02, 600),
    theme,
    quality: { tier: "high", dof: true, bloom: true, msaa: 4, dpr: 1, shadows: 2048, particleScale: 1 },
    sets: {
      track: setOf("track", theme, trackPreset, { startLine: [0, 0, 0], bikeLane: [TRACK.bikeLaneOffsetX, 0, 0], sun: [0, 100, 0] }),
      gym: setOf("gym", theme, gymPreset, { platform: [0, PLATFORM.height, 0] }),
      kitchen: setOf("kitchen", theme, kitchenPreset, { table: [0, TABLE.height, 0] }),
      studio: setOf("studio", theme, studioPreset, { walkStart: [0, 0, -3.2] }),
    },
    props: {
      bike: { group: new THREE.Group(), setCrankAngle: noop, setWheelAngle: noop, setSpinBlur: noop, pedalPositions: () => [new THREE.Vector3(), new THREE.Vector3()], dispose: noop },
      barbell: barbellStandIn(),
      smoothies: [{ group: new THREE.Group(), dispose: noop }, { group: new THREE.Group(), dispose: noop }],
      rings: { group: new THREE.Group(), setStartDirection: noop, setProgressAt: noop },
      helmetHolder: new THREE.Group(),
    },
    fx: { grit: [burst(), burst()], chalk: burst(), dust: [burst(), burst()], flare: { setIntensity: noop, object: new THREE.Object3D() } },
    cast,
    portrait: comp === "phone" || comp === "tablet-p",
    composition: comp,
    aspect: band.aspect,
  };
  return stand as unknown as FilmContext;
}

// ---------------------------------------------------------------------------------- the check

const corner = new THREE.Vector3();

/** Frame boxes (x right, y down, 0..1) of a shot's subjects at `time` on `comp`, with the shot's own camera. */
export function frameAt(shot: ShotModule, comp: FilmComposition, time: number, theme: "light" | "dark" = "dark") {
  const ctx = contextFor(comp, theme);
  const frame: ShotFrame = {
    time,
    local: time - shot.start,
    duration: shot.end - shot.start,
    progress: Math.min(1, Math.max(0, (time - shot.start) / (shot.end - shot.start))),
    aspect: ctx.aspect,
  };
  shot.enter(ctx, frame);
  const view = shot.update(ctx, frame);
  applyCameraState(ctx.camera, view.camera, ctx.aspect);
  ctx.camera.updateProjectionMatrix();
  ctx.camera.updateMatrixWorld(true);
  const subjects = (shot.subjects?.(ctx, frame) ?? []).map((subject) => {
    let box: Box | null = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const x of [subject.min[0], subject.max[0]]) for (const y of [subject.min[1], subject.max[1]]) for (const z of [subject.min[2], subject.max[2]]) {
      corner.set(x, y, z).project(ctx.camera);
      if (!(corner.z > -1 && corner.z < 1)) box = null;
      if (!box) continue;
      box.x0 = Math.min(box.x0, (corner.x + 1) / 2);
      box.x1 = Math.max(box.x1, (corner.x + 1) / 2);
      box.y0 = Math.min(box.y0, (1 - corner.y) / 2);
      box.y1 = Math.max(box.y1, (1 - corner.y) / 2);
    }
    return { ...subject, box };
  });
  return { subjects, view };
}

/** Sample times of a shot: just inside each end, the quarters, plus the checks BRIEF-2 3.2a names. */
const NAMED_TIMES: Record<string, number[]> = {
  "0-set": [0.5, 1.0],
  "1a-drive": [1.8],
  "1b-stride": [2.45, 2.7, 3.1, 3.3],
  "2a-cadence": [3.7, 4.2],
  "2b-wheel": [4.6, 5.05],
  "3a-plate": [5.42],
  "3b-chalk": [5.8],
  "3c-pull": [6.6, 7.0],
  "4a-table": [7.8, 8.2],
  "4b-toast": [8.7],
  "5a-walk": [9.4, 9.9],
};

export function samples(shot: ShotModule) {
  const span = shot.end - shot.start;
  const times = [shot.start + 0.02, shot.start + span * 0.25, shot.start + span * 0.5, shot.start + span * 0.75, shot.end - 0.02, ...(NAMED_TIMES[shot.id] ?? [])];
  return [...new Set(times.map((time) => Math.round(time * 1000) / 1000))].sort((a, b) => a - b);
}

export function checkShot(shot: ShotModule, failures: string[]) {
  for (const comp of ids) {
    const area = protectedBox(comp);
    const zones = frameZones(comp, INTRO_FILM.duration);
    for (const time of samples(shot)) {
      const { subjects } = frameAt(shot, comp, time);
      for (const subject of subjects) {
        if (!subject.must) continue;
        const where = `${shot.id} ${comp} t=${time.toFixed(2)} ${subject.id}`;
        if (!subject.box) {
          failures.push(`${where}: behind the camera`);
          continue;
        }
        const b = subject.box;
        const text = `[${b.x0.toFixed(3)} ${b.y0.toFixed(3)} ${b.x1.toFixed(3)} ${b.y1.toFixed(3)}]`;
        if (!inside(b, area)) failures.push(`${where}: outside the protected box ${text} vs [${area.x0.toFixed(3)} ${area.y0.toFixed(3)} ${area.x1.toFixed(3)} ${area.y1.toFixed(3)}]`);
        if (subject.clearOfOverlay === false) continue;
        for (const zone of zones) {
          if (time < zone.start || time >= zone.end) continue;
          if (overlaps(b, zone.box)) failures.push(`${where}: under ${zone.id} ${text}`);
        }
      }
    }
  }
}

