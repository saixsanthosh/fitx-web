/**
 * The welcome film's own props and set dressing (main thread, three.js), built once per director on the gym set:
 *
 * - the extruded mark floor: the FITX mark inlaid in the lifting platform as flush steel lines (three's own
 *   `SVGLoader.createShapes` and `ExtrudeGeometry`, no package), each piece with its own ignition (a flame front that
 *   runs the way the DOM piece travels as it forms, `mark-floor.ts`);
 * - the forge strip light: a steel-housed tube hung high off the platform's -X side (out of the top-down frame), which
 *   stutters on in the opening and keys the platform;
 * - two black rubber loading blocks that hold the empty bar at plate height, so plates roll and slide on;
 * - the loaded bar: the gym's own barbell (`FilmProps.barbell`), turned to lie along the mark's bar line, with three of
 *   its plates resized to the mark's three plates (450, 350 and 260 mm) and everything else hidden;
 * - Leo's helmet spot (D11): indoors Leo wears neither his cycling helmet nor his sunglasses. His own helmet mesh is
 *   moved onto the gym floor just off the platform with the stage's `carryHelmet` (which `hideStage` undoes before
 *   every shot), its rim resting flat, and his sunglasses are hidden (`leoIndoors`).
 *
 * Everything lives in the gym set's group, so `hideStage` hides it with the set; `resetWelcomeProps` puts it back to
 * one known state at every shot's `enter`, so seeking stays deterministic.
 */

import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import type { CharacterInstance } from "../../character/assemble";
import { carryHelmet } from "../../director/stage-kit";
import { BARBELL, PLATFORM } from "../../dimensions";
import type { FitxMarkPieceId } from "../../../logo/geometry";
import type { BarbellPlate, BarbellProp, IntroSet } from "../../sets/types";
import type { Theme } from "../../types";
import { MARK_BAR_LINE, MARK_FLOOR_DEPTH, MARK_FLOOR_SCALE, MARK_IGNITION, MARK_PLATES, parseMarkPath } from "./mark-floor";
import { FITX_MARK_PATHS } from "../../../logo/geometry";

/** The platform's top (the inlay sits on it). */
export const FLOOR_Y = PLATFORM.height;
/** Top of the inlay, where plates and blocks stand. */
export const INLAY_TOP = FLOOR_Y + MARK_FLOOR_DEPTH;
/** The bar's centre height when plate 1 stands on the inlay (its radius). */
export const BAR_Y = INLAY_TOP + BARBELL.plates[0].diameter / 2;

/** The three plates, inside out: which of the barbell's +X plates plays each, and its size (m). */
export const WELCOME_PLATES = [
  { owner: "maya", index: 0, diameter: 0.45, thickness: 0.089 },
  { owner: "leo", index: 4, diameter: 0.35, thickness: 0.084 },
  { owner: "dre", index: 1, diameter: 0.26, thickness: 0.078 },
] as const;
const PLATE_GAP = 0.0015;
/** The sleeve starts this far from the bar centre (the inner collar); plate positions below are relative to it. */
const SLEEVE_START = BARBELL.sleeveStart;
/** The sleeve's free length from the inner collar to the tip. */
export const SLEEVE_LENGTH = BARBELL.length / 2 - SLEEVE_START;

/** Seat of each plate, as its centre's distance from the inner collar (m). */
export const PLATE_SEATS: readonly number[] = (() => {
  const out: number[] = [];
  let x = 0.002;
  for (const plate of WELCOME_PLATES) {
    out.push(x + plate.thickness / 2);
    x += plate.thickness + PLATE_GAP;
  }
  return out;
})();

/**
 * Where the bar centre lies (world): on the mark's bar line, shifted along it so the three seated plates sit over the
 * mark's three plates (their mean positions match).
 */
export const BAR_CENTRE = (() => {
  const seatMean = PLATE_SEATS.reduce((sum, seat) => sum + seat, 0) / PLATE_SEATS.length + SLEEVE_START;
  const markMean = MARK_PLATES.reduce((sum, plate) => sum + plate.z, 0) / MARK_PLATES.length;
  return new THREE.Vector3(MARK_BAR_LINE.x, BAR_Y, markMean - seatMean);
})();

