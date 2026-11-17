import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false while the server renders and during hydration, true afterwards. Anything that depends on the viewer's
 * clock, time zone or locale (which the server, in UTC, or a page prerendered at build time cannot know) renders
 * only once this is true, so the server's HTML always matches the first render in the browser.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
