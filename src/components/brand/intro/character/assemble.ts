/**
 * Turns worker output (`CharacterMeshData`) into THREE objects on a rig (main thread).
 * OWNER: character-body (material / attribute plumbing: surfaces).
 *
 * - Skinned parts (body, clothing, shoes, ponytail) become `SkinnedMesh`es bound to the rig.
 * - Rigid parts (head, hair, helmet, …) are parented to their bone; their positions are already
 *   bone-local (relative to the joint), and bind rotations are identity, so no offset is needed.
 * - Hands: every pose is created, only the active one is visible. Parts are RIGHT hands; the left
 *   hand reuses the same geometry mirrored by a negative X scale under `hand_L` (three flips the
 *   winding for negative-determinant objects, so lighting and culling stay correct).
 * - The face rig (eyes, lids, brows, lashes) comes from `createFaceRig` on the head bone.
 * - Materials: the shared set, specialised per character (skin response from the cast, shoe
 *   surface by style) and per part (roughness, sides, micro-detail mask) via
 *   `cloneCharacterMaterial`, one derived material per combination.
 */

import * as THREE from "three";
import { createRig, bindSkinnedMesh, type Rig } from "../rig/three-rig";
import type { BoneName } from "../rig/skeleton";
import { createFaceRig, type FaceRig } from "./faceRig";
import { CAST } from "./cast";
import { cloneCharacterMaterial, hasMicroDetail, type DetailKind, type MaterialVariant } from "./materials";
import type { CharacterId, CharacterMeshData, HandPose, MaterialRole, MeshPart, ShoeStyle } from "./types";

export interface CharacterInstance {
  id: CharacterId;
  /** Add this to the scene; place/rotate it to stage the character. Contains the rig root. */
  group: THREE.Group;
  rig: Rig;
  face: FaceRig;
  /** Every created object by part name; left hands are `hand_L_${pose}`, right `hand_R_${pose}`. */
  meshes: Record<string, THREE.Object3D>;
  /** Shows one hand pose on a side (hides the others). Unknown poses are ignored. */
  setHandPose(side: "L" | "R", pose: HandPose): void;
  /** Shows/hides an accessory or any other part by name (e.g. "helmet", "sunglassesLens"). */
  setAccessoryVisible(name: string, visible: boolean): void;
  /** Removes the character from its parent and frees its geometries (materials are shared). */
  dispose(): void;
}

const HAND_PREFIX = "hand_";

function geometryOf(part: MeshPart, detailMask: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(part.colors, 3));
  // Micro-detail weight per vertex (normalized bytes); only when the material samples detail.
  if (detailMask && part.detail) geometry.setAttribute("fitxDetailMask", new THREE.BufferAttribute(part.detail, 1, true));
  if (part.skinIndex && part.skinWeight) {
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(part.skinIndex, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(part.skinWeight, 4));
  }
  geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
  if (part.morphs?.length) {
    // Expression morphs (relative deltas, driven by FaceRig.setExpression). The attribute set is
    // fixed per part, so the program variant never changes after the first compile.
    const morphs = part.morphs;
    geometry.morphAttributes.position = morphs.map((m) => Object.assign(new THREE.BufferAttribute(m.positions, 3), { name: m.name }));
    geometry.morphAttributes.normal = morphs.map((m) => new THREE.BufferAttribute(m.normals, 3));
    if (morphs.every((m) => m.colors)) geometry.morphAttributes.color = morphs.map((m) => new THREE.BufferAttribute(m.colors as Float32Array, 3));
    geometry.morphTargetsRelative = true;
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/** Shoe micro-detail per style: engineered knit, perforated microfibre, pebbled leather. */
const SHOE_DETAIL: Record<ShoeStyle, DetailKind> = { runner: "mesh", cycling: "microfiber", lifter: "leather" };

/** This character's own take on a role: its skin response, its shoes' surface. */
function characterVariant(id: CharacterId, role: MaterialRole): MaterialVariant | null {
  const spec = CAST[id];
  if (!spec) return null;
  if (role === "skin") return { skin: spec.skin.response ?? {} };
  if (role === "shoe") return { detail: SHOE_DETAIL[spec.outfit.shoes.style] };
  return null;
}

function materialFor(part: MeshPart, id: CharacterId, materials: Record<MaterialRole, THREE.Material>, derived: Map<string, THREE.Material>): THREE.Material {
  const base = materials[part.role];
  const own = characterVariant(id, part.role);
  const mask = !!part.detail && hasMicroDetail(base);
  if (!own && part.roughness === undefined && !part.doubleSided && !mask) return base;
  // Variants share one derived material per (role, roughness, side, mask) within a character;
  // `cloneCharacterMaterial` keeps the skin / micro-detail shader patches (clone() drops them).
  const key = `${part.role}|${part.roughness ?? "-"}|${part.doubleSided ? 2 : 0}|${mask ? "m" : "-"}`;
  let material = derived.get(key);
  if (!material) {
    material = cloneCharacterMaterial(base, { ...own, roughness: part.roughness, doubleSided: part.doubleSided, detailMask: mask });
    derived.set(key, material);
  }
  return material;
}

/**
 * Micro-detail weights for a shoe part that brings none: the shoe is one mesh of separately
 * meshed pieces (upper, sole slabs, overlays, laces, sock) and only the upper is knit. Pieces
 * share no vertices, so they are told apart by where they sit: soles hug the ground (bind-space
 * y), laces / tabs / stripes are small, and the sock rises well above the upper's collar.
 */
function shoeUpperMask(part: MeshPart, soleHeight: number): Uint8Array {
  const n = part.positions.length / 3;
  const P = part.positions, idx = part.indices;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]), b = find(idx[t + 1]);
    if (a !== b) parent[b] = a;
    const c = find(idx[t + 2]), r = find(a);
    if (c !== r) parent[c] = r;
  }
  const root = new Int32Array(n);
  const sumY = new Float64Array(n), maxY = new Float64Array(n).fill(-Infinity), count = new Int32Array(n), area = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = (root[i] = find(i));
    sumY[r] += P[i * 3 + 1];
    maxY[r] = Math.max(maxY[r], P[i * 3 + 1]);
    count[r] += 1;
  }
  let total = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    area[root[idx[t]]] += ar;
    total += ar;
  }
  const big: number[] = [];
  for (let r = 0; r < n; r += 1) {
    if (!count[r] || area[r] < 0.08 * total) continue;
    if (sumY[r] / count[r] < soleHeight + 0.006) continue;
    big.push(r);
  }
  // The sock: a big piece reaching ≥ 2 cm above every other big piece.
  const knit = big.filter((r) => big.length < 2 || big.some((o) => o !== r && maxY[r] < maxY[o] + 0.02));
  const keep = new Uint8Array(n);
  for (const r of knit) keep[r] = 1;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) mask[i] = keep[root[i]] ? 255 : 0;
  return mask;
}

