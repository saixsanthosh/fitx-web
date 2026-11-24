import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { COMPOSITIONS } from "@/components/brand/films/compositions";
import { buildAccessories } from "@/components/brand/intro/character/accessories";
import type { CharacterInstance } from "@/components/brand/intro/character/assemble";
import { LEO } from "@/components/brand/intro/character/cast";
import { applyCameraState, createCameraState, evaluateCameraTrack } from "@/components/brand/intro/director/camera";
import type { ShotContext, ShotModule } from "@/components/brand/intro/director/shot-types";
import { PLATFORM } from "@/components/brand/intro/dimensions";
import { computeBindPose } from "@/components/brand/intro/rig/skeleton";
import { BAR_CENTRE, HELMET_SPOT, helmetRest, welcomeProps } from "@/components/brand/intro/films/welcome/props";
import { WELCOME_LAB, WELCOME_SHOT_MODULES } from "@/components/brand/intro/films/welcome/shots";

// D11: indoors ("The Forge") Leo wears neither his cycling helmet nor his sunglasses, in every shot and both themes.

/** Leo's own helmet shell (bone-local on `head`), as the character worker builds it. */
function leoHelmetPositions() {
  const parts = buildAccessories(LEO, computeBindPose(LEO.proportions));
  const helmet = parts.find((part) => part.name === "helmet");
  assert.ok(helmet, "Leo has a helmet");
  assert.equal(helmet.rigidBone, "head");
  return helmet.positions;
}

function centred(positions: Float32Array) {
  const box = new THREE.Box3().setFromArray(positions);
  const centre = box.getCenter(new THREE.Vector3());
  const out = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    out[index] = positions[index] - centre.x;
    out[index + 1] = positions[index + 1] - centre.y;
    out[index + 2] = positions[index + 2] - centre.z;
  }
  return out;
}

test("Leo's own helmet rests on its rim, crown up, front and back touching the floor together", () => {
  const relative = centred(leoHelmetPositions());
  const rest = helmetRest(relative);
  assert.ok(Math.abs(rest.pitch) < (30 * Math.PI) / 180, `pitch ${rest.pitch}`);
  const c = Math.cos(rest.pitch);
  const s = Math.sin(rest.pitch);
  let lowest = Infinity;
  let highest = -Infinity;
  let front = Infinity;
  let back = Infinity;
  for (let index = 0; index < relative.length; index += 3) {
    const y = relative[index + 1] * c - relative[index + 2] * s + rest.lift;
    const z = relative[index + 1] * s + relative[index + 2] * c;
    lowest = Math.min(lowest, y);
    highest = Math.max(highest, y);
    if (z >= 0) front = Math.min(front, y);
    else back = Math.min(back, y);
  }
  assert.ok(lowest > 0 && lowest < 0.004, `the rim on the floor, not in it: lowest ${lowest}`);
  assert.ok(Math.abs(front - back) < 0.002, `front ${front} and back ${back} both on the floor`);
  assert.ok(highest > 0.12 && highest < 0.25, `crown up: ${highest}`);
  // A synthetic shell: a rim tilted 15° (front higher) rests level again.
  const tilt = (15 * Math.PI) / 180;
  const ring: number[] = [];
  for (let k = 0; k < 64; k += 1) {
    const a = (k / 64) * Math.PI * 2;
    const z = Math.cos(a) * 0.12;
    ring.push(Math.sin(a) * 0.1, -0.05 + z * Math.tan(tilt), z);
  }
  ring.push(0, 0.1, 0);
  const synthetic = helmetRest(ring);
  assert.ok(Math.abs(synthetic.pitch - tilt) < 0.01, `pitch ${synthetic.pitch} for a ${tilt} rim`);
});

