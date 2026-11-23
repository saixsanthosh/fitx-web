// Pure planning for the film lab: job definitions, command-line arguments, the frame plan and the rev hash.
// No I/O except `revHash`'s file reads (it hashes the source tree it is given). Tested in tests/brand/film-lab.test.ts.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const FPS = 60;

/** The five compositions and their render sizes (BRIEF-2 3.1; the same numbers as src/components/brand/films/compositions.ts). */
export const COMP_SIZES = Object.freeze({
  phone: { width: 960, height: 1920 },
  "tablet-p": { width: 1200, height: 1600 },
  "tablet-l": { width: 1600, height: 1200 },
  laptop: { width: 1920, height: 1080 },
  desktop: { width: 1920, height: 960 },
});
export const COMPS = Object.freeze(Object.keys(COMP_SIZES));
export const THEMES = Object.freeze(["dark", "light"]);

/**
 * The four jobs `render.mjs --job=` knows.
 * - intro, welcome: the films at 60 fps, every composition, both themes (one composition and theme per run).
 * - landing-reel: the landing hero reel, cut from the intro (film time 1.3 to 10.6 s) at 30 fps in the two shapes the
 *   landing serves (`src/components/landing/film.ts`), plus its posters and the team still (`public/media/landing-film/`).
 * - login-stills: the sign-in scene's still frames (`public/media/login/`), from `/signin` and the scene's own
 *   development hook, at the sizes the shipped files have.
 */
export const JOBS = Object.freeze({
  intro: { kind: "film", film: "intro", fps: FPS },
  welcome: { kind: "film", film: "welcome", fps: FPS },
  "landing-reel": {
    kind: "reel",
    film: "intro",
    fps: 30,
    from: 1.3,
    to: 10.6,
    shapes: {
      // The landing picks portrait below an aspect of 0.9; its portrait reel is 9:16, which the phone composition serves.
      landscape: { comp: "laptop", width: 1280, height: 720 },
      portrait: { comp: "phone", width: 540, height: 960 },
    },
    // Stills at the shipped sizes and film times (recovered by matching the shipped files against the shipped cut's
    // frames: both posters are frame 123, t = 2.05 s, in the sprint drive; the team still is frame 594, t = 9.9 s).
    stills: {
      "poster-landscape": { shape: "landscape", time: 2.05, width: 1600, height: 900, file: "poster-{theme}-landscape.webp" },
      "poster-portrait": { shape: "portrait", time: 2.05, width: 720, height: 1280, file: "poster-{theme}-portrait.webp" },
      team: { shape: "landscape", time: 9.9, width: 1600, height: 900, file: "team-{theme}.webp" },
    },
    ss: 2,
  },
  "login-stills": {
    kind: "stills",
    page: "/signin",
    // The scene's moment (STILL_SECONDS in src/components/auth/scene/scene-math.ts) and the shipped sizes.
    seconds: 5,
    frames: {
      wide: { width: 1600, height: 800 },
      tall: { width: 1000, height: 1100 },
    },
  },
});

const FLAGS = new Set(["pick", "job", "comp", "theme", "frames", "shots", "step", "ss", "subframes", "preflight", "out", "rev", "headed", "port", "label", "keep-dev"]);

/**
 * Parses `--name=value` and `--flag` arguments into a checked job request. Throws with a plain message on anything
 * unknown or out of range, so a typo never starts a long render.
 */
