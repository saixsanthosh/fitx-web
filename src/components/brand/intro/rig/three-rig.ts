/**
 * Builds a THREE.Skeleton from the worker-safe bind pose contract (`rig/skeleton.ts`).
 * Main thread only. Shared by character assembly and the motion system.
 */

import * as THREE from "three";
import { BONE_NAMES, BONE_COUNT, type BindPose, type BoneName } from "./skeleton";

export interface Rig {
  bind: BindPose;
  /** The `root` bone; add it to the character's group. */
  root: THREE.Bone;
  bones: Record<BoneName, THREE.Bone>;
  /** Bones in `BONE_NAMES` order (skin indices refer to this order). */
  list: THREE.Bone[];
  skeleton: THREE.Skeleton;
  /** Bind-pose local position of every bone (copy before mutating). */
  bindLocal: Record<BoneName, THREE.Vector3>;
  /** Restore identity rotations, unit scales and bind local positions. */
  resetPose(): void;
}

export function createRig(bind: BindPose): Rig {
  const list: THREE.Bone[] = [];
  const bones = {} as Record<BoneName, THREE.Bone>;
  const bindLocal = {} as Record<BoneName, THREE.Vector3>;

  BONE_NAMES.forEach((name, index) => {
    const bone = new THREE.Bone();
    bone.name = name;
    const x = bind.positions[index * 3];
    const y = bind.positions[index * 3 + 1];
    const z = bind.positions[index * 3 + 2];
    const parentIndex = bind.parents[index];
    if (parentIndex >= 0) {
      const px = bind.positions[parentIndex * 3];
      const py = bind.positions[parentIndex * 3 + 1];
      const pz = bind.positions[parentIndex * 3 + 2];
      bone.position.set(x - px, y - py, z - pz);
      list[parentIndex].add(bone);
    } else {
      bone.position.set(x, y, z);
    }
    bindLocal[name] = bone.position.clone();
    bones[name] = bone;
    list.push(bone);
  });

  // Bind rotations are identity, so each inverse bind matrix is a pure translation.
  const boneInverses = list.map((_, index) => new THREE.Matrix4().makeTranslation(
    -bind.positions[index * 3],
    -bind.positions[index * 3 + 1],
    -bind.positions[index * 3 + 2],
  ));
  const skeleton = new THREE.Skeleton(list, boneInverses);

  const resetPose = () => {
    for (let index = 0; index < BONE_COUNT; index += 1) {
      const bone = list[index];
      bone.quaternion.identity();
      bone.scale.set(1, 1, 1);
      bone.position.copy(bindLocal[BONE_NAMES[index]]);
    }
  };

  return { bind, root: bones.root, bones, list, skeleton, bindLocal, resetPose };
}

/**
 * Binds a skinned mesh whose geometry is authored in character bind space. The identity
 * bind matrix lets the owning group be moved freely after binding.
 */
export function bindSkinnedMesh(mesh: THREE.SkinnedMesh, rig: Rig) {
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  // Skinned characters move through bones, so their bind-pose bounds are not reliable.
  mesh.frustumCulled = false;
}
