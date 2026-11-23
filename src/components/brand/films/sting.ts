import type { FilmAudio } from "./manifest";
import { readSoundPref } from "./filmSound";

type StingElement = { play(): Promise<void> | void };

/**
 * The returning-reveal sting (BRIEF-2 3.4): owner-approved sound #6, mixed by film-audio and shipped by S6 as
 * `RETURN_STING`. It plays once at the reveal's start only when the member turned film sound on (stored "on"), the
 * sting exists and reduced motion is off. A refusal stays silent: the reveal lasts 2 s, too short for a hint.
 * Returns whether it asked the browser to play.
 */
export function playReturnSting({
  sting,
  storage,
  reduced,
  createAudio,
}: {
  sting: FilmAudio | null;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reduced: boolean;
  createAudio: (src: string) => StingElement;
}): boolean {
  if (!sting || reduced || readSoundPref(storage) !== "on") return false;
  try {
    const played = createAudio(sting.src).play();
    if (played && typeof played.catch === "function") played.catch(() => undefined);
  } catch {
    return false;
  }
  return true;
}
