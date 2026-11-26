import type { RecorderPhase } from "./recorder";

/*
 * The Record screen's controls that give way to others (D5): Lock to "Hold to unlock" and back, "Allow location" to
 * Start. The pressed control goes, so the browser drops focus to the page; instead focus moves to the control that took
 * its place. Pure, so `node --test` can check it: the screen focuses the element named here.
 */

export type RecordSwap =
  /** Lock was pressed: Lock, Pause and Finish gave way to "Hold to unlock". */
  | "locked"
  /** The hold finished: "Hold to unlock" gave way to Lock, Pause and Finish. */
  | "unlocked"
  /** "Allow location" went (location was asked for): Start took its place. */
  | "allowed"
  /** Location became blocked (or can't be used) while Start had focus: Start can't be pressed any more. */
  | "blocked";

/**
 * Where focus goes: the hold button, Lock, the middle recording control (Resume while paused), Start, or the note
 * saying why Start can't be pressed (location blocked, or a recording in another tab).
 */
export type RecordFocus = "unlock" | "lock" | "main" | "start" | "reason";

export type RecordScreenState = {
  phase: RecorderPhase;
  locked: boolean;
  /** "Allow location" is still offered. */
  needsPermission: boolean;
  /** Start can be pressed: location isn't blocked, the recorder is ready, and no other tab is recording. */
  startUsable: boolean;
  /** A note saying why Start can't be pressed is on screen (the location banner, or the other-tab note). */
  reasonShown: boolean;
};

/** The control that takes focus once the screen has drawn the swap, or null when nothing took the pressed one's place. */
export function focusAfterSwap(swap: RecordSwap, state: RecordScreenState): RecordFocus | null {
  const recording = state.phase === "recording" || state.phase === "paused";
  switch (swap) {
    case "locked":
      return state.locked && recording ? "unlock" : null;
    case "unlocked":
      // Lock and "Hold to unlock" are one control's two states: back to Lock (the first of Lock, Pause and Finish).
      if (state.locked) return null;
      return state.phase === "recording" ? "lock" : state.phase === "paused" ? "main" : null;
    case "allowed":
      // Start is offered only before recording (Resume of a restored recording hands focus to Pause instead).
      if (state.needsPermission || recording || state.phase === "finished") return null;
      return state.startUsable ? "start" : state.reasonShown ? "reason" : null;
    case "blocked":
      return !state.startUsable && state.reasonShown ? "reason" : null;
  }
}

/**
 * A key still held from the press that moved focus: its repeats reach the control focus moved to. A repeated Enter
 * would press it (Start a recording, lock the controls again, pause) and a held Space would on release, so the Record
 * screen's buttons ignore repeats (cancelling the repeated keydown stops both). A fresh press is never a repeat.
 */
export function isHeldKeyRepeat(event: { key: string; repeat: boolean }): boolean {
  return event.repeat && (event.key === "Enter" || event.key === " ");
}

/** The buttons' keydown handler for `isHeldKeyRepeat`. */
export function ignoreHeldKey(event: { key: string; repeat: boolean; preventDefault(): void }): void {
  if (isHeldKeyRepeat(event)) event.preventDefault();
}
