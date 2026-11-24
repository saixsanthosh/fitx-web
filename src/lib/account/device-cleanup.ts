import { FILM_SEEN_KEY } from "@/components/brand/introKeys";
import { HOME_WORKOUT_SETS_KEY } from "@/lib/home-workout/log";
import { UNFINISHED_KEY } from "@/lib/home-workout/save";

type Store = Pick<Storage, "length" | "key" | "removeItem">;

/** Recent exercise searches and recently viewed exercises, kept per account in this browser. */
const EXERCISE_RECENTS = /^fitx:exercise:v1:[^:]+:(recent|searches)$/;
/** Saved exercises waiting in this browser for the account's table: kept at sign-out, gone with the account. */
const EXERCISE_FAVORITES = /^fitx:exercise:v1:[^:]+:favorites$/;

function keys(storage: Store): string[] {
  const found: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) found.push(key);
  }
  return found;
}

/**
 * Removes what this browser keeps about the signed-in account, so the next person on a shared device does not see
 * it: the tab's unsaved Home workout sets, the per-account exercise recents (and, once the account is deleted, its
 * saved exercises waiting here) and when this account's welcome film started here (FILM_SEEN_KEY), which would
 * otherwise skip the next account's film. Device settings such as the theme, the voice and household measures stay.
 * The httpOnly cookies that hold the account ID are cleared by the proxy on the next request without a session.
 */
export function forgetAccountOnDevice(
  { local, session }: { local: Store | null; session: Pick<Storage, "removeItem"> | null },
  { deleted = false }: { deleted?: boolean } = {},
): void {
  try {
    session?.removeItem(HOME_WORKOUT_SETS_KEY);
    session?.removeItem(UNFINISHED_KEY);
  } catch {
    // Blocked storage: nothing was kept there either.
  }
  if (!local) return;
  try {
    for (const key of keys(local)) {
      if (EXERCISE_RECENTS.test(key) || key === FILM_SEEN_KEY || (deleted && EXERCISE_FAVORITES.test(key))) local.removeItem(key);
    }
  } catch {
    // As above.
  }
}

/** forgetAccountOnDevice over this browser's own storage. */
export function forgetAccountInBrowser(options: { deleted?: boolean } = {}): void {
  const pick = (name: "localStorage" | "sessionStorage") => {
    try {
      return typeof window === "undefined" ? null : window[name];
    } catch {
      return null;
    }
  };
  forgetAccountOnDevice({ local: pick("localStorage"), session: pick("sessionStorage") }, options);
}