test("the helmet spot: on the gym floor off the platform, clear of Leo's place, the mark and the bar, its front to the bar", () => {
  const radius = 0.15;
  assert.ok(HELMET_SPOT.z - radius > PLATFORM.depth / 2, "off the platform's +Z edge");
  assert.ok(Math.abs(HELMET_SPOT.x) - radius < PLATFORM.width / 2, "beside the platform, not out in the room");
  const leo = WELCOME_LAB.TEAM.find((member) => member.id === "leo")!;
  assert.ok(Math.hypot(HELMET_SPOT.x - leo.x, HELMET_SPOT.z - leo.z) > 0.38, "clear of Leo's feet in the team shots");
  for (const member of WELCOME_LAB.TEAM) assert.ok(Math.hypot(HELMET_SPOT.x - member.x, HELMET_SPOT.z - member.z) > 0.38, `clear of ${member.id}`);
  for (const loader of WELCOME_LAB.LOADERS) assert.ok(Math.hypot(HELMET_SPOT.x - loader.x, HELMET_SPOT.z - loader.rootZ) > 1.5, `clear of ${loader.id}'s loading place`);
  const toBar = Math.atan2(BAR_CENTRE.x - HELMET_SPOT.x, BAR_CENTRE.z - HELMET_SPOT.z);
  assert.ok(Math.abs(toBar - HELMET_SPOT.yaw) < 0.15, `front ${HELMET_SPOT.yaw} towards the bar ${toBar}`);
});

test("the helmet spot is out of frame in the shots Leo is not in (w0, w1, w3), on every composition", () => {
  const state = createCameraState();
  const camera = new THREE.PerspectiveCamera();
  const frustum = new THREE.Frustum();
  const matrix = new THREE.Matrix4();
  const spot = new THREE.Box3(new THREE.Vector3(HELMET_SPOT.x - 0.16, 0, HELMET_SPOT.z - 0.16), new THREE.Vector3(HELMET_SPOT.x + 0.16, 0.26, HELMET_SPOT.z + 0.16));
  const shots = [
    // Each of these shots evaluates its track on its own local clock.
    { id: "w0-light", track: WELCOME_LAB.LIGHT_TRACK },
    { id: "w1-maya", track: WELCOME_LAB.MAYA_TRACK },
    { id: "w3-dre", track: WELCOME_LAB.DRE_TRACK },
  ];
  for (const shot of shots) {
    const shotModule = WELCOME_SHOT_MODULES.find((item) => item.id === shot.id)!;
    assert.ok(!shotModule.cast.includes("leo"), `${shot.id} does not cast Leo`);
    for (const comp of COMPOSITIONS) {
      for (let local = 0; local <= shotModule.end - shotModule.start + 1e-9; local += 1 / 30) {
        evaluateCameraTrack(shot.track, local, comp.aspect, state);
        applyCameraState(camera, state, comp.aspect);
        camera.updateProjectionMatrix();
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        assert.ok(!frustum.intersectsBox(spot), `${shot.id} at ${local.toFixed(2)} s on ${comp.id}: the helmet spot is in frame`);
      }
    }
  }
});

// ------------------------------------------------------------------------------------------------- the shots' enter

function fakeLeo(): { instance: CharacterInstance; head: THREE.Object3D; parts: Record<string, THREE.Mesh> } {
  const head = new THREE.Object3D();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(leoHelmetPositions(), 3));
  const parts: Record<string, THREE.Mesh> = {};
  for (const name of ["helmet", "helmetStraps", "sunglassesFrame", "sunglassesLens"]) {
    parts[name] = new THREE.Mesh(name === "helmet" ? geometry : new THREE.BufferGeometry());
    parts[name].name = name;
    head.add(parts[name]);
  }
  const instance = {
    id: "leo",
    group: new THREE.Group(),
    meshes: parts,
    setAccessoryVisible(name: string, visible: boolean) {
      if (parts[name]) parts[name].visible = visible;
    },
  } as unknown as CharacterInstance;
  return { instance, head, parts };
}

