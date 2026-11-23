/**
 * The welcome film's timing contract (BRIEF-2 3.3), shared by its director def, its overlay, the runtime and the
 * cue sheets of the mix. Times are seconds of film time. Seeded by C0; film-welcome owns this file afterwards.
 *
 * The score is owner-approved file #5, "Cinematic Dark Hit Logo" (Alex_Kizenkov, Pixabay; 12.04 s, SHA-256
 * 4d1b5cf1…e370ad9e in .alteration/audio/CREDITS.md). The mix plays it at full length from 0 s, so score time is
 * film time.
 *
 * Measured by C0 on 2026-11-23 with ffmpeg 8.1.1 on the original (decoded to mono 44.1 kHz):
 * - `astats` RMS per 10 ms: a swell from silence (about -37 dBFS) to the first arrival at 1.40 s, a loud body from
 *   about 2.1 s to 7.8 s (-2 to -5 dBFS), a decaying tail of echoes from 7.9 s, and silence after 11.7 s.
 * - An onset scan in 10 ms hops on three bands (lowpass 150 Hz, 150 Hz to 2.5 kHz, highpass 2.5 kHz): each band's
 *   level rise over the mean of the previous 80 ms, summed over the bands, peaks at least 120 ms apart, at least 10 dB
 *   and above -40 dBFS. The hits (seconds, summed rise in dB):
 *     0.25 (12.5), 0.49 (10.7), 0.86 (10.9), 1.40 (10.4), 2.15 (12.4), 2.40 (21.1, the cymbal crash, high band +14.5),
 *     3.60 (17.8), 4.48 (10.7), 4.71 (12.3), 4.88 (13.2), 5.47 (10.9), 5.61 (10.2), 5.86 (10.9), 6.12 (12.4),
 *     6.91 (10.3), 7.54 (10.2), 7.83 (18.8, the last full-level hit), 8.30 (13.7), 8.66 (13.8), 8.88 (18.1),
 *     9.29 (16.9), 9.68 (12.1).
 *   (The scan also fires at 0.05 s, where the file starts out of silence; that is not a hit.)
 *
 * Snapping: each planned stage start in BRIEF-2 3.3, [0, 1.6, 3.4, 5.0, 6.8, 9.4], moves to the strongest measured
 * hit within 0.25 s of it. Every window held exactly one hit:
 *   1.6 -> 1.40 (the swell's arrival), 3.4 -> 3.60, 5.0 -> 4.88, 6.8 -> 6.91, 9.4 -> 9.29 (the reveal).
 * The hits are accurate to the 10 ms hop. At 60 fps the first frame of each stage (the first at or after its
 * start) is 84, 216, 293, 415 and 558.
 */

export const WELCOME_DURATION = 12.0;

export const WELCOME_STAGE = {
  light: 0,
  maya: 1,
  leo: 2,
  dre: 3,
  crane: 4,
  ignite: 5,
} as const;

export type WelcomeStage = (typeof WELCOME_STAGE)[keyof typeof WELCOME_STAGE];

/** Film-time start of each stage, indexed by stage number, snapped to the score's hits (see above). */
export const WELCOME_STAGE_START: readonly number[] = [0, 1.4, 3.6, 4.88, 6.91, 9.29];

/** Every hit the onset scan measured in score #5 (seconds), for the shots' accents and the cue sheets. */
export const WELCOME_SCORE_HITS: readonly number[] = [
  0.25, 0.49, 0.86, 1.4, 2.15, 2.4, 3.6, 4.48, 4.71, 4.88, 5.47, 5.61, 5.86, 6.12, 6.91, 7.54, 7.83, 8.3, 8.66, 8.88,
  9.29, 9.68,
];

export function welcomeStageAt(time: number): WelcomeStage {
  let stage = 0;
  for (let index = 0; index < WELCOME_STAGE_START.length; index += 1) {
    if (time >= WELCOME_STAGE_START[index]) stage = index;
  }
  return stage as WelcomeStage;
}

/**
 * The shots, one per stage, in order (D5 (a): the three athletes; D5 (b) replaces them with the new lead and keeps
 * the times). Only the studio and gym sets are used.
 */
export const WELCOME_SHOTS = [
  { id: "w0-light", stage: WELCOME_STAGE.light, start: 0, end: 1.4, note: "Strip light flickers on; dust in the beam; macro chalk." },
  { id: "w1-maya", stage: WELCOME_STAGE.maya, start: 1.4, end: 3.6, note: "Maya loads plate 1." },
  { id: "w2-leo", stage: WELCOME_STAGE.leo, start: 3.6, end: 4.88, note: "Leo loads plate 2." },
  { id: "w3-dre", stage: WELCOME_STAGE.dre, start: 4.88, end: 6.91, note: "Dre loads the big plate, in slow motion." },
  { id: "w4-crane", stage: WELCOME_STAGE.crane, start: 6.91, end: 9.29, note: "Crane to top-down: the bar, plates and floor lines align into the mark." },
  { id: "w5-ignite", stage: WELCOME_STAGE.ignite, start: 9.29, end: WELCOME_DURATION, note: "The lines ignite in FITX_MARK_ENTRY order; the DOM LogoReveal film-end locks over them." },
] as const;

export type WelcomeShotId = (typeof WELCOME_SHOTS)[number]["id"];
