/**
 * Seekable particle bursts for the film (main thread): chalk clap, sprinter's grit kick,
 * barbell-drop dust. Each burst's state is a pure function of `time - startTime`, so the
 * director can seek any frame: `trigger(origin, direction, startTime)` once (or again to
 * restart), then `update(time)` every frame on the same clock (use the shot's *action* time
 * so slow-motion slows the particles too).
 *
 * Coordinates (`origin`, `direction`, light directions) are in the space of the burst
 * object's parent — normally the scene or a set root. Render through `IntroPost`: sprites
 * output scene-linear premultiplied colour for the HDR target.
 */

import * as THREE from "three";
import { createRng } from "../math";
import { GranuleCloud, type GranuleDef } from "./granules";
import { SpriteCloud, type SpriteDefs, type SpriteLook } from "./spriteCloud";
import { getPuffAtlas, PUFF_CELL } from "./textures";

export interface ParticleBurst {
  object: THREE.Object3D;
  /** Starts (or restarts) the burst at `origin`; see each factory for what `direction` means. */
  trigger(origin: THREE.Vector3, direction: THREE.Vector3, startTime: number): void;
  /** Evaluates the burst at `time` (same clock as `startTime`). Before the trigger time nothing shows. */
  update(time: number): void;
  /** Hides everything until the next trigger. */
  reset(): void;
  /** Renders only this fraction of the allocated particles (frame-time guard), 0..1. */
  setParticleScale(scale: number): void;
  /** Seconds after the trigger until the last particle has gone. */
  readonly duration: number;
  /** True if anything was visible at the last update. */
  readonly active: boolean;
  dispose(): void;
}

export interface LitBurst extends ParticleBurst {
  /** Key light on the cloud: direction *toward* the light, sRGB hex, rig-style intensity. */
  setLight(direction: THREE.Vector3, color: number, intensity: number): void;
  /** Fill/ambient on the cloud (hemisphere + environment equivalent). */
  setAmbient(color: number, intensity: number): void;
}

/** Lighting for the sprite clouds (the granules are lit by the scene's own lights). */
export interface BurstLightOptions {
  /** Direction toward the key light (same space as the burst's origin). */
  lightDirection?: THREE.Vector3;
  lightColor?: number;
  lightIntensity?: number;
  ambientColor?: number;
  ambientIntensity?: number;
}

export interface ChalkBurstOptions extends BurstLightOptions {
  /** Quality multiplier on particle counts (QualitySettings.particleScale). */
  particleScale?: number;
  /** Overall opacity multiplier (default 1). */
  density?: number;
  /** Cloud size multiplier (default 1). */
  scale?: number;
  seed?: number;
}

export interface GritBurstOptions extends BurstLightOptions {
  particleScale?: number;
  /** Granule colours (sRGB hex): dark and red track rubber by default. Match the set's tartan. */
  colors?: number[];
  /** Colour of the fine rubber dust (sRGB hex). */
  dustColor?: number;
  /** World Y of the track surface (default: origin.y). */
  floorY?: number;
  /** Kick speed multiplier (default 1). */
  strength?: number;
  seed?: number;
}

export interface DustBurstOptions extends BurstLightOptions {
  particleScale?: number;
  /** Radius (m) of the impact footprint the ring starts from (default 0.23, a bumper plate). */
  radius?: number;
  /** Dust colour (sRGB hex). */
  color?: number;
  density?: number;
  /** World Y of the floor (default: origin.y). */
  floorY?: number;
  seed?: number;
}

const DEFAULT_LIGHT_DIRECTION = new THREE.Vector3(-0.65, 0.55, -0.5).normalize();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tint = new THREE.Color();

/** Orthonormal basis (u, w) perpendicular to `axis` (normalised into _n). */
function basisFrom(axis: THREE.Vector3) {
  _n.copy(axis);
  if (_n.lengthSq() < 1e-10) _n.set(0, 1, 0);
  _n.normalize();
  _tmp.set(0, 1, 0);
  if (Math.abs(_n.y) > 0.9) _tmp.set(1, 0, 0);
  _u.crossVectors(_tmp, _n).normalize();
  _w.crossVectors(_n, _u).normalize();
}