function fakeBarbell() {
  const plate = () => ({ object: new THREE.Object3D(), restX: 0 });
  return {
    group: new THREE.Group(),
    plates: { left: [plate(), plate(), plate(), plate(), plate()], right: [plate()] },
    collars: [new THREE.Object3D()],
    setBend() {},
    setSleeveSpin() {},
  };
}

function fakeContext(leo: CharacterInstance, gym: { group: THREE.Group }) {
  const noop = () => {};
  return {
    sets: { gym },
    props: { barbell: fakeBarbell() },
    fx: { chalk: { setLight: noop, setAmbient: noop, trigger: noop, update: noop } },
    cast: { maya: { id: "maya" }, leo, dre: { id: "dre" } },
    theme: "dark",
    portrait: false,
    composition: "laptop",
    aspect: 16 / 9,
  } as unknown as ShotContext;
}

test("every shot that casts Leo sets his helmet down by the platform and takes his sunglasses off; the others leave him be", () => {
  const gym = { group: new THREE.Group() };
  const casting = WELCOME_SHOT_MODULES.filter((shot) => shot.cast.includes("leo")).map((shot) => shot.id);
  assert.deepEqual(casting, ["w2-leo", "w4-crane", "w5-ignite"]);
  for (const theme of ["dark", "light"] as const) {
    for (const shot of WELCOME_SHOT_MODULES as readonly ShotModule[]) {
      // Each shot starts from `hideStage`'s state: the helmet and glasses on him (a fresh Leo here).
      const leo = fakeLeo();
      const ctx = fakeContext(leo.instance, gym);
      (ctx as { theme: string }).theme = theme;
      shot.enter(ctx, { time: shot.start, local: 0, duration: shot.end - shot.start, progress: 0, aspect: ctx.aspect });
      const welcome = welcomeProps(ctx.sets.gym, theme);
      const helmet = leo.parts.helmet;
      if (!shot.cast.includes("leo")) {
        assert.equal(helmet.parent, leo.head, `${shot.id} (${theme}): Leo is not in it, nothing moved`);
        continue;
      }
      assert.equal(helmet.parent, welcome.helmetSpot, `${shot.id} (${theme}): the helmet is off his head`);
      assert.equal(welcome.helmetSpot.parent, gym.group, "the spot is in the gym set (hidden with it)");
      assert.equal(welcome.helmetSpot.visible, true);
      assert.equal(leo.parts.helmetStraps.visible, false, "straps go with the helmet");
      assert.equal(leo.parts.sunglassesFrame.visible, false, `${shot.id} (${theme}): sunglasses off`);
      assert.equal(leo.parts.sunglassesLens.visible, false, `${shot.id} (${theme}): sunglasses off`);
      // On the floor at the spot: its lowest point just above y 0, its centre at the spot, off the platform.
      gym.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(helmet, true);
      assert.ok(box.min.y > 0 && box.min.y < 0.005, `${shot.id}: resting on the floor (${box.min.y})`);
      assert.ok(box.max.y < 0.3, `${shot.id}: a helmet's height (${box.max.y})`);
      const centre = box.getCenter(new THREE.Vector3());
      assert.ok(Math.hypot(centre.x - HELMET_SPOT.x, centre.z - HELMET_SPOT.z) < 0.06, `${shot.id}: at the spot`);
      assert.ok(box.min.z > PLATFORM.depth / 2, `${shot.id}: off the platform`);
      // Its front (head-local +Z) points at the bar.
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(helmet.getWorldQuaternion(new THREE.Quaternion()));
      const toBar = new THREE.Vector3(BAR_CENTRE.x - centre.x, 0, BAR_CENTRE.z - centre.z).normalize();
      assert.ok(new THREE.Vector2(front.x, front.z).normalize().dot(new THREE.Vector2(toBar.x, toBar.z)) > 0.97, `${shot.id}: front to the bar`);
    }
  }
});
