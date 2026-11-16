/**
 * Pure timing and number formatting for the intro's DOM motion graphics (`IntroFilmOverlay.tsx`).
 *
 * Everything is derived from `intro/timeline.ts`, so a re-timed film needs no overlay edits. The
 * overlay never runs a per-frame clock: when the scene reports a stage, each element starts CSS
 * animations whose delays are film times measured from that stage's `STAGE_START` (its *origin*).
 * No DOM, no React: safe to unit-test from Node.
 */

import { CALLOUTS, LETTERBOX, STAGE, STAGE_START, TITLES, stageAt } from "./intro/timeline";

export type FilmTitle = (typeof TITLES)[number];
export type FilmCallout = (typeof CALLOUTS)[number];
export type CalloutPlacement = FilmCallout["placement"];

/** Review freeze (dev only): every element of a stage at its resting frame, or the whole overlay at one film time. */
export type FilmFreeze = { kind: "stage"; stage: number } | { kind: "time"; time: number };

const LAST_STAGE = STAGE_START.length - 1;
/** An element stays mounted (already hidden by its exit) this long past its end, so a cut that lands a frame early never clips an exit. */
const LINGER = 0.35;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampStage(stage: number): number {
  return clamp(Math.round(Number.isFinite(stage) ? stage : 0), 0, LAST_STAGE);
}

/** Film time at which `stage` begins: the clock origin of everything that mounts when the scene reports it. */
export function stageStart(stage: number): number {
  return STAGE_START[clampStage(stage)];
}

/** Items that start during or before `stage` and may still be animating once it begins. */
export function liveDuringStage<T extends { start: number; end: number }>(items: readonly T[], stage: number): T[] {
  const from = stageStart(stage);
  const until = clampStage(stage) >= LAST_STAGE ? Number.POSITIVE_INFINITY : stageStart(stage + 1);
  return items.filter((item) => item.start < until && item.end + LINGER > from);
}

/** Items whose animation begins inside `stage` (what a stage freeze shows). */
export function beginningInStage<T extends { start: number }>(items: readonly T[], stage: number): T[] {
  return items.filter((item) => stageAt(item.start) === clampStage(stage));
}

export type TitleTiming = {
  duration: number;
  /** Per-letter rise. */
  reveal: number;
  /** Delay between consecutive letters. */
  stagger: number;
  /** Fast exit, ending exactly at the title's `end`. */
  exit: number;
  exitAt: number;
  /** Seconds after `start` of the fully revealed resting frame (review freeze). */
  rest: number;
};

export function titleTiming(title: { text: string; start: number; end: number }): TitleTiming {
  const duration = Math.max(0.3, title.end - title.start);
  const letters = Array.from(title.text).length;
  const exit = clamp(duration * 0.16, 0.14, 0.24);
  // The whole word lands within ~0.2 s however long it is, so short words stay punchy.
  const stagger = letters > 1 ? Math.min(0.045, 0.2 / (letters - 1)) : 0;
  const reveal = clamp(duration * 0.38, 0.3, 0.62);
  return { duration, reveal, stagger, exit, exitAt: duration - exit, rest: Math.max(0, duration - exit - 0.04) };
}

export type CalloutTiming = {
  duration: number;
  chipIn: number;
  lineAt: number;
  line: number;
  dotAt: number;
  dot: number;
  countAt: number;
  count: number;
  detailAt: number;
  detail: number;
  exit: number;
  exitAt: number;
  rest: number;
};

/** The entrance choreography is authored for ~1 s and compressed for the short flash-frame callouts. */
export function calloutTiming(callout: { start: number; end: number }): CalloutTiming {
  const duration = Math.max(0.3, callout.end - callout.start);
  const exit = clamp(duration * 0.2, 0.12, 0.2);
  const k = clamp((duration - exit) / 0.95, 0.45, 1);
  return {
    duration,
    chipIn: 0.34 * k,
    lineAt: 0.06 * k,
    line: 0.36 * k,
    dotAt: 0.34 * k,
    dot: 0.26 * k,
    countAt: 0.08 * k,
    count: 0.6 * k,
    detailAt: 0.26 * k,
    detail: 0.3 * k,
    exit,
    exitAt: duration - exit,
    rest: Math.max(0, duration - exit - 0.04),
  };
}