function lookFrom(options: BurstLightOptions, defaults: Partial<SpriteLook>): SpriteLook {
  return {
    light: {
      direction: (options.lightDirection ?? DEFAULT_LIGHT_DIRECTION).clone().normalize(),
      color: options.lightColor ?? 0xffd6ad,
      intensity: options.lightIntensity ?? 5,
    },
    ambient: { color: options.ambientColor ?? 0x9aa3ad, intensity: options.ambientIntensity ?? 0.9 },
    phaseG: defaults.phaseG ?? 0.45,
    absorb: defaults.absorb ?? 0.5,
    floorY: defaults.floorY ?? -Infinity,
    floorSoftness: defaults.floorSoftness ?? 0.05,
    nearFade: defaults.nearFade ?? 0.2,
    roundness: defaults.roundness ?? 0.8,
  };
}

const range = (rng: () => number, min: number, max: number) => min + (max - min) * rng();

function setTint(defs: SpriteDefs, i: number, hex: number, jitter: number, rng: () => number) {
  _tint.setHex(hex);
  const k = 1 - jitter + 2 * jitter * rng();
  defs.tintR[i] = _tint.r * k;
  defs.tintG[i] = _tint.g * k;
  defs.tintB[i] = _tint.b * k;
}

function litBurst(cloud: SpriteCloud, object: THREE.Object3D, fill: (origin: THREE.Vector3, direction: THREE.Vector3) => void): LitBurst {
  let start = 0;
  let triggered = false;
  let duration = 0;
  return {
    object,
    trigger(origin, direction, startTime) {
      cloud.origin.copy(origin);
      fill(origin, direction);
      start = startTime;
      triggered = true;
      duration = cloud.duration();
    },
    update(time) {
      if (!triggered) return;
      cloud.evaluate(time - start);
    },
    reset() {
      triggered = false;
      cloud.hide();
    },
    setParticleScale(scale) {
      cloud.setScale(scale);
    },
    setLight(direction, color, intensity) {
      cloud.setLight(direction, color, intensity);
    },
    setAmbient(color, intensity) {
      cloud.setAmbient(color, intensity);
    },
    get duration() {
      return duration;
    },
    get active() {
      return cloud.liveCount > 0;
    },
    dispose() {
      cloud.dispose();
    },
  };
}

/**
 * Chalk clap: a soft billowing cloud squeezed out between two palms. `direction` is the
 * clap axis (palm to palm); the cloud jets out in the plane across it, rises a little on
 * warm air and curls apart over ~3 s. Hundreds of lit puffs plus bright specks that glitter
 * when backlit. Built to read in slow motion.
 */