/** World Z of a point `u` m from the inner collar along the +Z sleeve. */
export function sleeveZ(u: number) {
  return BAR_CENTRE.z + SLEEVE_START + u;
}

const CORAL = 0xd9573f;
const EMBER = 0xff7a4d;

type PieceMesh = { id: FitxMarkPieceId; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform>; range: [number, number] };

export interface WelcomeProps {
  /** The mark floor's root (a child of the gym set's group). */
  mark: THREE.Group;
  pieces: readonly PieceMesh[];
  strip: THREE.Group;
  blocks: THREE.Group;
  /** Where Leo's helmet rests on the gym floor (`leoIndoors` hangs his helmet mesh on it). */
  helmetSpot: THREE.Group;
  /** The strip light's tube brightness (0 off, 1 on; above 1 a flash). */
  setStrip(level: number): void;
  /** One piece's ignition (0..1) with an overall heat (multiplies the emissive). */
  setIgnition(id: FitxMarkPieceId, amount: number, heat: number): void;
  /** Every piece dark. */
  resetIgnition(): void;
  applyTheme(theme: Theme): void;
  dispose(): void;
}

const props = new WeakMap<IntroSet, WelcomeProps>();

/** The welcome props on a gym set, built the first time a shot asks for them. */
export function welcomeProps(gym: IntroSet, theme: Theme): WelcomeProps {
  let built = props.get(gym);
  if (!built) {
    built = buildProps(gym, theme);
    props.set(gym, built);
  }
  return built;
}

/** Shapes of one mark piece in floor space: shape u = world Z, shape v = world X (see `mark-floor.ts`). */
function pieceShapes(d: string): THREE.Shape[] {
  const path = new THREE.ShapePath();
  const u = (x: number) => (x - 300) * MARK_FLOOR_SCALE;
  const v = (y: number) => (300 - y) * MARK_FLOOR_SCALE;
  for (const command of parseMarkPath(d)) {
    if (command.kind === "M") path.moveTo(u(command.x), v(command.y));
    else if (command.kind === "L") path.lineTo(u(command.x), v(command.y));
    else if (command.kind === "Q") path.quadraticCurveTo(u(command.cx), v(command.cy), u(command.x), v(command.y));
  }
  return SVGLoader.createShapes(path);
}

/** Shape (u, v, w) → world (Z, X, Y): a proper rotation, so the extrusion stands up off the floor. */
const SHAPE_TO_FLOOR = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));

