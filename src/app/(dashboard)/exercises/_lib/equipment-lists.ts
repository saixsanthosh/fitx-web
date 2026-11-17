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

/**
 * The note shown while the saved lists could not be read: a starting list stands in only for a list that is still
 * unknown (one saved since then is known, and is what the results use). Null when nothing failed or both are known.
 */
export function listsLoadNote(account: { profiles: EquipmentProfiles; failed: boolean }, context: TrainingContext): string | null {
  if (!account.failed) return null;
  if (account.profiles[context] === null) return "Your saved lists could not be loaded, so a starting list is used for now.";
  const other: TrainingContext = context === "home" ? "gym" : "home";
  if (account.profiles[other] !== null) return null;
  return `Your saved ${other === "home" ? "Home" : "Gym"} list could not be loaded, so a starting list is used there for now.`;
}
