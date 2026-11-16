/**
 * Ponytail spring chain (main thread). OWNER: motion agent.
 *
 * Verlet particles at pony2, pony3, pony4 and the pony tip hang from pony1 (rigid on the
 * head). Forces: gravity, a rest-shape spring towards the head-attached bind shape (stiff at
 * the root, loose at the tip), air drag against the runner's motion (the tail streams back
 * at sprint speed), and a little deterministic flutter. Distance constraints keep segment
 * lengths; a skull sphere and a neck/upper-back capsule keep the hair outside the body.
 *
 * Determinism: the state only ever advances in fixed substeps from `startTime − preroll`, so
 * any frame sequence (or a seek) reproduces exactly the same result. `simulateTo` steps
 * forward from the last state, and re-simulates from the start when time goes backwards.
 */

import * as THREE from "three";
import type { Rig } from "../rig/three-rig";
import { noise1 } from "../math";
import { pointOf, type BoneName } from "../rig/skeleton";

export interface PonytailOptions {
  /** Simulation start (action time) — usually the shot or driver start. */
  startTime?: number;
  /** Seconds simulated before `startTime` to settle (default 0.6). */
  preroll?: number;
  /** Fixed substep in seconds (default 1/240). */
  substep?: number;
  /** Rest-shape stiffness at the root / tip (1/s², default 260 / 4). */
  stiffnessRoot?: number;
  stiffnessTip?: number;
  /** Velocity damping per second (default 1.6). */
  damping?: number;
  /** Damping of motion relative to the parent particle, per second (default 16). */
  bendDamping?: number;
  /** Air drag per second (default 1.7). */
  drag?: number;
  gravity?: number;
  /** Flutter acceleration amplitude (m/s², default 2.5). */
  flutter?: number;
  seed?: number;
}

const PONY: BoneName[] = ["pony1", "pony2", "pony3", "pony4"];
const N = 4;

const _m = new THREE.Matrix4();
const _hp = new THREE.Vector3();
const _hq = new THREE.Quaternion();
const _hs = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _from = new THREE.Vector3();
const _swing = new THREE.Quaternion();
const _skull = new THREE.Vector3();
const _rd = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Vector3();
/** Bending stiffness per particle in 1/s² (the first segment is held by the hair tie). */
const BEND = [900, 110, 75, 60];
const _neck = new THREE.Vector3();

export class PonytailSpring {
  readonly opts: Required<PonytailOptions>;
  /** Particle positions (world) at the last two substeps. */
  private readonly cur: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly rest: THREE.Vector3[] = [];
  private readonly acc: THREE.Vector3[] = [];
  private readonly anchorPrev = new THREE.Vector3();
  private anchorValid = false;
  private readonly lengths: number[] = [];
  private readonly anchorLocal = new THREE.Vector3();
  private readonly skullLocal = new THREE.Vector3();
  private readonly neckLocal = new THREE.Vector3();
  private readonly skullRadius: number;
  private step = -1;
  private ready = false;

  constructor(rig: Rig, opts: PonytailOptions = {}) {
    this.opts = {
      startTime: opts.startTime ?? 0,
      preroll: opts.preroll ?? 0.6,
      substep: opts.substep ?? 1 / 240,
      stiffnessRoot: opts.stiffnessRoot ?? 260,
      stiffnessTip: opts.stiffnessTip ?? 4,
      damping: opts.damping ?? 1.6,
      bendDamping: opts.bendDamping ?? 16,
      drag: opts.drag ?? 1.7,
      gravity: opts.gravity ?? 9.81,
      flutter: opts.flutter ?? 2.5,
      seed: opts.seed ?? 7,
    };
    const bind = rig.bind;
    const head = new THREE.Vector3(...pointOf(bind, "head"));
    const pts = [...PONY.map((n) => new THREE.Vector3(...pointOf(bind, n))), new THREE.Vector3(...pointOf(bind, "ponyTip"))];
    this.anchorLocal.copy(pts[0]).sub(head);
    for (let i = 0; i < N; i += 1) {
      this.rest.push(pts[i + 1].clone().sub(head));
      this.lengths.push(pts[i + 1].distanceTo(pts[i]));
      this.cur.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
      this.acc.push(new THREE.Vector3());
    }
    const H = bind.proportions.height;
    const eye = new THREE.Vector3(...pointOf(bind, "eyeMid"));
    const top = new THREE.Vector3(...pointOf(bind, "headTop"));
    // Skull sphere a little behind the eyes; radius reaches the scalp under the ponytail root.
    this.skullLocal.set(0, (eye.y + top.y) / 2 - head.y, -0.03 * (H / 1.68));
    this.skullRadius = 0.095 * (H / 1.68);
    this.neckLocal.set(0, -0.06 * (H / 1.68), -0.05 * (H / 1.68));
  }

