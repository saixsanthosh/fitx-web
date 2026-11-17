import type { EquipmentProfiles } from "@/lib/training/data";
import { sortEquipmentKeys } from "@/lib/training/equipment";
import type { TrainingContext } from "@/lib/training/taxonomy";

/**
 * The member's saved Home and Gym lists as the library keeps them in memory (pure, for useLibraryAccount).
 */

/** The lists once `keys` has been saved for `context`; the other list is kept. */
export function withSavedList(profiles: EquipmentProfiles, context: TrainingContext, keys: readonly string[]): EquipmentProfiles {
  return { ...profiles, [context]: sortEquipmentKeys(keys) };
}

/**
 * The lists after reading them again. A failed read keeps what is known (including a list just saved) rather
 * than falling back to the starting lists; `failed` then stays as it was.
 */
export function afterProfilesReload(
  current: { profiles: EquipmentProfiles; failed: boolean },
  reloaded: { error: unknown; profiles: EquipmentProfiles },
): { profiles: EquipmentProfiles; failed: boolean } {
  if (reloaded.error) return current;
  return { profiles: reloaded.profiles, failed: false };
}
