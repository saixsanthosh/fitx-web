/**
 * Eyes, eyelids, brows, lashes and expressions on the main thread. OWNER: faces agent (was
 * character-details).
 *
 * Per eye: a socket group at the eyeball centre (head-bone-local, axes = head axes) holding
 * - the eyeball: a sphere with a slight corneal bulge, a canvas-painted iris (limbal ring,
 *   radial fibres, collarette, pupil) and a clearcoat on the cornea only (a wet highlight; a
 *   clearcoat over the whole ball mirrored the night sky into a stare). A shader term darkens
 *   the eyeball under the upper lid (lid/lash shadow the shadow map can't resolve), following
 *   blinks and gaze;
 * - an upper-lid shell (skin tone, rounded margin) on a pivot that rotates down over the eye for
 *   blinks and follows vertical gaze, carrying the upper lash line;
 * - a lower-lid shell (follows gaze a little, pushed up by smiles).
 * The lid shells share the almond in `details/eyeShape.ts` with the head mesh, whose eye window
 * (cut along that almond grown past the margins, `head.ts`) exposes the margin band of each lid.
 * The shells are matte and shaded in the socket frame by the fold's crease (the window edge is
 * fixed while they rotate), so the band never shows as a bright, unoccluded outline.
 * Brows are head parts from the worker (`details/brows.ts`): they ride the expression morphs.
 * Expressions (`setExpression`) drive the head, brow and beard morph targets
 * (`details/expression.ts`) plus the lids (lower lids push up, upper lids squint in a laugh).
 */
import * as THREE from "three";
import type { FaceFeatures } from "./types";
import { createCharacterMaterials } from "./materials";
import { defaultAperture, eyeDir, lowerMargin, upperMargin, type EyeAperture } from "./details/eyeShape";

export interface FaceRig {
  /** Child of the head bone. */
  group: THREE.Group;
  /** 0 = open, 1 = closed. */
  setBlink(amount: number): void;
  /** World-space point to look at, or null to look straight ahead. */
  setGaze(target: THREE.Vector3 | null): void;
  /**
   * Expression weights, 0..1 each: `smile` (closed smile: corners up and out, cheeks and lower
   * lids lifted, brows a touch up) and `laugh` (jaw open, lips parted over the upper teeth; added
   * on top of the smile — pass both). Drives the head, brow, beard and mouth-interior morph
   * targets and the lids. Missing fields count as 0. The smile eases out: 0.3 already reads as a
   * confident smile at walking distance, 1 is the full grin. Pure function of its input (seek-safe).
   */
  setExpression(expression: { smile?: number; laugh?: number }): void;
  dispose(): void;
}

const MAX_YAW = 25 * THREE.MathUtils.DEG2RAD;
const MAX_PITCH = 15 * THREE.MathUtils.DEG2RAD;
/** Upper lid follows vertical gaze by this share (lid–gaze coupling); the lower lid less. */
const UPPER_FOLLOW = 0.62;
const LOWER_FOLLOW = 0.3;
/** Extra closing rotation so the closed upper margin overlaps the lower lid (no slit). */
const CLOSE_OVERLAP = 0.09;

type Side = "L" | "R";

interface EyeParts {
  side: Side;
  socket: THREE.Group;
  eyeball: THREE.Mesh;
  upper: THREE.Group;
  lower: THREE.Group;
  aperture: EyeAperture;
  closeAngle: number;
  uniforms: { uLidUp: { value: number }; uLidLo: { value: number }; uGaze: { value: THREE.Matrix3 } };
  /** Current rotation of each lid shell (socket frame), for its crease shading. */
  lidAngle: { upper: { value: number }; lower: { value: number } };
  yaw: number;
  pitch: number;
}

