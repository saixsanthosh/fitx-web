/**
 * In-world motion graphics for the refuel overhead shot: around each bowl, three thin concentric
 * arcs (protein, carbs, fat) draw themselves like the app's macro rings — each starts at 12 o'clock
 * and sweeps clockwise to its share, over a faint full-circle track. Pure function of `progress`.
 *
 * The group sits at the table top; each bowl's ring set is a child at its (x, z) centre, so one
 * prop serves both place settings and each set can be timed on its own (`setProgressAt`).
 */

import * as THREE from "three";
import type { Theme } from "../types";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The ring is a flat annulus; uv.x runs around it (0..1, counter-clockwise seen from above), uv.y
// across it (0 inner .. 1 outer). The arc runs the other way (clockwise) from uStart, with round
// caps at both ends and a brighter drawing head; the track is the whole annulus at low alpha.
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uStart;
  uniform float uSweep;
  uniform float uOpacity;
  uniform float uTrack;
  uniform float uCap;
  varying vec2 vUv;
  void main() {
    float across = vUv.y * 2.0 - 1.0;
    float track = uTrack * (1.0 - smoothstep(0.7, 1.0, abs(across)));
    float drawn = uSweep * clamp(uProgress, 0.0, 1.0);
    float arc = 0.0;
    float glint = 0.0;
    if (drawn > 0.0005) {
      float along = fract(uStart - vUv.x);
      // Outside the arc: distance past the head or before the (wrapped) tail, in half ring widths
      // (uCap = half width / circumference), so both ends get round caps.
      float outside = along <= drawn ? 0.0 : min((along - drawn) / uCap, (1.0 - along) / uCap);
      arc = 1.0 - smoothstep(0.75, 1.0, length(vec2(outside, across)));
      glint = smoothstep(drawn - 0.05, drawn, along) * step(along, drawn + uCap);
    }
    float alpha = max(arc, track) * uOpacity;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.3 * glint * arc), alpha);
  }
`;

type RingSpec = { inner: number; outer: number; sweep: number; light: number; dark: number; delay: number };

// Shares of the 612 kcal meal (P 42 g · C 64 g · F 18 g): protein 27 %, carbs 42 %, fat 26 % of energy.
// Sized to hug the bowl (rim radius 9.2 cm) with a clear gap, inside the napkin's outer edge.
// Light theme: coral, apricot and a warm cream — all read on pale oak without a heavy dark stroke.
const RINGS: RingSpec[] = [
  { inner: 0.105, outer: 0.112, sweep: 0.27, light: 0xc44933, dark: 0xff6f55, delay: 0 },
  { inner: 0.117, outer: 0.124, sweep: 0.42, light: 0xe8865a, dark: 0xffa07e, delay: 0.12 },
  { inner: 0.129, outer: 0.136, sweep: 0.26, light: 0xfff4e2, dark: 0xf3e6da, delay: 0.24 },
];
/** Peak alpha of the full-circle tracks under the arcs. */
const TRACK_ALPHA = 0.18;

export interface MacroRings {
  group: THREE.Group;
  /** 0..1 over the reveal for every bowl; each arc starts slightly after the previous one. */
  setProgress(progress: number): void;
  /** Same, for one bowl's ring set (index into the centres given at creation). */
  setProgressAt(index: number, progress: number): void;
  /** World (group-space) direction (x, z) of 12 o'clock, i.e. the screen's up on the table; arcs start there. */
  setStartDirection(x: number, z: number): void;
  setOpacity(opacity: number): void;
  applyTheme(theme: Theme): void;
  dispose(): void;
}

/** `centres`: bowl centres (x, z) relative to the group, one ring set each. */
export function createMacroRings(theme: Theme, centres: ReadonlyArray<readonly [number, number]> = [[0, 0]]): MacroRings {
  const group = new THREE.Group();
  group.name = "macro-rings";
  const geometries: THREE.BufferGeometry[] = [];
  const sets: THREE.ShaderMaterial[][] = [];
  const holders: THREE.Group[] = [];

  const segments = 160;
  const shapes = RINGS.map((spec) => {
    const geometry = new THREE.RingGeometry(spec.inner, spec.outer, segments, 1);
    // RingGeometry's default UVs are planar; rebuild them as (around, across). Its vertices are
    // laid out ring by ring with `segments + 1` per ring, so the seam vertex gets u = 1, not 0.
    const uv = geometry.attributes.uv;
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(index, (index % (segments + 1)) / segments, Math.floor(index / (segments + 1)));
    }
    uv.needsUpdate = true;
    // Flat on the table: u = 0 points along the holder's +X, increasing towards −Z.
    geometry.rotateX(-Math.PI / 2);
    geometries.push(geometry);
    return geometry;
  });

  for (const [cx, cz] of centres) {
    const holder = new THREE.Group();
    holder.position.set(cx, 0, cz);
    group.add(holder);
    holders.push(holder);
    const materials = RINGS.map((spec, index) => {
      // Half the ring width in "around" units at this radius (the round caps' radius).
      const cap = (spec.outer - spec.inner) / 2 / (2 * Math.PI * ((spec.inner + spec.outer) / 2));
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uColor: { value: new THREE.Color(theme === "dark" ? spec.dark : spec.light) },
          uProgress: { value: 0 },
          uStart: { value: 0 },
          uSweep: { value: spec.sweep },
          uOpacity: { value: 1 },
          uTrack: { value: 0 },
          uCap: { value: cap },
        },
      });
      material.userData.spec = spec;
      const mesh = new THREE.Mesh(shapes[index], material);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      holder.add(mesh);
      return material;
    });
    sets.push(materials);
  }

  const apply = (materials: THREE.ShaderMaterial[], progress: number) => {
    // The tracks fade in with the first few percent of the reveal, so nothing pops on.
    const track = TRACK_ALPHA * Math.min(1, Math.max(0, progress / 0.15));
    for (const material of materials) {
      const spec = material.userData.spec as RingSpec;
      const local = (progress - spec.delay) / (1 - spec.delay);
      material.uniforms.uProgress.value = 1 - Math.pow(1 - Math.min(1, Math.max(0, local)), 3);
      material.uniforms.uTrack.value = track;
    }
  };

  return {
    group,
    setProgress(progress) {
      for (const materials of sets) apply(materials, progress);
    },
    setProgressAt(index, progress) {
      const materials = sets[index];
      if (materials) apply(materials, progress);
    },
    setStartDirection(x, z) {
      // Turn each holder so its +X (u = 0) points at 12 o'clock; the arcs then run clockwise.
      const yaw = Math.atan2(-z, x);
      for (const holder of holders) holder.rotation.set(0, yaw, 0);
    },
    setOpacity(opacity) {
      for (const materials of sets) for (const material of materials) material.uniforms.uOpacity.value = opacity;
    },
    applyTheme(next) {
      for (const materials of sets) {
        for (const material of materials) {
          const spec = material.userData.spec as RingSpec;
          (material.uniforms.uColor.value as THREE.Color).setHex(next === "dark" ? spec.dark : spec.light);
        }
      }
    },
    dispose() {
      for (const materials of sets) materials.forEach((material) => material.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      group.removeFromParent();
    },
  };
}