export function parseArgs(argv) {
  const raw = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`unknown argument ${arg}`);
    const [, name, value] = match;
    if (!FLAGS.has(name)) throw new Error(`unknown flag --${name}`);
    raw[name] = value ?? true;
  }
  if (raw.preflight === true && !raw.job) {
    return { preflight: true, job: null, kind: null, film: null, comps: [], themes: [], frames: null, shots: null, step: 1, ss: 1, subframes: 1, out: raw.out === undefined ? null : String(raw.out), rev: null, headed: raw.headed === true, port: 3790, label: "preflight", keepDev: false };
  }
  const job = raw.job ?? "intro";
  if (!JOBS[job]) throw new Error(`--job must be one of ${Object.keys(JOBS).join(", ")}`);
  const def = JOBS[job];
  const list = (value, allowed, name) => {
    if (value === undefined || value === true) return [...allowed];
    const items = String(value).split(",").map((item) => item.trim()).filter(Boolean);
    for (const item of items) if (!allowed.includes(item)) throw new Error(`--${name}=${item} is not one of ${allowed.join(", ")}`);
    return items;
  };
  const positive = (value, name, fallback) => {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`--${name} must be a whole number of 1 or more`);
    return number;
  };
  const comps = def.kind === "film" ? list(raw.comp, COMPS, "comp") : def.kind === "reel" ? list(raw.comp, Object.keys(def.shapes), "comp") : list(raw.comp, Object.keys(def.frames), "comp");
  const themes = list(raw.theme, THEMES, "theme");
  let frames = null;
  if (raw.frames !== undefined) {
    const range = /^(\d+)-(\d+)$/.exec(String(raw.frames));
    if (!range || Number(range[1]) > Number(range[2])) throw new Error("--frames must be a range like 0-714");
    frames = { first: Number(range[1]), last: Number(range[2]) };
  }
  let pick = null;
  if (raw.pick !== undefined) {
    if (!/^\d+(,\d+)*$/.test(String(raw.pick))) throw new Error("--pick must list frame numbers like 700,12,355");
    pick = String(raw.pick).split(",").map(Number);
  }
  const shots = raw.shots === undefined || raw.shots === true ? null : String(raw.shots).split(",").map((item) => item.trim()).filter(Boolean);
  const ss = positive(raw.ss, "ss", def.ss ?? 1);
  if (ss > 3) throw new Error("--ss is at most 3 (the frame would pass the GPU's texture limit)");
  const subframes = positive(raw.subframes, "subframes", 1);
  if (subframes > 4) throw new Error("--subframes is at most 4");
  return {
    preflight: raw.preflight === true,
    job,
    kind: def.kind,
    film: def.film ?? null,
    comps,
    themes,
    frames,
    pick,
    shots,
    step: positive(raw.step, "step", 1),
    ss,
    subframes,
    out: raw.out === undefined ? null : String(raw.out),
    rev: raw.rev === undefined ? null : String(raw.rev),
    headed: raw.headed === true,
    port: positive(raw.port, "port", 3790),
    label: raw.label === undefined ? null : String(raw.label),
    keepDev: raw["keep-dev"] === true,
  };
}

/** Frames of a film at `fps`: one at every 1/fps from 0, ending before the duration (12.6 s at 60 fps is 756). */
export function frameCount(duration, fps = FPS) {
  return Math.max(1, Math.round(duration * fps - 1e-6));
}

function shotAt(shots, time) {
  for (let index = shots.length - 1; index >= 0; index -= 1) if (time >= shots[index].start) return index;
  return 0;
}

/**
 * The frames a film job renders, in order: `{ index, time, shot, subs }`, where `subs` are the sample times that
 * `tmix` averages into the frame (one without sub-frames). `film` is the lab's `describeFilm` output. Sub-frames sit
 * at even spacing inside the frame's own 1/fps (the shutter opens at the frame time), clamped to the frame's shot, so
 * motion blur never mixes two shots across a cut. `frames` (inclusive), `shots` and `step` narrow it.
 */
/**
 * @param {{ id?: string, duration: number, shots: readonly { id: string, start: number, end: number }[] }} film
 * @param {{ fps?: number, frames?: { first: number, last: number } | null, pick?: number[] | null, shots?: string[] | null, step?: number, subframes?: number }} [options]
 */
