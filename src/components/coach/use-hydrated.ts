import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false while the server renders and during hydration, true afterwards. Times are shown in the
 * viewer's own time zone, which the server (in UTC) cannot know, so they render only once this is true.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