export function createChalkBurst(options: ChalkBurstOptions = {}): LitBurst {
  const scale = options.particleScale ?? 1;
  const density = options.density ?? 1;
  const size = options.scale ?? 1;
  const puffs = Math.max(24, Math.round(380 * scale));
  const specks = Math.max(8, Math.round(120 * scale));
  const cloud = new SpriteCloud(puffs + specks, getPuffAtlas(), lookFrom(options, { phaseG: 0.42, absorb: 0.42, nearFade: 0.25, roundness: 0.45 }), "fx.chalk");
  cloud.turbulenceFrequency = 7 / size;
  cloud.turbulenceSpeed = 0.7;
  const seed = options.seed ?? 3307;

  const fill = (_origin: THREE.Vector3, direction: THREE.Vector3) => {
    const rng = createRng(seed);
    const defs = cloud.defs;
    basisFrom(direction);
    for (let i = 0; i < defs.capacity; i += 1) {
      const speck = i >= puffs;
      const phi = rng() * Math.PI * 2;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      // Spawn in a flat lens between the palms.
      const r0 = Math.sqrt(rng()) * 0.035 * size;
      const a0 = (rng() - 0.5) * 0.02 * size;
      const core = rng() < 0.22;
      const speed = speck ? range(rng, 1.1, 3) : core ? range(rng, 0.05, 0.35) : 0.35 + 1.7 * rng() ** 1.6;
      const axial = (rng() - 0.5) * (speck ? 0.9 : 0.55);
      const lift = speck ? range(rng, 0.0, 0.6) : range(rng, 0.05, 0.35);
      const ux = cos * _u.x + sin * _w.x;
      const uy = cos * _u.y + sin * _w.y;
      const uz = cos * _u.z + sin * _w.z;
      defs.px[i] = ux * r0 + _n.x * a0;
      defs.py[i] = uy * r0 + _n.y * a0;
      defs.pz[i] = uz * r0 + _n.z * a0;
      defs.vx[i] = (ux + _n.x * axial) * speed * size;
      defs.vy[i] = ((uy + _n.y * axial) * speed + lift) * size;
      defs.vz[i] = (uz + _n.z * axial) * speed * size;
      defs.dx[i] = (rng() - 0.5) * 0.05;
      defs.dy[i] = speck ? -range(rng, 0.04, 0.12) : range(rng, 0.02, 0.09);
      defs.dz[i] = (rng() - 0.5) * 0.05;
      defs.drag[i] = speck ? range(rng, 1.4, 2.4) : range(rng, 3.2, 5.2);
      defs.delay[i] = range(rng, 0, 0.06) + (core ? 0 : 0.01);
      defs.life[i] = speck ? range(rng, 1.2, 2.6) : range(rng, 1.8, 3.6);
      defs.fadeIn[i] = speck ? 0.02 : range(rng, 0.02, 0.07);
      if (speck) {
        defs.size0[i] = range(rng, 0.0035, 0.007) * size;
        defs.size1[i] = defs.size0[i] * 1.3;
        defs.growth[i] = 1;
        defs.alpha[i] = range(rng, 0.5, 0.95) * Math.min(1, density);
        defs.cell[i] = PUFF_CELL.speck;
        defs.turb[i] = 0.004 * size;
        setTint(defs, i, 0xffffff, 0.05, rng);
      } else {
        defs.size0[i] = range(rng, 0.022, 0.05) * size;
        defs.size1[i] = (core ? range(rng, 0.08, 0.15) : range(rng, 0.1, 0.26)) * size;
        defs.growth[i] = range(rng, 1.5, 3.2);
        defs.alpha[i] = (core ? range(rng, 0.2, 0.34) : range(rng, 0.07, 0.2)) * density;
        defs.cell[i] = Math.floor(rng() * 3);
        defs.turb[i] = range(rng, 0.015, 0.05) * size;
        setTint(defs, i, 0xf4f2ee, 0.06, rng);
      }
      defs.rot0[i] = rng() * Math.PI * 2;
      defs.spin[i] = (rng() - 0.5) * (speck ? 2 : 3.2);
    }
  };

  return litBurst(cloud, cloud.mesh, fill);
}

/**
 * Barbell drop: a ring of floor dust blasting out from the impact footprint along the floor,
 * rolling up and hanging in the light. `direction` is the floor normal (usually +Y). For a
 * loaded bar, trigger one burst under each plate.
 */
