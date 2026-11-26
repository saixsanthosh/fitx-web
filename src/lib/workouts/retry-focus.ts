"use client";

/**
 * "Try again" after a failed load (D5; release 3 fix round 3d). Pressing it swaps the message, button and all, for a
 * loading state, so keyboard focus fell to the page body and was still there when the reload ended: Tab started again
 * at the top of the page and a screen reader said nothing. Once the reload ends, focus now goes to the heading of what
 * loaded (the page's own, or the block's: the Today card, Your note, Alternatives…), or, when it failed again, to the
 * new Try again, which carries the message for screen readers (aria-describedby).
 *
 * Only after a press of Try again (a first load moves nothing), and only when focus was lost on the way: a member who
 * has moved it somewhere that is still there meanwhile keeps it there.
 */
import { useCallback, useEffect, useRef } from "react";
import { focusControl, focusHeading, type FocusOptions, type HeadingLookup } from "./focus-heading";

/** Where a load stands: still loading, done, or failed (a Try again is shown). */
export type ReloadPhase = "loading" | "ready" | "failed";
/** The id of the heading of what loads, and of the Try again shown when it fails. */
export type RetryIds = { heading: string; retry: string };

/** Where focus goes once a reload started by Try again has ended; nowhere yet while it is still loading. Pure. */
export function retryFocusTarget(phase: ReloadPhase): "heading" | "retry" | null {
  if (phase === "loading") return null;
  return phase === "failed" ? "retry" : "heading";
}

/**
 * Moves focus as retryFocusTarget says, when focus was lost: to the new Try again, else to the heading (focusable by
 * script only). A failure without a Try again of its own (a page that kept what it had and says why at its top) goes to
 * the heading too. True when focus moved.
 */
export function focusAfterReload(page: HeadingLookup, phase: ReloadPhase, ids: RetryIds, options: FocusOptions = {}): boolean {
  const target = retryFocusTarget(phase);
  if (!target) return false;
  if (target === "retry" && focusControl(page, ids.retry, options)) return true;
  return focusHeading(page, ids.heading, options);
}

/**
 * For a page or block with a Try again. Call the function it returns as Try again is pressed, before the reload
 * starts; once `phase` has then left "loading", focus moves once (focusAfterReload). `keepScroll` for a block inside a
 * page, so a touch or mouse member's page stays where it is.
 */
export function useRetryFocus(phase: ReloadPhase, ids: RetryIds, options: FocusOptions = {}): () => void {
  const pressed = useRef(false);
  const { heading, retry } = ids;
  const keepScroll = Boolean(options.keepScroll);
  useEffect(() => {
    if (!pressed.current || phase === "loading") return;
    pressed.current = false;
    focusAfterReload(document, phase, { heading, retry }, { keepScroll });
  }, [phase, heading, retry, keepScroll]);
  return useCallback(() => { pressed.current = true; }, []);
}