/** `expressionMeshes`: meshes whose morph targets are named "smile" / "laugh" (head, beard). */
export function createFaceRig(face: FaceFeatures, headBone: THREE.Bone, expressionMeshes: THREE.Mesh[] = []): FaceRig {
  const group = new THREE.Group();
  group.name = "face-rig";
  headBone.add(group);

  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  const eyes: EyeParts[] = [];
  for (const eye of face.eyes) {
    const lid = face.lids.find((l) => l.side === eye.side);
    const lash = face.lashes.find((l) => l.side === eye.side);
    const open = lid?.openAngle ?? 0.36;
    const aperture = defaultAperture(open, lid?.tilt ?? 0.07);
    const socket = new THREE.Group();
    socket.name = `eye_${eye.side}`;
    socket.position.fromArray(eye.center);
    group.add(socket);

    const uniforms = { uLidUp: { value: aperture.upper }, uLidLo: { value: aperture.lower }, uGaze: { value: new THREE.Matrix3() } };
    const eyeball = new THREE.Mesh(track(eyeballGeometry(eye.radius)), track(eyeMaterial(eye.irisColor, uniforms, track)));
    eyeball.name = `eyeball_${eye.side}`;
    eyeball.castShadow = false;
    eyeball.receiveShadow = true;
    socket.add(eyeball);

    const rOut = lid?.radius ?? eye.radius * 1.18;
    const rIn = eye.radius + (rOut - eye.radius) * 0.18;
    const skin = new THREE.Color(lid?.color ?? 0xc08a6c);
    const band = lid?.window ?? { up: 0.1, down: 0.07 };
    const lidAngle = { upper: { value: 0 }, lower: { value: 0 } };

    const upper = new THREE.Group();
    upper.name = `lidUpper_${eye.side}`;
    socket.add(upper);
    const upperMesh = new THREE.Mesh(track(lidGeometry(aperture, rIn, rOut, true, eye.side, skin)), track(lidMaterial(aperture, band, true, lidAngle.upper)));
    upperMesh.castShadow = false;
    upperMesh.receiveShadow = true;
    upper.add(upperMesh);
    if (lash) {
      const local = lash.points.map((p) => new THREE.Vector3(p[0] - eye.center[0], p[1] - eye.center[1], p[2] - eye.center[2]));
      // Matte: a glossy lash tube thinner than a pixel aliases into a crawling bright line.
      const lashMesh = new THREE.Mesh(track(lashGeometry(local, lash.radius)), track(new THREE.MeshLambertMaterial({ color: lash.color })));
      lashMesh.castShadow = false;
      upper.add(lashMesh);
    }

    const lower = new THREE.Group();
    lower.name = `lidLower_${eye.side}`;
    socket.add(lower);
    const lowerMesh = new THREE.Mesh(track(lidGeometry(aperture, rIn * 0.995, rOut - (rOut - rIn) * 0.22, false, eye.side, skin)), track(lidMaterial(aperture, band, false, lidAngle.lower)));
    lowerMesh.castShadow = false;
    lowerMesh.receiveShadow = true;
    lower.add(lowerMesh);

    const closeAngle = upperMargin(aperture, 0) - lowerMargin(aperture, 0) + CLOSE_OVERLAP;
    eyes.push({ side: eye.side, socket, eyeball, upper, lower, aperture, closeAngle, uniforms, lidAngle, yaw: 0, pitch: 0 });
  }

  let blink = 0;
  let smile = 0, laugh = 0;
  let hasGaze = false;
  const gazeTarget = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _e = new THREE.Euler(0, 0, 0, "YXZ");

  const applyLids = (e: EyeParts) => {
    // Lid–gaze coupling relaxes in a laugh: the squint holds even while he looks down at Maya
    // with his head thrown back.
    const coupling = 1 - 0.8 * laugh;
    // Upper lid: blink closes from the gaze-followed rest angle down past the lower margin; a
    // smile narrows it, a laugh squints.
    const follow = e.pitch * UPPER_FOLLOW * coupling;
    const rest = follow + 0.085 * smile + 0.14 * laugh;
    const closed = e.closeAngle + e.pitch * LOWER_FOLLOW;
    const angle = rest + (closed - rest) * easeBlink(blink);
    e.upper.rotation.set(angle, 0, 0);
    // The lower lid rises a touch at full closure, follows downward gaze a little, and is pushed
    // up by the cheeks in a smile (with the head morph's infraorbital lift: the "eye smile") and
    // further in a laugh (the eyes become crescents).
    const raise = (0.25 * smile + 0.14 * laugh) * (1 - blink);
    e.lower.rotation.set(e.pitch * LOWER_FOLLOW * coupling - 0.06 * blink - raise, 0, 0);
    e.uniforms.uLidUp.value = e.aperture.upper - angle;
    e.uniforms.uLidLo.value = e.aperture.lower - e.lower.rotation.x;
    e.lidAngle.upper.value = angle;
    e.lidAngle.lower.value = e.lower.rotation.x;
  };

  const applyGaze = () => {
    headBone.updateWorldMatrix(true, false);
    for (const e of eyes) {
      let yaw = 0, pitch = 0;
      if (hasGaze) {
        // Target in socket space (socket axes = head-bone axes).
        e.socket.updateWorldMatrix(true, false);
        _m.copy(e.socket.matrixWorld).invert();
        _p.copy(gazeTarget).applyMatrix4(_m);
        if (_p.lengthSq() > 1e-8) {
          yaw = Math.atan2(_p.x, Math.max(1e-4, _p.z));
          pitch = Math.atan2(-_p.y, Math.hypot(_p.x, _p.z));
        }
      }
      e.yaw = THREE.MathUtils.clamp(yaw, -MAX_YAW, MAX_YAW);
      e.pitch = THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH);
      _e.set(e.pitch, e.yaw, 0, "YXZ");
      e.eyeball.quaternion.setFromEuler(_e);
      e.uniforms.uGaze.value.setFromMatrix4(_m.makeRotationFromQuaternion(e.eyeball.quaternion));
      applyLids(e);
    }
  };
  applyGaze();
  // A fixed world target stays fixed while the head moves: re-aim once per rendered frame from
  // the latest head pose (onBeforeRender runs before an object's model-view matrix is built, and
  // every face mesh carries the hook so whichever renders first refreshes them all).
  let lastFrame = -1;
  const refresh = (renderer: THREE.WebGLRenderer) => {
    if (!hasGaze || renderer.info.render.frame === lastFrame) return;
    lastFrame = renderer.info.render.frame;
    applyGaze();
    for (const e of eyes) e.socket.updateMatrixWorld(true);
  };
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.onBeforeRender = (renderer) => refresh(renderer);
  });
  return {
    group,
    setBlink(amount: number) {
      blink = THREE.MathUtils.clamp(amount, 0, 1);
      for (const e of eyes) applyLids(e);
    },
    setGaze(target: THREE.Vector3 | null) {
      // Copied into one persistent vector: this runs every frame for every character.
      hasGaze = target !== null;
      if (target) gazeTarget.copy(target);
      applyGaze();
    },
    setExpression(expression: { smile?: number; laugh?: number }) {
      // Weights are perceptual: the smile eases out (0.3 → 0.66 of the full shape, so it already
      // reads as a confident smile at walking distance; 1 is the full grin). The laugh opens the
      // jaw linearly.
      const s = THREE.MathUtils.clamp(expression.smile ?? 0, 0, 1);
      smile = 1 - (1 - s) ** 3;
      laugh = THREE.MathUtils.clamp(expression.laugh ?? 0, 0, 1);
      for (const mesh of expressionMeshes) {
        const influences = mesh.morphTargetInfluences, names = mesh.morphTargetDictionary;
        if (!influences || !names) continue;
        if (names.smile !== undefined) influences[names.smile] = smile;
        if (names.laugh !== undefined) influences[names.laugh] = laugh;
      }
      for (const e of eyes) applyLids(e);
    },
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}