export function framePlan(film, { fps = FPS, frames = null, pick = null, shots = null, step = 1, subframes = 1 } = {}) {
  const total = frameCount(film.duration, fps);
  const first = frames ? frames.first : 0;
  const last = frames ? frames.last : total - 1;
  const known = new Set(film.shots.map((shot) => shot.id));
  if (shots) for (const id of shots) if (!known.has(id)) throw new Error(`--shots: ${id} is not a shot of ${film.id}`);
  const plan = [];
  // `pick` renders exactly these frames in this order (the determinism check renders frames out of order).
  const indexes = pick ?? Array.from({ length: Math.floor((last - first) / step) + 1 }, (_, k) => first + k * step);
  for (const index of indexes) {
    const time = Math.min(film.duration, index / fps);
    const shotIndex = shotAt(film.shots, time);
    const shot = film.shots[shotIndex];
    if (shots && !shots.includes(shot.id)) continue;
    const subs = [];
    for (let k = 0; k < subframes; k += 1) {
      const sub = time + k / (fps * subframes);
      const end = shotIndex === film.shots.length - 1 ? film.duration : shot.end;
      // Stay inside the shot (a sub-frame past the cut would blend in the next shot's first image).
      subs.push(Math.min(sub, Math.max(time, end - 1e-4)));
    }
    plan.push({ index, time, shot: shot.id, subs });
  }
  return plan;
}

/** The plan split into consecutive runs of one shot: each becomes one FFV1 master segment (resumable). */
export function segmentsOf(plan) {
  const groups = [];
  for (const frame of plan) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (last && last[0].shot === frame.shot && frame.index > previous.index) last.push(frame);
    else groups.push([frame]);
  }
  return groups.map((frames, order) => ({
    order,
    shot: frames[0].shot,
    first: frames[0].index,
    last: frames[frames.length - 1].index,
    frames,
    name: `${String(order).padStart(2, "0")}-${frames[0].shot}-${frames[0].index}-${frames[frames.length - 1].index}`,
  }));
}

/** The reel job's frames on the film clock: `from` to `to` at the reel's own fps (279 frames for 1.3 to 10.6 at 30). */
export function reelPlan(def) {
  const count = Math.round((def.to - def.from) * def.fps - 1e-6);
  return Array.from({ length: count }, (_, index) => ({ index, time: def.from + index / def.fps }));
}

/** The render size for an output: the output size times the supersampling factor. */
export function renderSize(size, ss = 1) {
  return { width: size.width * ss, height: size.height * ss };
}

/** Every file under `dirs` (relative to `root`) with one of `extensions`, sorted, as repo-relative paths. */
export function listSources(root, dirs, extensions = [".ts", ".tsx", ".mjs", ".glsl", ".json"]) {
  const out = [];
  const walk = (relative) => {
    const absolute = path.join(root, relative);
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (extensions.includes(path.extname(entry.name))) out.push(child.split(path.sep).join("/"));
    }
  };
  for (const dir of dirs) {
    const absolute = path.join(root, dir);
    if (statSync(absolute, { throwIfNoEntry: false })?.isFile()) out.push(dir);
    else walk(dir);
  }
  return [...new Set(out)].sort();
}

/** The film's source tree: what a render depends on. */
export const SOURCE_DIRS = Object.freeze(["src/components/brand/intro", "src/components/brand/films/compositions.ts", "src/app/lab/film"]);

/**
 * `rev`: a stable hash of the film's source tree, the job's arguments and the encoder settings (BRIEF-2 3.1,
 * `<rev8>` in the shipped paths). Path names and contents both count, so a rename changes it. `files` maps a path to
 * its contents (as read by `readSources`); the argument and settings objects are hashed with sorted keys.
 */
export function revHash({ files, args, encoder }) {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    hash.update(`file\0${name}\0`);
    hash.update(files[name]);
    hash.update("\0");
  }
  hash.update(`args\0${stableJson(args)}\0encoder\0${stableJson(encoder)}`);
  return hash.digest("hex");
}

export function readSources(root, dirs = SOURCE_DIRS) {
  return Object.fromEntries(listSources(root, dirs).map((name) => [name, readFileSync(path.join(root, name))]));
}

/** The parts of a request that change the pictures (not where they go or how the run is driven). */
export function renderArgsForRev(request) {
  return { job: request.job, film: request.film, ss: request.ss, subframes: request.subframes, fps: JOBS[request.job]?.fps ?? FPS };
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
