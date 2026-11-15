const STORAGE_VERSION = "v1";

function storageKey(userId: string, kind: "favorites" | "recent") {
  return `fitx:exercise:${STORAGE_VERSION}:${userId}:${kind}`;
}

function readIds(userId: string, kind: "favorites" | "recent"): string[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId, kind)) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeIds(userId: string, kind: "favorites" | "recent", ids: string[]) {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(storageKey(userId, kind), JSON.stringify(ids));
  } catch {
    // Browser storage may be disabled or full; the rest of the library remains usable.
  }
}

export function readExerciseFavorites(userId: string) {
  return readIds(userId, "favorites");
}

export function toggleExerciseFavorite(userId: string, exerciseId: string) {
  const current = readIds(userId, "favorites");
  const next = current.includes(exerciseId)
    ? current.filter((id) => id !== exerciseId)
    : [exerciseId, ...current];
  writeIds(userId, "favorites", next);
  return next;
}

export function readRecentExercises(userId: string) {
  return readIds(userId, "recent");
}

export function rememberExercise(userId: string, exerciseId: string) {
  const next = [exerciseId, ...readIds(userId, "recent").filter((id) => id !== exerciseId)].slice(0, 8);
  writeIds(userId, "recent", next);
  return next;
}
