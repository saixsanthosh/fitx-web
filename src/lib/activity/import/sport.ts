import type { Sport } from "../types";
import type { SportReading } from "./types";

/*
 * What an imported file says about its sport. FITX keeps walks, runs and rides only (the
 * activities.sport check), and the person always confirms the sport before importing. A file
 * that names another sport (a swim, a ski day) is reported as not supported; a file that names no
 * sport, or a generic one, is left for the person to choose. Nothing is guessed from speeds or names.
 */

/** FIT `sport` values (FIT SDK profile, Sport type) that FITX can read, with a readable label. */
const FIT_SPORT_LABEL: Record<number, string> = {
  0: "Generic activity",
  1: "Running",
  2: "Cycling",
  3: "Transition",
  4: "Fitness equipment",
  5: "Swimming",
  6: "Basketball",
  7: "Football (soccer)",
  8: "Tennis",
  9: "American football",
  10: "Training",
  11: "Walking",
  12: "Cross-country skiing",
  13: "Alpine skiing",
  14: "Snowboarding",
  15: "Rowing",
  16: "Mountaineering",
  17: "Hiking",
  18: "Multisport",
  19: "Paddling",
  20: "Flying",
  21: "E-biking",
  22: "Motorcycling",
  23: "Boating",
  24: "Driving",
  25: "Golf",
  26: "Hang gliding",
  27: "Horse riding",
  28: "Hunting",
  29: "Fishing",
  30: "Inline skating",
  31: "Rock climbing",
  32: "Sailing",
  33: "Ice skating",
  34: "Skydiving",
  35: "Snowshoeing",
  36: "Kayaking",
  37: "Rafting",
  38: "Windsurfing",
  39: "Kitesurfing",
  40: "Tactical",
  41: "Jumpmaster",
  42: "Boxing",
  43: "Floor climbing",
};

const FIT_KNOWN: Record<number, Sport> = { 1: "run", 2: "ride", 11: "walk", 17: "walk" };
/** Generic or mixed types, and ones a person might reasonably call a walk or a ride: they choose. */
const FIT_OPEN = new Set([0, 3, 4, 10, 16, 18, 21, 35]);

export function sportFromFit(sport: number | null): SportReading {
  if (sport === null) return { kind: "unknown", label: null };
  const label = FIT_SPORT_LABEL[sport] ?? `Sport type ${sport}`;
  const known = FIT_KNOWN[sport];
  if (known) return { kind: "known", sport: known, label };
  if (FIT_OPEN.has(sport) || !(sport in FIT_SPORT_LABEL)) return { kind: "unknown", label };
  return { kind: "unsupported", label };
}

/** TCX `<Activity Sport="…">`: Running, Biking or Other. */
export function sportFromTcx(value: string | null | undefined): SportReading {
  const text = (value ?? "").trim();
  if (/^running$/i.test(text)) return { kind: "known", sport: "run", label: "Running" };
  if (/^biking$/i.test(text)) return { kind: "known", sport: "ride", label: "Cycling" };
  return { kind: "unknown", label: text && !/^other$/i.test(text) ? text : null };
}

const WORDS: Array<[RegExp, Sport]> = [
  [/\b(?:trail[\s_-]*)?(?:run|runs|running|jog|jogging)\b/i, "run"],
  [/\b(?:walk|walks|walking|hike|hikes|hiking|trek|trekking)\b/i, "walk"],
  [/\b(?:ride|rides|riding|cycle|cycling|bike|biking|bicycle|bicycling|mtb|gravel[\s_-]*ride|road[\s_-]*bik(?:e|ing))\b/i, "ride"],
];
const OTHER = /\b(?:swim\w*|ski|skiing|snowboard\w*|row|rowing|paddl\w*|kayak\w*|canoe\w*|sail\w*|surf\w*|skat\w*|golf|driv\w*|motor\w*|flying|yoga|strength|weight\s*training|tennis|soccer|football|basketball|boxing|elliptical|stair\w*|horse\w*|climbing)\b/i;

/**
 * A free-text sport, such as GPX `<type>` ("running", "Cycling", "hiking"). Plain words only:
 * numbers and app codes are left for the person to choose.
 */
export function sportFromLabel(value: string | null | undefined): SportReading {
  const text = (value ?? "").replace(/[_-]+/g, " ").trim();
  if (!text) return { kind: "unknown", label: null };
  const label = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  // An e-bike ride is the person's call, as with FIT files.
  if (/\be\s*bik(?:e|es|ing)\b/i.test(text)) return { kind: "unknown", label };
  if (OTHER.test(text) && !/\b(?:bike|cycl)/i.test(text)) return { kind: "unsupported", label };
  for (const [pattern, sport] of WORDS) if (pattern.test(text)) return { kind: "known", sport, label };
  return { kind: "unknown", label };
}
