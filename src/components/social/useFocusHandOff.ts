"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { focusAfterLastPage, focusHandOff } from "@/lib/social/focus";

/** A callback ref for the control that may leave the page, and whether focus is in it now. */
export type FocusHandOff = readonly [ref: (element: HTMLElement | null) => (() => void) | undefined, holds: () => boolean];

/**
 * Keeps keyboard focus on the page when a control leaves it while it has focus, with nothing pressed to say where focus
 * goes next (D5): a "Show more" that goes once the last page is in, a step of the video picker, the first-time Explore
 * setup. Put the returned ref on the control, or on the group that holds it. When it leaves the page with focus inside,
 * focus moves to `target()` in the same commit, once the new content is on the page (so `target` sees the new state).
 * Nothing moves when focus was elsewhere, or when something on the new page has taken it already. The second item says
 * whether focus is in it now.
 */
export function useFocusHandOff(target: () => HTMLElement | null): FocusHandOff {
  const [handOff] = useState(focusHandOff);
  const latest = useRef(target);
  const node = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    latest.current = target;
    if (handOff.settled(document)) latest.current()?.focus();
  });
  // Stable, so React detaches it only when the element goes: React calls the cleanup before it takes the element off the
  // page, while it is still there and focus can still be inside it.
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    node.current = element;
    return () => {
      handOff.left(element);
      if (node.current === element) node.current = null;
    };
  }, [handOff]);
  const holds = useCallback(() => {
    const element = node.current;
    return Boolean(element?.contains(element.ownerDocument.activeElement));
  }, []);
  return [ref, holds];
}

/**
 * useFocusHandOff for a list's "Show more" (or a conversation's "Show earlier messages"). `ids` are the list's items in
 * the order it shows them. When the button goes with focus on it because the last page has come in (pressed, or loaded
 * by scrolling while it had focus), focus moves to the first item that page added (`item(id)`), so the member carries
 * on where the new ones start; when it added none, to `end()` (the line saying the list is complete, or the last item).
 */
export function useShowMoreFocus(ids: readonly string[], item: (id: string) => HTMLElement | null, end: () => HTMLElement | null): FocusHandOff {
  const shown = useRef<readonly string[]>(ids);
  const added = useRef<string | null>(null);
  // Declared before the hand-off, so it runs first in the same commit: what this commit added to the list.
  useLayoutEffect(() => {
    added.current = focusAfterLastPage(shown.current, ids);
    shown.current = ids;
  });
  return useFocusHandOff(() => (added.current ? item(added.current) : null) ?? end());
}