/** Builds the character's objects on a fresh rig. `materials` comes from `createCharacterMaterials()`. */
export function assembleCharacter(data: CharacterMeshData, materials: Record<MaterialRole, THREE.Material>): CharacterInstance {
  const rig = createRig(data.bind);
  const group = new THREE.Group();
  group.name = `character-${data.id}`;
  group.add(rig.root);
  const meshes: Record<string, THREE.Object3D> = {};
  const geometries: THREE.BufferGeometry[] = [];
  const derived = new Map<string, THREE.Material>();
  const hands: Record<"L" | "R", Map<string, THREE.Object3D>> = { L: new Map(), R: new Map() };

  const finish = (object: THREE.Mesh, part: MeshPart) => {
    object.castShadow = part.castShadow ?? true;
    object.receiveShadow = part.receiveShadow ?? true;
    return object;
  };

  for (const source of data.parts) {
    const part = source.role === "shoe" && !source.detail && hasMicroDetail(materials.shoe) ? { ...source, detail: shoeUpperMask(source, data.bind.proportions.soleHeight) } : source;
    const material = materialFor(part, data.id, materials, derived);
    const geometry = geometryOf(part, hasMicroDetail(material));
    geometries.push(geometry);
    if (part.skinIndex && part.skinWeight) {
      const mesh = finish(new THREE.SkinnedMesh(geometry, material), part) as THREE.SkinnedMesh;
      mesh.name = part.name;
      group.add(mesh);
      bindSkinnedMesh(mesh, rig);
      meshes[part.name] = mesh;
      continue;
    }
    const bone: BoneName | undefined = part.rigidBone;
    if (bone && part.name.startsWith(HAND_PREFIX) && bone === "hand_R") {
      // `hand_${pose}`: right hand as authored, left hand mirrored across X.
      const pose = part.name.slice(HAND_PREFIX.length);
      for (const side of ["R", "L"] as const) {
        const mesh = finish(new THREE.Mesh(geometry, material), part);
        mesh.name = `hand_${side}_${pose}`;
        if (side === "L") mesh.scale.x = -1;
        rig.bones[`hand_${side}`].add(mesh);
        hands[side].set(pose, mesh);
        meshes[mesh.name] = mesh;
      }
      continue;
    }
    const mesh = finish(new THREE.Mesh(geometry, material), part);
    mesh.name = part.name;
    if (bone) rig.bones[bone].add(mesh);
    else group.add(mesh);
    meshes[part.name] = mesh;
  }

  const setHandPose = (side: "L" | "R", pose: HandPose) => {
    const poses = hands[side];
    if (!poses.has(pose)) return;
    for (const [name, mesh] of poses) mesh.visible = name === pose;
  };
  const defaultPose: HandPose = hands.R.has("relaxed") ? "relaxed" : ((hands.R.keys().next().value as HandPose | undefined) ?? "relaxed");
  setHandPose("L", defaultPose);
  setHandPose("R", defaultPose);

  const expressive = data.parts.filter((p) => p.morphs?.length).map((p) => meshes[p.name]).filter((m): m is THREE.Mesh => (m as THREE.Mesh)?.isMesh === true);
  const face = createFaceRig(data.face, rig.bones.head, expressive);

  return {
    id: data.id,
    group,
    rig,
    face,
    meshes,
    setHandPose,
    setAccessoryVisible: (name, visible) => {
      const object = meshes[name];
      if (object) object.visible = visible;
    },
    dispose: () => {
      face.dispose();
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of derived.values()) material.dispose();
      derived.clear();
    },
  };
}