export type LetterboxTiming = { inAt: number; in: number; outAt: number; out: number; outStage: number };

export function letterboxTiming(): LetterboxTiming {
  return {
    inAt: LETTERBOX.inStart,
    in: Math.max(0.05, LETTERBOX.inEnd - LETTERBOX.inStart),
    outAt: LETTERBOX.outStart,
    out: Math.max(0.05, LETTERBOX.outEnd - LETTERBOX.outStart),
    outStage: stageAt(LETTERBOX.outStart),
  };
}

/** Brand end card: everything is relative to the start of the brand stage. */
export const BRAND = {
  at: STAGE_START[STAGE.brand],
  backdrop: 0.34,
  taglineAt: 0.5,
  tagline: 0.62,
  lineAt: 0.38,
  line: 0.5,
} as const;

/** Representative film time for elements that are not titles/callouts (letterbox, brand card) in a stage freeze. */
export function stageRestTime(stage: number): number {
  const s = clampStage(stage);
  if (s >= STAGE.brand) return BRAND.at + 1.2;
  return stageStart(s) + Math.max(LETTERBOX.inEnd + 0.05, 0.6);
}

// ---------------------------------------------------------------------------------------------
// Count-up numbers for the data callouts ("3:58 /KM", "41.2 KM/H", "P 42 G · C 64 G · F 18 G").

export type CountNumber = {
  kind: "number";
  /** Final text as written in the timeline. */
  text: string;
  from: number;
  to: number;
  decimals: number;
  /** `m:ss` pace/clock value, counted in seconds. */
  clock: boolean;
  /** Widest frame of the count; rendered as an invisible ghost so the chip never jitters while counting. */
  widest: string;
};
export type CountToken = { kind: "text"; text: string } | CountNumber;

const NUMBER = /\d+(?::[0-5]\d|\.\d+)?/g;

/** Where a count starts, by the unit that follows it: loads from zero, rates from a warm-up value, pace from slower. */
function countStart(to: number, clock: boolean, unit: string): number {
  if (clock) return to * 1.22;
  if (unit.startsWith("BPM")) return to * 0.72;
  if (unit.startsWith("RPM")) return to * 0.7;
  if (unit.startsWith("KM/H") || unit.startsWith("MPH")) return to * 0.68;
  return 0;
}

export function tokenizeCount(text: string): CountToken[] {
  const tokens: CountToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(NUMBER)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: "text", text: text.slice(cursor, index) });
    const raw = match[0];
    const clock = raw.includes(":");
    const decimals = !clock && raw.includes(".") ? raw.split(".")[1].length : 0;
    const to = clock ? Number(raw.split(":")[0]) * 60 + Number(raw.split(":")[1]) : Number(raw);
    const after = text.slice(index + raw.length).trimStart().toUpperCase();
    const from = countStart(to, clock, after);
    const draft: CountNumber = { kind: "number", text: raw, from, to, decimals, clock, widest: raw };
    const start = formatCount(draft, 0);
    if (start.length > raw.length) draft.widest = start;
    tokens.push(draft);
    cursor = index + raw.length;
  }
  if (cursor < text.length) tokens.push({ kind: "text", text: text.slice(cursor) });
  return tokens;
}

/** Text of `token` at eased progress `t` (0 = start value, 1 = exactly the timeline text). */
export function formatCount(token: CountNumber, t: number): string {
  if (t >= 1) return token.text;
  const value = token.from + (token.to - token.from) * clamp(t, 0, 1);
  if (token.clock) {
    const seconds = Math.max(0, Math.round(value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  return token.decimals > 0 ? value.toFixed(token.decimals) : String(Math.round(value));
}

/** Fast start, long soft landing: how instrument readouts settle. */
export function easeOutQuart(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) ** 4;
}
