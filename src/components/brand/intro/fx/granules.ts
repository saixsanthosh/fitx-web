/**
 * Track-rubber granules kicked up by a spike (main thread). Real little chunks — instanced
 * irregular geometry lit by the film's light rig — because in the 100 mm macro they are
 * tens of pixels across and soft sprites would read as blur. Flight is analytic (gravity,
 * two damped bounces on the floor plane, then rest), so any time can be evaluated directly.
 */

import * as THREE from "three";
import { createRng } from "../math";

const GRAVITY = 9.81;
const RESTITUTION = 0.32;
const FRICTION = 0.55;

/** One lumpy rubber crumb, flat shaded; shared by every grit burst. */
let granuleGeometry: THREE.BufferGeometry | null = null;
function getGranuleGeometry() {
  if (granuleGeometry) return granuleGeometry;
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute("position");
  const rng = createRng(5113);
  // Displace each unique corner consistently so the crumb stays watertight.
  const offsets = new Map<string, number>();
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let scale = offsets.get(key);
    if (scale === undefined) {
      scale = 0.72 + 0.5 * rng();
      offsets.set(key, scale);
    }
    position.setXYZ(i, x * scale, y * scale * 0.82, z * scale);
  }
  geometry.computeVertexNormals();
  granuleGeometry = geometry;
  return geometry;
}

interface GranuleDef {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  delay: number;
  radius: number;
  sx: number; sy: number; sz: number;
  axis: THREE.Vector3;
  spin: number;
  rot0: number;
}

const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

export class GranuleCloud {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly origin = new THREE.Vector3();
  floorY = 0;
  /** Seconds after landing before resting crumbs shrink away (they are dressing, not props). */
  restTime = 2.5;
  private defs: GranuleDef[] = [];
  private scale = 1;

  constructor(capacity: number, colors: number[], seed: number) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, flatShading: true });
    material.name = "fx.granule";
    this.mesh = new THREE.InstancedMesh(getGranuleGeometry(), material, capacity);
    this.mesh.name = "fx.grit.granules";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.count = 0;
    const rng = createRng(seed);
    for (let i = 0; i < capacity; i += 1) {
      _color.setHex(colors[Math.floor(rng() * colors.length) % colors.length]);
      _color.multiplyScalar(0.8 + 0.4 * rng());
      this.mesh.setColorAt(i, _color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get capacity() {
    return this.mesh.instanceMatrix.count;
  }

  setScale(scale: number) {
    this.scale = Math.max(0, Math.min(1, scale));
  }

  setDefs(defs: GranuleDef[]) {
    this.defs = defs;
  }

  /** Writes every crumb's transform at `age` seconds after the kick. */
  evaluate(age: number) {
    const n = Math.min(this.defs.length, Math.round(this.capacity * this.scale));
    let visible = 0;
    for (let i = 0; i < n; i += 1) {
      const d = this.defs[i];
      const t = age - d.delay;
      if (t < 0) {
        _matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _matrix);
        continue;
      }
      // Flight 1 until the crumb's underside meets the floor.
      const height = Math.max(0, d.py + this.origin.y - this.floorY - d.radius);
      const t1 = (d.vy + Math.sqrt(d.vy * d.vy + 2 * GRAVITY * height)) / GRAVITY;
      let x: number;
      let y: number;
      let z: number;
      let angle: number;
      let shrink = 1;
      if (t < t1) {
        x = d.px + d.vx * t;
        y = d.py + d.vy * t - 0.5 * GRAVITY * t * t;
        z = d.pz + d.vz * t;
        angle = d.rot0 + d.spin * t;
      } else {
        const impactVy = d.vy - GRAVITY * t1;
        const bx = d.px + d.vx * t1;
        const bz = d.pz + d.vz * t1;
        const floor = this.floorY - this.origin.y + d.radius;
        const v2y = -impactVy * RESTITUTION;
        const v2x = d.vx * FRICTION;
        const v2z = d.vz * FRICTION;
        const t2 = (2 * v2y) / GRAVITY;
        const u = Math.min(t - t1, t2);
        x = bx + v2x * u;
        y = floor + v2y * u - 0.5 * GRAVITY * u * u;
        z = bz + v2z * u;
        angle = d.rot0 + d.spin * t1 + d.spin * 0.4 * u;
        if (t - t1 > t2) {
          // Rested: a short slide, then stillness; shrink away after `restTime`.
          const slide = Math.min(t - t1 - t2, 0.12);
          x += v2x * FRICTION * slide;
          z += v2z * FRICTION * slide;
          const rest = t - t1 - t2;
          shrink = 1 - Math.min(1, Math.max(0, (rest - this.restTime) / 0.5));
        }
      }
      _position.set(this.origin.x + x, this.origin.y + y, this.origin.z + z);
      _quaternion.setFromAxisAngle(d.axis, angle);
      _scale.set(d.sx, d.sy, d.sz).multiplyScalar(d.radius * shrink);
      _matrix.compose(_position, _quaternion, _scale);
      this.mesh.setMatrixAt(i, _matrix);
      if (shrink > 0) visible += 1;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = visible > 0;
    return visible;
  }

  hide() {
    this.mesh.visible = false;
    this.mesh.count = 0;
  }

  dispose() {
    // The crumb geometry is shared and cached; only the material belongs to this cloud.
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

export type { GranuleDef };