  /** Forget the state; the next `simulateTo` re-simulates from `startTime`. */
  reset(startTime = this.opts.startTime) {
    this.opts.startTime = startTime;
    this.ready = false;
    this.anchorValid = false;
    this.step = -1;
  }

  private headTransform(rig: Rig) {
    const head = rig.bones.head;
    head.updateWorldMatrix(true, false);
    _m.copy(head.matrixWorld);
    _m.decompose(_hp, _hq, _hs);
  }

  private initialise(rig: Rig) {
    this.headTransform(rig);
    this.anchorValid = false;
    for (let i = 0; i < N; i += 1) {
      this.cur[i].copy(this.rest[i]).applyQuaternion(_hq).add(_hp);
      this.prev[i].copy(this.cur[i]);
    }
  }

  private integrate(rig: Rig, time: number) {
    const o = this.opts;
    const h = o.substep;
    this.headTransform(rig);
    const anchor = _a.copy(this.anchorLocal).applyQuaternion(_hq).add(_hp);
    const skull = _skull.copy(this.skullLocal).applyQuaternion(_hq).add(_hp);
    const neck = _neck.copy(this.neckLocal).applyQuaternion(_hq).add(_hp);
    const rootDir = _rd.copy(this.rest[0]).sub(this.anchorLocal).normalize().applyQuaternion(_hq);
    if (!this.anchorValid) {
      this.anchorPrev.copy(anchor);
      this.anchorValid = true;
    }
    const keep = 1 - o.damping * h;
    // Forces from the current state (explicit), then Verlet.
    for (let i = 0; i < N; i += 1) {
      const p = this.cur[i];
      const acc = this.acc[i];
      // Rest-shape spring towards the head-attached bind shape (stiff at the hair tie).
      const k = o.stiffnessRoot + ((o.stiffnessTip - o.stiffnessRoot) * i) / (N - 1);
      acc.copy(this.rest[i]).applyQuaternion(_hq).add(_hp).sub(p).multiplyScalar(k);
      // Bending spring towards the straight continuation of the parent segment.
      const p1 = i === 0 ? anchor : this.cur[i - 1];
      if (i === 0) _d.copy(rootDir);
      else _d.subVectors(p1, i === 1 ? anchor : this.cur[i - 2]).normalize();
      _t.copy(p1).addScaledVector(_d, this.lengths[i]).sub(p);
      acc.addScaledVector(_t, BEND[i]);
      acc.y -= o.gravity;
      // Air drag in still air opposes the particle's world velocity; bending damping opposes
      // motion relative to the parent particle so the tail whips as one smooth curve.
      _v.subVectors(p, this.prev[i]);
      acc.addScaledVector(_v, -o.drag / h);
      if (i > 0) {
        _w.subVectors(this.cur[i - 1], this.prev[i - 1]);
        acc.addScaledVector(_w.sub(_v), o.bendDamping / h);
      } else {
        _w.subVectors(anchor, this.anchorPrev);
        acc.addScaledVector(_w.sub(_v), o.bendDamping / h);
      }
      const f = (o.flutter * (i + 1)) / N;
      acc.x += f * noise1(time * 7.3 + i * 1.7, o.seed);
      acc.y += 0.5 * f * noise1(time * 5.1 + i * 2.3, o.seed + 1);
    }
    for (let i = 0; i < N; i += 1) {
      const p = this.cur[i];
      _v.subVectors(p, this.prev[i]);
      this.prev[i].copy(p);
      p.addScaledVector(_v, keep).addScaledVector(this.acc[i], h * h);
    }
    this.anchorPrev.copy(anchor);
    // Constraints: segment lengths (from the anchor out), skull and neck collisions.
    for (let iter = 0; iter < 3; iter += 1) {
      let parent = anchor;
      for (let i = 0; i < N; i += 1) {
        const p = this.cur[i];
        _d.subVectors(p, parent);
        const len = _d.length() || 1e-6;
        p.copy(parent).addScaledVector(_d, this.lengths[i] / len);
        parent = p;
      }
      for (let i = 0; i < N; i += 1) {
        const p = this.cur[i];
        const r = this.skullRadius + 0.012;
        _d.subVectors(p, skull);
        const dl = _d.length();
        if (dl < r) p.copy(skull).addScaledVector(_d, r / (dl || 1e-6));
        const rn = 0.07 * (this.skullRadius / 0.095);
        _d.subVectors(p, neck);
        const dn = _d.length();
        if (dn < rn) p.copy(neck).addScaledVector(_d, rn / (dn || 1e-6));
      }
    }
  }