function buildProps(gym: IntroSet, theme: Theme): WelcomeProps {
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(item: T) => {
    disposables.push(item);
    return item;
  };

  // ------------------------------------------------------------------ the mark floor
  const mark = new THREE.Group();
  mark.name = "welcome-mark-floor";
  mark.position.y = FLOOR_Y + 0.0004;
  gym.group.add(mark);
  const pieces: PieceMesh[] = [];
  for (const { id, d } of FITX_MARK_PATHS) {
    const shapes = pieceShapes(d);
    const geometry = track(new THREE.ExtrudeGeometry(shapes, { depth: MARK_FLOOR_DEPTH, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 6 }));
    geometry.applyMatrix4(SHAPE_TO_FLOOR);
    geometry.computeVertexNormals();
    const ignition = MARK_IGNITION.find((item) => item.id === id)!;
    const dir = new THREE.Vector2(ignition.direction.x, ignition.direction.z);
    // The flame front's travel range along `dir` over this piece (world XZ; the group is not moved in XZ).
    const positions = geometry.getAttribute("position");
    let lo = Infinity;
    let hi = -Infinity;
    for (let index = 0; index < positions.count; index += 1) {
      const along = positions.getX(index) * dir.x + positions.getZ(index) * dir.y;
      lo = Math.min(lo, along);
      hi = Math.max(hi, along);
    }
    const uniforms: Record<string, THREE.IUniform> = {
      uDir: { value: dir },
      uFront: { value: lo - 0.1 },
      uSoft: { value: 0.06 },
      uEdge: { value: 0 },
    };
    const material = track(new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: 0.78, roughness: 0.32, emissive: CORAL, emissiveIntensity: 0 }));
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vFloorXZ;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvFloorXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vFloorXZ;\nuniform vec2 uDir;\nuniform float uFront;\nuniform float uSoft;\nuniform float uEdge;")
        .replace(
          "#include <emissivemap_fragment>",
          [
            "#include <emissivemap_fragment>",
            "float fitxAlong = dot(vFloorXZ, uDir);",
            "float fitxBurn = 1.0 - smoothstep(uFront - uSoft, uFront + uSoft, fitxAlong);",
            "float fitxEdge = exp(-pow((fitxAlong - uFront) / max(uSoft, 1e-4), 2.0)) * uEdge;",
            "totalEmissiveRadiance *= fitxBurn + fitxEdge;",
          ].join("\n"),
        );
    };
    material.customProgramCacheKey = () => "fitx-welcome-mark-ignite";
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `mark-${id}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    // Floor-space geometry already; the group only lifts it onto the platform.
    mark.add(mesh);
    pieces.push({ id, mesh, material, uniforms, range: [lo, hi] });
  }

  // ------------------------------------------------------------------ the strip light
  const strip = new THREE.Group();
  strip.name = "welcome-strip-light";
  strip.position.set(-1.9, 3.3, 0.1);
  gym.group.add(strip);
  const steel = track(new THREE.MeshStandardMaterial({ color: 0x2a2d30, metalness: 0.7, roughness: 0.42 }));
  const tubeMaterial = track(new THREE.MeshStandardMaterial({ color: 0x1b1b1b, emissive: 0xfff1de, emissiveIntensity: 0, roughness: 0.4 }));
  const housing = new THREE.Mesh(track(new THREE.BoxGeometry(0.13, 0.05, 1.7)), steel);
  housing.position.y = 0.035;
  const tube = new THREE.Mesh(track(new THREE.CylinderGeometry(0.019, 0.019, 1.6, 16, 1).rotateX(Math.PI / 2)), tubeMaterial);
  tube.position.y = -0.004;
  const cableGeometry = track(new THREE.CylinderGeometry(0.003, 0.003, 3.3, 5).translate(0, 1.65 + 0.06, 0));
  for (const z of [-0.72, 0.72]) {
    const cable = new THREE.Mesh(cableGeometry, steel);
    cable.position.z = z;
    strip.add(cable);
  }
  strip.add(housing, tube);

  // ------------------------------------------------------------------ the loading blocks
  const blocks = new THREE.Group();
  blocks.name = "welcome-loading-blocks";
  gym.group.add(blocks);
  const rubber = track(new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 0.82, metalness: 0 }));
  const blockHeight = BAR_Y - INLAY_TOP - BARBELL.shaftRadius;
  const blockGeometry = track(new THREE.BoxGeometry(0.16, blockHeight, 0.13));
  for (const along of [-0.42, 0.42]) {
    const block = new THREE.Mesh(blockGeometry, rubber);
    block.position.set(BAR_CENTRE.x, INLAY_TOP + blockHeight / 2, BAR_CENTRE.z + along);
    block.castShadow = true;
    block.receiveShadow = true;
    blocks.add(block);
  }

  // ------------------------------------------------------------------ Leo's helmet spot (D11)
  const helmetSpot = new THREE.Group();
  helmetSpot.name = "welcome-helmet-spot";
  helmetSpot.position.set(HELMET_SPOT.x, 0, HELMET_SPOT.z);
  gym.group.add(helmetSpot);

  const applyTheme = (next: Theme) => {
    for (const piece of pieces) piece.material.color.setHex(next === "light" ? 0x3b3f43 : 0x2b2e31);
  };
  applyTheme(theme);

  return {
    mark,
    pieces,
    strip,
    blocks,
    helmetSpot,
    setStrip(level) {
      tubeMaterial.emissiveIntensity = Math.max(0, level) * 9;
    },
    setIgnition(id, amount, heat) {
      const piece = pieces.find((item) => item.id === id);
      if (!piece) return;
      const [lo, hi] = piece.range;
      const u = Math.min(1, Math.max(0, amount));
      // The front runs from just before the piece to just past it, so 0 is dark and 1 burns end to end.
      piece.uniforms.uFront.value = lo - 0.08 + (hi - lo + 0.16) * u;
      piece.uniforms.uEdge.value = u > 0 && u < 1 ? 1.6 : 0;
      piece.material.emissive.setHex(u >= 1 ? CORAL : EMBER);
      piece.material.emissiveIntensity = u > 0 ? heat : 0;
    },
    resetIgnition() {
      for (const piece of pieces) {
        piece.uniforms.uFront.value = piece.range[0] - 0.1;
        piece.uniforms.uEdge.value = 0;
        piece.material.emissiveIntensity = 0;
      }
    },
    applyTheme,
    dispose() {
      mark.removeFromParent();
      strip.removeFromParent();
      blocks.removeFromParent();
      helmetSpot.removeFromParent();
      for (const item of disposables) item.dispose();
    },
  };
}

/** The barbell's +X plates that play the three loaded plates, inside out (Maya's, Leo's, Dre's). */
export function welcomePlates(barbell: BarbellProp): [BarbellPlate, BarbellPlate, BarbellPlate] {
  const left = barbell.plates.left;
  return [left[WELCOME_PLATES[0].index], left[WELCOME_PLATES[1].index], left[WELCOME_PLATES[2].index]];
}

/**
 * Lays the bar on the mark's bar line (along +Z, its +X sleeve towards +Z), every plate but the three hidden, the
 * three resized and parked on their seats, collars hidden. Each shot then moves the plates it needs.
 */
export function stageBar(barbell: BarbellProp) {
  barbell.group.visible = true;
  barbell.group.position.copy(BAR_CENTRE);
  barbell.group.rotation.set(0, -Math.PI / 2, 0);
  barbell.setBend(0);
  barbell.setSleeveSpin(0);
  for (const plate of [...barbell.plates.left, ...barbell.plates.right]) plate.object.visible = false;
  const plates = welcomePlates(barbell);
  plates.forEach((plate, index) => {
    const spec = WELCOME_PLATES[index];
    const base = BARBELL.plates[spec.index];
    plate.object.visible = true;
    plate.object.scale.set(spec.thickness / base.thickness, spec.diameter / base.diameter, spec.diameter / base.diameter);
    plate.object.position.x = PLATE_SEATS[index];
    plate.object.rotation.x = 0;
  });
  for (const collar of barbell.collars) collar.visible = false;
  barbell.group.updateMatrixWorld(true);
  return plates;
}

/** Shows (`count`) of the three plates, the rest hidden (before they are loaded). */
export function showPlates(barbell: BarbellProp, count: number) {
  welcomePlates(barbell).forEach((plate, index) => {
    plate.object.visible = index < count;
  });
}

/** Puts a plate `u` m from the inner collar, turned `roll` rad about the bar (rolling plates turn as they travel). */
export function placePlate(plate: BarbellPlate, u: number, roll: number) {
  plate.object.position.x = u;
  plate.object.rotation.x = roll;
}

/** The scene state every welcome shot starts from (inside the gym set; the set itself is shown by the director). */
export function resetWelcomeProps(welcome: WelcomeProps, barbell: BarbellProp) {
  welcome.mark.visible = true;
  welcome.strip.visible = true;
  welcome.blocks.visible = true;
  welcome.helmetSpot.visible = true;
  welcome.setStrip(1);
  welcome.resetIgnition();
  stageBar(barbell);
}

/** Barbell plates the welcome film resized, back to their own size (the intro never shares this director, but be tidy). */
export function restoreBarbell(barbell: BarbellProp) {
  for (const plate of [...barbell.plates.left, ...barbell.plates.right]) plate.object.scale.set(1, 1, 1);
}

/** World position of a plate's centre (after the bar's transform). */
export function plateWorld(plate: BarbellPlate, out = new THREE.Vector3()) {
  plate.object.updateWorldMatrix(true, false);
  return plate.object.getWorldPosition(out);
}

// ------------------------------------------------------------------------------------------------- Leo indoors (D11)

/**
 * Where Leo set his helmet down (gym floor, world): just off the platform's +Z edge on the -X side, beside his place in
 * the team (x -0.78, z 1.56) and clear of his feet, the mark and the bar; its front turned towards the bar. Out of
 * frame in the shots he is not in (w0, w1, w3; tested), so it never pops.
 */
export const HELMET_SPOT = { x: -1.2, z: 1.4, yaw: 2.13 } as const;

/**
 * How a helmet shell rests on a flat floor, crown up: the pitch (rad, about its own X) that puts the lowest point of its
 * front half and the lowest point of its back half on the floor together (a bike helmet's rim dips at the back), and the
 * lift that puts that rim on the floor. `positions` are the shell's vertices relative to its centre (the holder's
 * origin, as `carryHelmet` centres it).
 */
export function helmetRest(positions: ArrayLike<number>): { pitch: number; lift: number } {
  // Rotating by `pitch` about +X takes (y, z) to (y cos - z sin, y sin + z cos). The lowest points of the two halves
  // change as the shell tips, so tip it a few times until both halves touch the same floor.
  let pitch = 0;
  for (let pass = 0; pass < 12; pass += 1) {
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    let front: [number, number] | null = null;
    let back: [number, number] | null = null;
    for (let index = 0; index + 2 < positions.length; index += 3) {
      const y = positions[index + 1] * c - positions[index + 2] * s;
      const z = positions[index + 1] * s + positions[index + 2] * c;
      if (z >= 0) {
        if (!front || y < front[0]) front = [y, z];
      } else if (!back || y < back[0]) back = [y, z];
    }
    if (!front || !back) break;
    const step = Math.atan2(front[0] - back[0], front[1] - back[1]);
    pitch += step;
    if (Math.abs(step) < 1e-5) break;
  }
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  let lowest = Infinity;
  for (let index = 0; index + 2 < positions.length; index += 3) lowest = Math.min(lowest, positions[index + 1] * c - positions[index + 2] * s);
  if (!Number.isFinite(lowest)) return { pitch: 0, lift: 0 };
  return { pitch, lift: -lowest + 0.0015 };
}

const rests = new WeakMap<THREE.BufferGeometry, { pitch: number; lift: number }>();

/**
 * Leo indoors (D11): his helmet off and set down on the floor by the platform (the stage's own `carryHelmet`, which
 * `hideStage` undoes before every shot, so it is called in each shot's `enter`), the straps hidden with it, and his
 * sunglasses off (hidden; `hideStage` shows them again for the intro's shots). Both themes, every shot he is in.
 */
export function leoIndoors(welcome: WelcomeProps, leo: CharacterInstance) {
  carryHelmet(leo, welcome.helmetSpot);
  leo.setAccessoryVisible("sunglassesFrame", false);
  leo.setAccessoryVisible("sunglassesLens", false);
  const helmet = leo.meshes.helmet as THREE.Mesh | undefined;
  let rest = { pitch: 0, lift: 0.12 };
  if (helmet?.isMesh) {
    const geometry = helmet.geometry;
    let cached = rests.get(geometry);
    if (!cached) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
      const source = geometry.getAttribute("position");
      const relative = new Float32Array(source.count * 3);
      for (let index = 0; index < source.count; index += 1) {
        relative[index * 3] = source.getX(index) - centre.x;
        relative[index * 3 + 1] = source.getY(index) - centre.y;
        relative[index * 3 + 2] = source.getZ(index) - centre.z;
      }
      cached = helmetRest(relative);
      rests.set(geometry, cached);
    }
    rest = cached;
  }
  welcome.helmetSpot.position.set(HELMET_SPOT.x, rest.lift, HELMET_SPOT.z);
  // Yaw after the pitch (YXZ): the rim flat on the floor, its front turned to the bar.
  welcome.helmetSpot.rotation.set(rest.pitch, HELMET_SPOT.yaw, 0, "YXZ");
  welcome.helmetSpot.updateMatrixWorld(true);
}

export const WELCOME_COLOURS = { coral: CORAL, ember: EMBER } as const;