/** Lids accelerate shut and settle open; keeps a linear driver from looking mechanical. */
function easeBlink(t: number) {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// Eyeball

function eyeballGeometry(radius: number) {
  const geometry = new THREE.SphereGeometry(radius, 40, 28);
  // Pole on +Z (gaze axis): SphereGeometry's pole is +Y.
  geometry.rotateX(Math.PI / 2);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const irisCos = Math.cos(31 * THREE.MathUtils.DEG2RAD);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).normalize();
    // Corneal bulge over the iris (a smooth cap ~0.7 mm high) catches a livelier highlight.
    const cap = THREE.MathUtils.smoothstep(v.z, irisCos - 0.06, 1);
    const r = radius * (1 + 0.055 * cap * cap);
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
    // Planar projection along the gaze axis; the back half maps to plain sclera at the edge.
    const s = v.z >= 0 ? 1 : 1.02 / Math.max(1e-3, Math.hypot(v.x, v.y));
    uv.setXY(i, 0.5 + 0.5 * v.x * Math.min(1, s), 0.5 + 0.5 * v.y * Math.min(1, s));
  }
  geometry.computeVertexNormals();
  return geometry;
}

const irisCache = new Map<number, { texture: THREE.CanvasTexture; users: number }>();

function irisTexture(color: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const c = size / 2;
  const iris = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  iris.getHSL(hsl);
  const css = (h: number, s: number, l: number, a = 1) => `hsla(${(h * 360).toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;

  // Sclera: warm off-white, darker and a little warmer toward the corners of the eye.
  const sclera = ctx.createRadialGradient(c, c, size * 0.12, c, c, size * 0.5);
  // Kept well below paper white: in a lit face the sclera sits around the skin's own value, and
  // a white sclera reads as a stare at a distance (worse under the coral studio grade).
  sclera.addColorStop(0, "#cbc2b8");
  sclera.addColorStop(0.55, "#bfb2a6");
  sclera.addColorStop(0.85, "#a89286");
  sclera.addColorStop(1, "#927a70");
  ctx.fillStyle = sclera;
  ctx.fillRect(0, 0, size, size);
  // A few faint vessels near the corners.
  let seed = (color * 2654435761) >>> 0;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  ctx.lineCap = "round";
  for (let i = 0; i < 14; i += 1) {
    const side = rnd() < 0.5 ? -1 : 1;
    const a0 = (rnd() - 0.5) * 0.9;
    let x = c + side * size * (0.47 - rnd() * 0.04), y = c + Math.sin(a0) * size * 0.3;
    ctx.strokeStyle = `rgba(170, 70, 60, ${0.05 + rnd() * 0.08})`;
    ctx.lineWidth = 0.8 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s += 1) {
      x -= side * size * (0.03 + rnd() * 0.03);
      y += (rnd() - 0.5) * size * 0.04;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const R = size * 0.5 * Math.sin(31 * THREE.MathUtils.DEG2RAD);
  const pupil = R * 0.36;
  // Iris base: radial gradient, lighter mid-zone (stroma), deeper toward the limbus.
  const base = ctx.createRadialGradient(c, c, pupil, c, c, R);
  base.addColorStop(0, css(hsl.h, hsl.s * 0.9, Math.min(0.5, hsl.l * 0.9)));
  base.addColorStop(0.35, css(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(0.62, hsl.l * 1.55 + 0.05)));
  base.addColorStop(0.75, css(hsl.h, hsl.s, Math.min(0.5, hsl.l * 1.15)));
  base.addColorStop(1, css(hsl.h, hsl.s * 0.8, hsl.l * 0.55));
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();
  // Radial fibres: light and dark strokes, slightly wavy.
  for (let i = 0; i < 260; i += 1) {
    const a = rnd() * Math.PI * 2;
    const light = rnd() < 0.55;
    const r0 = pupil * (1.02 + rnd() * 0.15), r1 = R * (0.62 + rnd() * 0.36);
    const wob = (rnd() - 0.5) * 0.12;
    ctx.strokeStyle = light
      ? css(hsl.h + 0.02, Math.min(1, hsl.s * 0.9), Math.min(0.78, hsl.l * 1.9 + 0.12), 0.08 + rnd() * 0.16)
      : css(hsl.h, hsl.s, hsl.l * 0.45, 0.1 + rnd() * 0.16);
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.quadraticCurveTo(c + Math.cos(a + wob) * (r0 + r1) * 0.5, c + Math.sin(a + wob) * (r0 + r1) * 0.5, c + Math.cos(a + wob * 0.5) * r1, c + Math.sin(a + wob * 0.5) * r1);
    ctx.stroke();
  }
  // Collarette: a soft lighter ring around the pupil zone.
  ctx.strokeStyle = css(hsl.h + 0.03, hsl.s * 0.8, Math.min(0.75, hsl.l * 1.8 + 0.12), 0.35);
  ctx.lineWidth = R * 0.07;
  ctx.beginPath();
  ctx.arc(c, c, pupil * 1.55, 0, Math.PI * 2);
  ctx.stroke();
  // Limbal ring: dark outer edge melting into the sclera.
  const limbus = ctx.createRadialGradient(c, c, R * 0.78, c, c, R * 1.06);
  limbus.addColorStop(0, "rgba(10, 8, 6, 0)");
  limbus.addColorStop(0.6, "rgba(12, 9, 7, 0.55)");
  limbus.addColorStop(0.85, "rgba(16, 12, 10, 0.45)");
  limbus.addColorStop(1, "rgba(30, 24, 20, 0)");
  ctx.fillStyle = limbus;
  ctx.beginPath();
  ctx.arc(c, c, R * 1.06, 0, Math.PI * 2);
  ctx.fill();
  // Pupil with a soft edge.
  const pg = ctx.createRadialGradient(c, c, pupil * 0.8, c, c, pupil * 1.12);
  pg.addColorStop(0, "#050404");
  pg.addColorStop(1, "rgba(5, 4, 4, 0)");
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(c, c, pupil * 1.12, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

let corneaShared: { texture: THREE.CanvasTexture; users: number } | null = null;

/** Clearcoat mask in the eyeball's planar UVs: the cornea disc (just past the iris) with a soft rim. */
function corneaMask(): { texture: THREE.CanvasTexture; release: () => void } {
  if (!corneaShared) {
    const size = 64;
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, size * 0.25, c, c, size * 0.31);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#000000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    texture.needsUpdate = true;
    corneaShared = { texture, users: 0 };
  }
  const shared = corneaShared;
  shared.users += 1;
  let released = false;
  return {
    texture: shared.texture,
    release: () => {
      if (released) return;
      released = true;
      shared.users -= 1;
      if (shared.users <= 0) {
        shared.texture.dispose();
        if (corneaShared === shared) corneaShared = null;
      }
    },
  };
}

function eyeMaterial(
  irisColor: number,
  uniforms: EyeParts["uniforms"],
  track: <T extends { dispose(): void }>(x: T) => T,
): THREE.MeshPhysicalMaterial {
  let entry = irisCache.get(irisColor);
  if (!entry) {
    entry = { texture: irisTexture(irisColor), users: 0 };
    irisCache.set(irisColor, entry);
  }
  entry.users += 1;
  const cached = entry;
  track({
    dispose: () => {
      cached.users -= 1;
      if (cached.users <= 0) {
        cached.texture.dispose();
        irisCache.delete(irisColor);
      }
    },
  });
  const cornea = corneaMask();
  track({ dispose: cornea.release });
  const material = new THREE.MeshPhysicalMaterial({
    map: cached.texture,
    roughness: 0.4,
    metalness: 0,
    // The wet coat covers the cornea only: over the whole ball it mirrored the environment
    // (the blue night sky) across the sclera.
    clearcoat: 1,
    clearcoatMap: cornea.texture,
    clearcoatRoughness: 0.035,
    specularIntensity: 0.4,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLidUp = uniforms.uLidUp;
    shader.uniforms.uLidLo = uniforms.uLidLo;
    shader.uniforms.uGaze = uniforms.uGaze;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat3 uGaze;\nvarying vec3 vSocketDir;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSocketDir = uGaze * normalize(position);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uLidUp;\nuniform float uLidLo;\nvarying vec3 vSocketDir;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec3 sd = normalize(vSocketDir);
          float phi = asin(clamp(sd.y, -1.0, 1.0));
          float theta = atan(sd.x, sd.z);
          // Shadow under the upper lid and lashes, softer above the lower lid, darker corners.
          float under = smoothstep(-0.02, 0.26, uLidUp - phi);
          float over = smoothstep(-0.02, 0.16, phi - uLidLo);
          float corner = 1.0 - 0.45 * smoothstep(0.55, 1.15, abs(theta));
          diffuseColor.rgb *= mix(0.32, 1.0, under) * mix(0.72, 1.0, over) * corner;
        }`,
      );
  };
  material.customProgramCacheKey = () => "fitx-eyeball-v1";
  return material;
}