  /**
   * Advances (or re-simulates) to action time t, then poses the rig at t and writes the
   * pony bones. `poseAt(time)` must fully pose the rig for any time (driver + layers).
   */
  simulateTo(rig: Rig, t: number, poseAt: (time: number) => void) {
    const o = this.opts;
    const h = o.substep;
    const t0 = o.startTime - o.preroll;
    const target = Math.max(0, Math.floor((t - t0) / h));
    // We hold the states of substeps (step − 1, step); going back past them means re-simulating.
    if (!this.ready || this.step > target + 1) {
      poseAt(t0);
      this.initialise(rig);
      this.step = 0;
      this.ready = true;
    }
    while (this.step < target + 1) {
      this.step += 1;
      const time = t0 + this.step * h;
      poseAt(time);
      this.integrate(rig, time);
    }
    // Interpolate between the last two substeps for the exact time.
    const frac = THREE.MathUtils.clamp((t - (t0 + (this.step - 1) * h)) / h, 0, 1);
    poseAt(t);
    this.apply(rig, frac);
  }

  private readonly blend: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  private apply(rig: Rig, frac: number) {
    for (let i = 0; i < N; i += 1) this.blend[i].lerpVectors(this.prev[i], this.cur[i], frac);
    for (let i = 0; i < N; i += 1) {
      const bone = rig.bones[PONY[i]];
      const parent = bone.parent!;
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(_hp, _pq, _hs);
      bone.updateWorldMatrix(true, false);
      const origin = _v.setFromMatrixPosition(bone.matrixWorld);
      // Bind segment direction carried by the parent's current rotation → particle direction.
      const end = i + 1 < N ? rig.bindLocal[PONY[i + 1]] : null;
      _from.copy(end ?? this.tipLocal(rig)).normalize().applyQuaternion(_pq);
      _d.subVectors(this.blend[i], origin).normalize();
      _swing.setFromUnitVectors(_from, _d);
      _q.copy(_pq).invert().multiply(_swing).multiply(_pq);
      bone.quaternion.copy(_q);
    }
  }

  private tipLocalCache: THREE.Vector3 | null = null;
  private tipLocal(rig: Rig) {
    if (!this.tipLocalCache) {
      const tip = new THREE.Vector3(...pointOf(rig.bind, "ponyTip"));
      const p4 = new THREE.Vector3(...pointOf(rig.bind, "pony4"));
      this.tipLocalCache = tip.sub(p4);
    }
    return this.tipLocalCache;
  }
}
