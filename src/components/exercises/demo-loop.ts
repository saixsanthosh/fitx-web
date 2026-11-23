/**
 * The photo demonstration's timing (DemoLoop): an exercise's real photos shown one after another as a repetition,
 * photo 1 → photo 2 → back to photo 1. Pure, so the rules are tested without a browser.
 *
 * One repetition visits every photo and returns to the first. With Loop on it repeats until paused; with Loop off it
 * stops after one repetition, back on the first photo. Replay starts a repetition from the first photo.
 */

/** How long a photo is held, then how long the blend into the next takes (ms, at normal speed). */
export const HOLD_MS = 900;
export const BLEND_MS = 650;
export const SPEEDS = [0.5, 1] as const;
export type DemoSpeed = (typeof SPEEDS)[number];

export type DemoState = {
  frame: number;
  playing: boolean;
  loop: boolean;
  /** Frames advanced in the current repetition. */
  steps: number;
};

export function initialDemoState(options: { autoplay: boolean; frames: number }): DemoState {
  return { frame: 0, playing: options.autoplay && options.frames > 1, loop: true, steps: 0 };
}

/** The next state when the hold-and-blend timer fires. */
export function advanceDemo(state: DemoState, frames: number): DemoState {
  if (!state.playing || frames < 2) return { ...state, playing: false };
  const frame = (state.frame + 1) % frames;
  const steps = state.steps + 1;
  const repetitionDone = frame === 0 && steps >= frames;
  if (repetitionDone && !state.loop) return { frame: 0, playing: false, loop: state.loop, steps: 0 };
  return { ...state, frame, steps: repetitionDone ? 0 : steps };
}

export function replayDemo(state: DemoState, frames: number): DemoState {
  return { ...state, frame: 0, steps: 0, playing: frames > 1 };
}

export function togglePlay(state: DemoState, frames: number): DemoState {
  return frames > 1 ? { ...state, playing: !state.playing } : state;
}

/** Choosing a photo pauses on it. */
export function showFrame(state: DemoState, frame: number, frames: number): DemoState {
  return { ...state, frame: Math.max(0, Math.min(frames - 1, Math.round(frame))), playing: false, steps: 0 };
}

/** Milliseconds between frames at a speed (slower speed, longer hold and blend). */
export function frameInterval(speed: number): number {
  const safe = speed > 0 ? speed : 1;
  return Math.round((HOLD_MS + BLEND_MS) / safe);
}

export function blendDuration(speed: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.round(BLEND_MS / (speed > 0 ? speed : 1));
}

/** "Photo 1 of 2", for the live region and the frame buttons. */
export function frameLabel(frame: number, frames: number): string {
  return frames > 1 ? `Photo ${frame + 1} of ${frames}` : "Photo";
}