export function createDustBurst(options: DustBurstOptions = {}): LitBurst {
  const scale = options.particleScale ?? 1;
  const density = options.density ?? 1;
  const radius = options.radius ?? 0.23;
  const puffs = Math.max(24, Math.round(300 * scale));
  const specks = Math.max(8, Math.round(70 * scale));
  const color = options.color ?? 0xd8d0c4;
  const cloud = new SpriteCloud(puffs + specks, getPuffAtlas(), lookFrom(options, { phaseG: 0.4, absorb: 0.62, nearFade: 0.3, roundness: 0.45, floorSoftness: 0.07 }), "fx.dust");
  cloud.turbulenceFrequency = 5;
  cloud.turbulenceSpeed = 0.55;
  const seed = options.seed ?? 8821;

  const fill = (origin: THREE.Vector3, direction: THREE.Vector3) => {
    const rng = createRng(seed);
    const defs = cloud.defs;
    basisFrom(direction);
    cloud.setFloor(options.floorY ?? origin.y - 0.005, 0.07);
    for (let i = 0; i < defs.capacity; i += 1) {
      const speck = i >= puffs;
      const skirt = !speck && rng() < 0.45;
      const phi = rng() * Math.PI * 2;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      const ux = cos * _u.x + sin * _w.x;
      const uy = cos * _u.y + sin * _w.y;
      const uz = cos * _u.z + sin * _w.z;
      const r0 = radius * range(rng, 0.55, 1.05);
      const h0 = speck ? range(rng, 0.005, 0.03) : skirt ? range(rng, 0.01, 0.04) : range(rng, 0.03, 0.12);
      defs.px[i] = ux * r0 + _n.x * h0;
      defs.py[i] = uy * r0 + _n.y * h0;
      defs.pz[i] = uz * r0 + _n.z * h0;
      const out = speck ? range(rng, 1.2, 3) : skirt ? range(rng, 2, 4.2) : range(rng, 0.6, 2.2);
      const up = speck ? range(rng, 0.6, 1.8) : skirt ? range(rng, 0.05, 0.3) : range(rng, 0.25, 0.9);
      defs.vx[i] = ux * out + _n.x * up;
      defs.vy[i] = uy * out + _n.y * up;
      defs.vz[i] = uz * out + _n.z * up;
      const rise = speck ? -0.6 : range(rng, 0.03, 0.12);
      defs.dx[i] = _n.x * rise + (rng() - 0.5) * 0.04;
      defs.dy[i] = _n.y * rise;
      defs.dz[i] = _n.z * rise + (rng() - 0.5) * 0.04;
      defs.drag[i] = speck ? range(rng, 1.2, 2) : skirt ? range(rng, 2.2, 3.4) : range(rng, 2.6, 4.2);
      defs.delay[i] = range(rng, 0, 0.035);
      defs.life[i] = speck ? range(rng, 0.8, 1.6) : range(rng, 2.6, 4.6);
      defs.fadeIn[i] = speck ? 0.01 : range(rng, 0.03, 0.08);
      if (speck) {
        defs.size0[i] = range(rng, 0.004, 0.009);
        defs.size1[i] = defs.size0[i];
        defs.growth[i] = 1;
        defs.alpha[i] = range(rng, 0.4, 0.8) * Math.min(1, density);
        defs.cell[i] = PUFF_CELL.speck;
        defs.turb[i] = 0.003;
        setTint(defs, i, color, 0.08, rng);
      } else {
        defs.size0[i] = range(rng, 0.05, 0.1);
        defs.size1[i] = skirt ? range(rng, 0.22, 0.42) : range(rng, 0.3, 0.62);
        defs.growth[i] = range(rng, 1.1, 2.3);
        defs.alpha[i] = (skirt ? range(rng, 0.14, 0.3) : range(rng, 0.08, 0.22)) * density;
        defs.cell[i] = Math.floor(rng() * 3);
        defs.turb[i] = range(rng, 0.03, 0.08);
        setTint(defs, i, color, 0.07, rng);
      }
      defs.rot0[i] = rng() * Math.PI * 2;
      defs.spin[i] = (rng() - 0.5) * 2.4;
    }
  };

  return litBurst(cloud, cloud.mesh, fill);
}

/**
 * Sprinter's toe-off: dark and red rubber granules flicked off the track plus a faint puff
 * of fine dust. `direction` is the kick direction (backwards and up from the toe, e.g.
 * (0, 0.55, -1) for a runner heading +Z). Granules fly ballistically, bounce twice and rest.
 */
