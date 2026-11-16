/** FNV-1a: a stable 32-bit hash, so the same seed always picks the same exercises. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A stable number in [0, 1) for this seed and key. */
export function seededUnit(seed: string, key: string): number {
  return hashString(`${seed}\u0000${key}`) / 0x1_0000_0000;
}
