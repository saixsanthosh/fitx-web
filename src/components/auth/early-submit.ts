import type { RefObject } from "react";

/**
 * A press of Enter, or of a form's button, before the page's scripts have run (bug 3). The sign-in pages are drawn by
 * the server first, so their forms show seconds before React runs them on a slow phone or connection. A plain form
 * submitted then is sent by the browser itself, as a GET to the same page, which reloaded it, emptied every field and
 * dropped ?next=.
 *
 * Each auth form therefore has a function `action` beside its onSubmit. React renders such a form with an action URL
 * that can't go anywhere, and with it a small inline script of React's own (sent with the page) that holds a form
 * submitted before hydration and hands it to that action once the form is hydrated (React 19's form replaying). After
 * hydration, onSubmit handles every submission and calls preventDefault first, so React never calls the action then.
 *
 * The action only answers a held submission: it presses the form's submit once more, as soon as React has caught up,
 * so the held press goes through the same onSubmit as any other, with its checks, time limits and messages. By then
 * useKeepTypedValue has copied what was typed into state, and useKeepOpenState the open options panel, so the
 * submission is the one the member made: a code, a password sign-in, a sign-up or a reset.
 */

/** Presses `form`'s submit again once the current task is over (a microtask: after React's replay has returned). */
export function resubmitWhenReady(
  form: Pick<HTMLFormElement, "requestSubmit"> | null,
  later: (run: () => void) => void = queueMicrotask,
): void {
  if (!form) return;
  later(() => form.requestSubmit());
}

/**
 * The `action` for an auth form, given the form's ref: `<form ref={formRef} action={replay} onSubmit={submit}>`.
 * React replays a held submission with the hydration render's own action; it reads the form from the ref when it
 * runs, so any render's action does the same.
 */
export function useEarlySubmit(form: RefObject<HTMLFormElement | null>): () => void {
  return () => resubmitWhenReady(form.current);
}