export function createGritBurst(options: GritBurstOptions = {}): ParticleBurst {
  const scale = options.particleScale ?? 1;
  const strength = options.strength ?? 1;
  const seed = options.seed ?? 1207;
  const granuleCount = Math.max(12, Math.round(110 * scale));
  const dustCount = Math.max(8, Math.round(70 * scale));
  const group = new THREE.Group();
  group.name = "fx.grit";
  const granules = new GranuleCloud(granuleCount, options.colors ?? [0x8f3326, 0xa6402c, 0x6e2a20, 0x2a2523, 0x3b2b26], seed);
  const dust = new SpriteCloud(
    dustCount,
    getPuffAtlas(),
    lookFrom(options, { phaseG: 0.35, absorb: 0.6, nearFade: 0.06, roundness: 0.6, floorSoftness: 0.012 }),
    "fx.grit.dust",
  );
  dust.turbulenceFrequency = 30;
  dust.turbulenceSpeed = 0.8;
  group.add(granules.mesh, dust.mesh);
  const dustColor = options.dustColor ?? 0xb0644e;

  let start = 0;
  let triggered = false;
  let duration = 0;

  return {
    object: group,
    trigger(origin, direction, startTime) {
      const rng = createRng(seed);
      const floorY = options.floorY ?? origin.y;
      granules.origin.copy(origin);
      granules.floorY = floorY;
      dust.origin.copy(origin);
      dust.setFloor(floorY - 0.002, 0.012);
      // Kick frame: _n = kick direction, _u lateral (along the toe), _w completes it.
      basisFrom(direction);
      const defs: GranuleDef[] = [];
      for (let i = 0; i < granuleCount; i += 1) {
        // Cone around the kick direction, biased upward a little.
        const theta = Math.sqrt(rng()) * 0.6;
        const phi = rng() * Math.PI * 2;
        const st = Math.sin(theta);
        const dx = _n.x * Math.cos(theta) + (_u.x * Math.cos(phi) + _w.x * Math.sin(phi)) * st;
        const dy = _n.y * Math.cos(theta) + (_u.y * Math.cos(phi) + _w.y * Math.sin(phi)) * st;
        const dz = _n.z * Math.cos(theta) + (_u.z * Math.cos(phi) + _w.z * Math.sin(phi)) * st;
        const speed = (0.5 + 2.1 * rng() ** 1.4) * strength;
        const radius = range(rng, 0.0011, 0.0032);
        const lateral = (rng() - 0.5) * 0.07;
        const back = (rng() - 0.5) * 0.03;
        const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
        if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
        axis.normalize();
        defs.push({
          px: _u.x * lateral + _n.x * back,
          py: radius + Math.max(0, floorY - origin.y) + rng() * 0.004,
          pz: _u.z * lateral + _n.z * back,
          vx: dx * speed,
          vy: dy * speed + range(rng, 0.1, 0.7) * strength,
          vz: dz * speed,
          delay: range(rng, 0, 0.06),
          radius,
          sx: range(rng, 0.8, 1.25),
          sy: range(rng, 0.6, 1),
          sz: range(rng, 0.8, 1.25),
          axis,
          spin: (rng() - 0.5) * 70,
          rot0: rng() * Math.PI * 2,
        });
      }
      granules.setDefs(defs);

      const sd = dust.defs;
      for (let i = 0; i < sd.capacity; i += 1) {
        const lateral = (rng() - 0.5) * 0.06;
        const speed = range(rng, 0.25, 1.1) * strength;
        const spread = (rng() - 0.5) * 0.9;
        sd.px[i] = _u.x * lateral;
        sd.py[i] = range(rng, 0.002, 0.012);
        sd.pz[i] = _u.z * lateral;
        sd.vx[i] = (_n.x + _u.x * spread) * speed;
        sd.vy[i] = (_n.y * 0.6 + 0.2) * speed;
        sd.vz[i] = (_n.z + _u.z * spread) * speed;
        sd.dx[i] = 0;
        sd.dy[i] = range(rng, -0.01, 0.03);
        sd.dz[i] = 0;
        sd.drag[i] = range(rng, 3.5, 6.5);
        sd.delay[i] = range(rng, 0, 0.05);
        sd.life[i] = range(rng, 0.7, 1.7);
        sd.fadeIn[i] = 0.02;
        sd.size0[i] = range(rng, 0.006, 0.014);
        sd.size1[i] = range(rng, 0.035, 0.09);
        sd.growth[i] = range(rng, 2, 4);
        sd.alpha[i] = range(rng, 0.05, 0.16);
        sd.cell[i] = Math.floor(rng() * 3);
        sd.turb[i] = range(rng, 0.003, 0.01);
        setTint(sd, i, dustColor, 0.1, rng);
        sd.rot0[i] = rng() * Math.PI * 2;
        sd.spin[i] = (rng() - 0.5) * 3;
      }
      start = startTime;
      triggered = true;
      duration = Math.max(dust.duration(), 3.2);
    },
    update(time) {
      if (!triggered) return;
      const age = time - start;
      granules.evaluate(age);
      dust.evaluate(age);
    },
    reset() {
      triggered = false;
      granules.hide();
      dust.hide();
    },
    setParticleScale(value) {
      granules.setScale(value);
      dust.setScale(value);
    },
    get duration() {
      return duration;
    },
    get active() {
      return granules.mesh.visible || dust.liveCount > 0;
    },
    dispose() {
      granules.dispose();
      dust.dispose();
    },
  };
}
