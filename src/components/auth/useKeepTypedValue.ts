"use client";

import { useLayoutEffect, useSyncExternalStore, type RefObject } from "react";

/**
 * What a field holds once React takes over the server-rendered page, when that is not what React's state says: text
 * typed (or restored or autofilled by the browser) before the page's JavaScript ran, or a <details> opened by then.
 * null when there is nothing to keep.
 */
export function valueToKeep<T extends string | boolean>(live: T | null | undefined, state: T): T | null {
  return live === null || live === undefined || live === state ? null : live;
}

/**
 * Keeps text typed into a controlled field before the page hydrated. React hydrates the field and leaves the typed
 * text in the DOM, but its state is still the server's empty value, and the forms render again right after hydration
 * (useReducedMotionSafe and useHydrated change then), which would write that empty value over what was typed. So on
 * mount, in the hydration's own commit and before that render, the field's live value is copied into state.
 */
export function useKeepTypedValue(ref: RefObject<HTMLInputElement | null>, value: string, setValue: (next: string) => void): void {
  useLayoutEffect(() => {
    const keep = valueToKeep(ref.current?.value, value);
    if (keep !== null) setValue(keep);
    // On mount only: from then on the field's onChange keeps its state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * The same for a <details> opened before the page hydrated: its toggle event fired before React was listening, so
 * React's state still says closed while the panel shows open.
 */
export function useKeepOpenState(ref: RefObject<HTMLDetailsElement | null>, open: boolean, setOpen: (next: boolean) => void): void {
  useLayoutEffect(() => {
    const keep = valueToKeep(ref.current?.open, open);
    if (keep !== null) setOpen(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const never = () => () => {};

/**
 * False on the server and while the page hydrates, true from the render after it (and on a page opened in the
 * browser). The auth forms mark themselves `data-hydrated` with it, so tests and checks can tell when they work.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(never, () => true, () => false);
}