// ---------------------------------------------------------------------------------------------
// Lids

const EDGE_N = 16;

/**
 * Matte lid skin (the skin's wrap lighting without its sheen) with the fold's crease occlusion
 * applied in the socket frame: the head's window edge (margin + band) is fixed while the shell
 * rotates, so whatever part of the shell sits just inside it — at rest, looking down or blinking —
 * is shaded like the head skin's baked occlusion on the other side of the fold.
 */
function lidMaterial(ap: EyeAperture, band: { up: number; down: number }, upper: boolean, angle: { value: number }): THREE.MeshPhysicalMaterial {
  const skin = createCharacterMaterials().skin as THREE.MeshPhysicalMaterial;
  const material = skin.clone();
  material.sheen = 0;
  material.specularIntensity = 0.2;
  material.roughness = 0.62;
  // Window edge elevation across the azimuth (beyond the corners the head skin covers the shells).
  const t0 = ap.medial - 0.3, t1 = ap.lateral + 0.3;
  const edge = new Float32Array(EDGE_N);
  for (let i = 0; i < EDGE_N; i += 1) {
    const theta = t0 + ((t1 - t0) * i) / (EDGE_N - 1);
    edge[i] = upper ? upperMargin(ap, theta) + band.up : lowerMargin(ap, theta) - band.down;
  }
  const uniforms = {
    uLidAngle: angle,
    uLidEdge: { value: edge },
    uLidRange: { value: new THREE.Vector2(t0, t1) },
    // Crease width (radians inside the edge) and the darkest multiplier at the edge.
    uLidCrease: { value: new THREE.Vector2(upper ? band.up * 1.15 : band.down * 1.2, upper ? 0.52 : 0.6) },
  };
  const baseHook = skin.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    baseHook.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uLidAngle;\nvarying vec3 vLidDir;")
      .replace(
        "#include <begin_vertex>",
        // Socket-frame direction: the shell's local position turned by its pivot rotation (x).
        "#include <begin_vertex>\n{ float lc = cos(uLidAngle), ls = sin(uLidAngle); vLidDir = vec3(abs(position.x), lc * position.y - ls * position.z, ls * position.y + lc * position.z); }",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uLidEdge[${EDGE_N}];\nuniform vec2 uLidRange;\nuniform vec2 uLidCrease;\nvarying vec3 vLidDir;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 ld = normalize(vLidDir);
          float lth = atan(ld.x, ld.z);
          float lph = asin(clamp(ld.y, -1.0, 1.0));
          float lf = clamp((lth - uLidRange.x) / (uLidRange.y - uLidRange.x), 0.0, 1.0) * ${EDGE_N - 1}.0;
          int li = int(min(lf, ${EDGE_N - 2}.0));
          float le = mix(uLidEdge[li], uLidEdge[li + 1], lf - float(li));
          float inside = ${upper ? "le - lph" : "lph - le"};
          diffuseColor.rgb *= mix(uLidCrease.y, 1.0, smoothstep(0.0, uLidCrease.x, inside));
        }`,
      );
  };
  material.customProgramCacheKey = () => `fitx-lid-v1-${upper ? "u" : "l"}`;
  return material;
}

/**
 * Lid shell over the eyeball: an outer skin surface from far under the socket rim down to the
 * margin, a rounded margin roll, and a short inner surface facing the eyeball.
 */
function lidGeometry(ap: EyeAperture, rIn: number, rOut: number, upper: boolean, side: Side, tone: THREE.Color) {
  const sx = side === "L" ? 1 : -1;
  const cols = 36;
  const outerRows = 12, rollRows = 7, innerRows = 4;
  const rc = (rIn + rOut) / 2, m = (rOut - rIn) / 2;
  // Past the corners the two shells meet and wrap well around the eyeball, so a grazing view
  // through the head's eye opening always lands on lid skin (never on the inside of the head).
  const t0 = ap.medial - 0.5, t1 = ap.lateral + (upper ? 0.45 : 0.6);
  // Far edges wrap well over the eyeball so a fully closed lid never uncovers it under the socket rim.
  const far = upper ? 2.35 : -1.75;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const rows = outerRows + rollRows + innerRows;
  const push = (theta: number, phi: number, r: number, nr: number, nt: number, shade: number) => {
    const d = eyeDir(theta, phi);
    // Tangent toward the opening (decreasing φ for the upper lid).
    const dt = eyeDir(theta, phi + (upper ? -0.01 : 0.01));
    const tx = dt[0] - d[0], ty = dt[1] - d[1], tz = dt[2] - d[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    positions.push(d[0] * r * sx, d[1] * r, d[2] * r);
    const nx = d[0] * nr + (tx / tl) * nt, ny = d[1] * nr + (ty / tl) * nt, nz = d[2] * nr + (tz / tl) * nt;
    const nl = Math.hypot(nx, ny, nz) || 1;
    normals.push((nx / nl) * sx, ny / nl, nz / nl);
    // Linear skin tone × lid shading (Color stores linear RGB).
    colors.push(tone.r * shade, tone.g * shade * 0.97, tone.b * shade * 0.96);
  };
  for (let j = 0; j < cols; j += 1) {
    const theta = t0 + ((t1 - t0) * j) / (cols - 1);
    const margin = upper ? upperMargin(ap, theta) : lowerMargin(ap, theta);
    for (let i = 0; i < outerRows; i += 1) {
      const s = i / (outerRows - 1);
      // Rows crowd toward the margin, where the shell shows (and blinks sweep it into view).
      const phi = margin + (far - margin) * (1 - s) ** 2.2;
      push(theta, phi, rOut, 1, 0, 1);
    }
    for (let i = 1; i <= rollRows; i += 1) {
      const psi = (Math.PI * i) / (rollRows + 1);
      const r = rc + m * Math.cos(psi);
      const phi = margin + (upper ? -1 : 1) * (m / rc) * Math.sin(psi) * 1.15;
      // The margin roll falls off toward the eyeball (its own shadow and the lash line); the lower
      // margin faces the key light, so it starts darker (a bright rim read as a painted line).
      push(theta, phi, r, Math.cos(psi), Math.sin(psi), (upper ? 0.9 : 0.74) - 0.3 * Math.sin(psi) - 0.12 * (psi / Math.PI));
    }
    for (let i = 0; i < innerRows; i += 1) {
      const s = i / (innerRows - 1);
      push(theta, margin + (upper ? 1 : -1) * 0.28 * s, rIn, -1, 0, 0.5 - 0.2 * s);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < cols - 1; j += 1) {
    for (let i = 0; i < rows - 1; i += 1) {
      const a = j * rows + i, b = a + 1, c = a + rows, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(orientIndex(index, positions, normals));
  return geometry;
}

/** Flips every triangle whose geometric normal disagrees with its vertex normals. */
function orientIndex(index: number[], p: number[], n: number[]) {
  const out = index.slice();
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t] * 3, b = out[t + 1] * 3, c = out[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const nx = n[a] + n[b] + n[c], ny = n[a + 1] + n[b + 1] + n[c + 1], nz = n[a + 2] + n[b + 2] + n[c + 2];
    if (gx * nx + gy * ny + gz * nz < 0) {
      const tmp = out[t + 1];
      out[t + 1] = out[t + 2];
      out[t + 2] = tmp;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Lashes and brows

/** Tube with per-ring radius and an optional flattened cross-section along `flatten` axes. */
function taperedTube(
  points: THREE.Vector3[],
  width: (t: number) => number,
  thickness: (t: number) => number,
  normalAt: (p: THREE.Vector3, t: number) => THREE.Vector3,
  radial = 8,
) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const rings = Math.max(8, points.length * 6);
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T).normalize();
    N.copy(normalAt(P, t));
    N.sub(T.clone().multiplyScalar(N.dot(T))).normalize();
    B.crossVectors(T, N).normalize();
    const w = width(t), h = thickness(t);
    for (let j = 0; j < radial; j += 1) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      positions.push(P.x + B.x * ca * w + N.x * sa * h, P.y + B.y * ca * w + N.y * sa * h, P.z + B.z * ca * w + N.z * sa * h);
      const nx = B.x * ca / Math.max(w, 1e-6) + N.x * sa / Math.max(h, 1e-6);
      const ny = B.y * ca / Math.max(w, 1e-6) + N.y * sa / Math.max(h, 1e-6);
      const nz = B.z * ca / Math.max(w, 1e-6) + N.z * sa / Math.max(h, 1e-6);
      const l = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / l, ny / l, nz / l);
    }
  }
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(orientIndex(index, positions, normals));
  return geometry;
}

function lashGeometry(points: THREE.Vector3[], radius: number) {
  // Lash line hugs the lid margin; it thickens toward the outer corner, and the medial third
  // fades to a fine line (a full-length dark tube read as eyeliner).
  const medial = (t: number) => 0.3 + 0.7 * THREE.MathUtils.smoothstep(t, 0.04, 0.4);
  const width = (t: number) => radius * medial(t) * (0.35 + 1.25 * Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.04)) ** 0.7 * (0.75 + 0.45 * t));
  const thickness = (t: number) => radius * medial(t) * (0.6 + 0.6 * Math.sin(Math.PI * t) ** 0.8);
  // Flatten across the lid surface (normal = radial from the eye centre).
  return taperedTube(points, width, thickness, (p) => p.clone().normalize(), 6);
}
