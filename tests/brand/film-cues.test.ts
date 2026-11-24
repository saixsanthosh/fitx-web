import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FILM_DURATION, SHOTS, STAGE_START } from "@/components/brand/intro/timeline";
import { WELCOME_BEATS, WELCOME_DURATION, WELCOME_SCORE_HITS, WELCOME_SHOTS, welcomeShotAt } from "@/components/brand/intro/films/welcome/timeline";
import { LOADS, plateTravel } from "@/components/brand/intro/films/welcome/load-motion";
import { dreAction } from "@/components/brand/intro/films/welcome/shots";
import {
  buildMixGraph,
  checkOutput,
  checkSourcesAgainstCredits,
  cubicBezier,
  cueSpan,
  masterFilter,
  MIX,
  onsetStrength,
  parseCredits,
  parseEbur128,
  parseLoudnormJson,
  peakTime,
  playsTransient,
  strongestOnset,
  toSamples,
  validateSheet,
} from "../../scripts/brand/films/audio/lib.mjs";
import { SOURCES } from "../../scripts/brand/films/audio/sources.mjs";
import { BOOM_AT, INTRO_ACCENTS, INTRO_SHEET, introSheet, plateSeat, REVEAL_PLATES } from "../../scripts/brand/films/audio/intro.cues.mjs";
import { DRE_SLIDE_TO, WELCOME_SEATS, WELCOME_SHEET, welcomeSheet } from "../../scripts/brand/films/audio/welcome.cues.mjs";
import { STING_DURATION, STING_SHEET } from "../../scripts/brand/films/audio/sting.cues.mjs";

type Cue = { id: string; source: string; at: number; from?: number; to?: number; gainDb?: number; fadeIn?: number; fadeOut?: number; lowpass?: number };
type Sheet = { film: string; duration: number; lufs: number; cues: Cue[] };

/** The intro's length after film-intro's tail (BRIEF-2 3.3: 11.9 s becomes 12.6 s); the sheet must fit both. */
const INTRO_TAIL = 12.6;
const CREDITS = path.resolve("..", ".alteration", "audio", "CREDITS.md");

const cue = (sheet: Sheet, id: string) => {
  const found = sheet.cues.find((entry) => entry.id === id);
  assert.ok(found, `${sheet.film} has cue ${id}`);
  return found;
};
const span = (sheet: Sheet, id: string) => {
  const entry = cue(sheet, id);
  return cueSpan(entry, SOURCES.get(entry.source));
};
const near = (actual: number, expected: number, tolerance = 1e-6, message?: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} ≈ ${expected}`);

test("every cue of every sheet sits inside its film and its source, with sane fades and gains", () => {
  const sheets: Sheet[] = [INTRO_SHEET, introSheet(INTRO_TAIL), WELCOME_SHEET, STING_SHEET];
  for (const sheet of sheets) {
    assert.deepEqual(validateSheet(sheet, SOURCES), [], `${sheet.film} at ${sheet.duration} s`);
    for (const entry of sheet.cues) {
      const where = cueSpan(entry, SOURCES.get(entry.source));
      assert.ok(where.start >= -1e-6 && where.end <= sheet.duration + 1e-6, `${sheet.film}/${entry.id} inside the film`);
    }
  }
  assert.equal(INTRO_SHEET.duration, FILM_DURATION);
  assert.equal(WELCOME_SHEET.duration, WELCOME_DURATION);
});

test("validateSheet catches a cue outside its film, an unknown source and fades longer than the cue", () => {
  const bad: Sheet = {
    film: "bad",
    duration: 2,
    lufs: -16,
    cues: [
      { id: "late", source: "whoosh", at: 1.9 },
      { id: "early", source: "plate-slide", at: 0.05 },
      { id: "ghost", source: "nope", at: 1 },
      { id: "fades", source: "plate-lock", at: 1, fadeIn: 0.6, fadeOut: 0.6 },
    ],
  };
  const problems = validateSheet(bad, SOURCES).join("\n");
  assert.match(problems, /late: runs past the film/);
  assert.match(problems, /early: starts before the film/);
  assert.match(problems, /ghost: unknown source/);
  assert.match(problems, /fades: fades longer than the cue/);
});

test("the riser's measured boom lands on STAGE_START[6], the brand stage, at any film length", () => {
  assert.equal(BOOM_AT, STAGE_START[6]);
  for (const sheet of [INTRO_SHEET, introSheet(INTRO_TAIL)] as Sheet[]) {
    const riser = cue(sheet, "riser");
    assert.equal(riser.at, STAGE_START[6]);
    const where = span(sheet, "riser");
    // The boom sits `boom - from` seconds into the cue, and the cue starts at film time 0.
    near(where.start, 0, 1e-6, "the bed starts with the film");
    near(where.start + (SOURCES.get("riser")!.anchor.at - where.from), STAGE_START[6], 1e-6, "boom on the brand stage");
    near(where.end, sheet.duration, 1e-6, "the bed runs to the film's end");
  }
});

test("the whooshes pass on the chapter cuts 1.3, 3.5, 7.55 and 9.2 s", () => {
  const whooshes = INTRO_SHEET.cues.filter((entry: Cue) => entry.source === "whoosh").map((entry: Cue) => entry.at);
  assert.deepEqual(whooshes, [STAGE_START[1], STAGE_START[2], STAGE_START[4], STAGE_START[5]]);
  assert.deepEqual(whooshes, [1.3, 3.5, 7.55, 9.2]);
});

test("the plate clang sits inside 3a-plate and the low-passed impact inside 3d-drop", () => {
  const shot = (id: string) => SHOTS.find((entry) => entry.id === id)!;
  const plate = cue(INTRO_SHEET, "plate-3a");
  assert.equal(plate.source, "plate-slide");
  assert.ok(plate.at > shot("3a-plate").start && plate.at < shot("3a-plate").end);
  assert.equal(plate.at, INTRO_ACCENTS.plateSeat);
  const drop = cue(INTRO_SHEET, "drop-3d");
  assert.equal(drop.source, "impact");
  assert.ok(drop.lowpass && drop.lowpass <= 1000, "low-passed");
  assert.ok(drop.at >= shot("3d-drop").start && drop.at < shot("3d-drop").end);
});

test("the film-end plates follow the mark's CSS formation: #3 when plate 1 seats, then #4 when plate 3 locks", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  for (const plate of ["plate-1", "plate-2", "plate-3"] as const) {
    const match = css.match(new RegExp(`\\.fitx-mark__piece--${plate} \\{ --fitx-piece-at: (\\d+)ms; --fitx-piece-ms: (\\d+)ms; \\}`));
    assert.ok(match, `globals.css times ${plate}`);
    assert.deepEqual({ atMs: Number(match[1]), durationMs: Number(match[2]) }, REVEAL_PLATES[plate], `${plate} timing matches the CSS`);
  }
  assert.ok(css.includes("animation-name: fitx-mark-plate; animation-timing-function: cubic-bezier(.16, 1, .3, 1);"), "the plates' easing");
  assert.deepEqual(REVEAL_PLATES.easing, [0.16, 1, 0.3, 1]);
  for (const sheet of [INTRO_SHEET, introSheet(INTRO_TAIL)] as Sheet[]) {
    const slide = cue(sheet, "end-plates");
    const lock = cue(sheet, "end-lock");
    assert.equal(slide.source, "plate-slide");
    assert.equal(lock.source, "plate-lock");
    near(slide.at, STAGE_START[6] + plateSeat("plate-1"), 0.0011);
    near(lock.at, STAGE_START[6] + plateSeat("plate-3"), 0.0011);
    assert.ok(slide.at < lock.at, "#3 then #4");
    assert.ok(span(sheet, "end-lock").end <= sheet.duration + 1e-6, "cut at the film's end");
  }
  // 95% of the travel at 42.6% of the duration for cubic-bezier(.16, 1, .3, 1).
  near(cubicBezier(0.16, 1, 0.3, 1).timeFor(0.95), 0.426, 0.002);
  near(plateSeat("plate-1"), 1.059, 0.002);
  near(plateSeat("plate-3"), 1.21, 0.002);
});

test("the welcome mix plays score #5 from 0 s at full length, and the plate sounds sit on the loading shots' beats", () => {
  const score = cue(WELCOME_SHEET, "score");
  assert.equal(score.source, "score");
  assert.equal(score.at, 0);
  const where = span(WELCOME_SHEET, "score");
  near(where.start, 0);
  near(where.from, 0, 1e-9, "from the score's first sample, so score time is film time");
  near(where.end, Math.min(WELCOME_DURATION, SOURCES.get("score")!.duration), 1e-6, "full length");
  // The beats come from the welcome timeline (WELCOME_BEATS), not copies.
  assert.deepEqual([...WELCOME_SEATS], [...WELCOME_BEATS.plateSeat]);
  assert.deepEqual([...WELCOME_SEATS], [2.4, 4.48, 5.86]);
  assert.deepEqual(WELCOME_SEATS.map(welcomeShotAt), ["w1-maya", "w2-leo", "w3-dre"], "each plate meets the stack in its own loading shot");
  // Maya's and Leo's plates: #3's clang where the plate meets the stack.
  assert.equal(cue(WELCOME_SHEET, "plate-1").at, WELCOME_BEATS.plateSeat[0]);
  assert.equal(cue(WELCOME_SHEET, "plate-2").at, WELCOME_BEATS.plateSeat[1]);
  // Dre's: #3's slide runs into his seat, cut before its own clang, and #4's lock-on clank lands on the seat itself.
  const slide = cue(WELCOME_SHEET, "plate-3-slide");
  const lock = cue(WELCOME_SHEET, "plate-3-lock");
  assert.equal(slide.at, WELCOME_BEATS.plateSeat[2]);
  assert.equal(lock.at, WELCOME_BEATS.plateSeat[2]);
  assert.equal(DRE_SLIDE_TO, 0.12, "10 ms before #3's clang (its anchor, 0.13 s into the file)");
  const slideSpan = span(WELCOME_SHEET, "plate-3-slide");
  assert.ok(slideSpan.to < SOURCES.get("plate-slide")!.anchor.at, "the slide stops before its clang, so the clangs never double");
  assert.equal(playsTransient(slide, SOURCES.get("plate-slide")), false);
  assert.ok(slideSpan.end <= lock.at + 1e-9, "the slide ends as the lock lands");
  // Nothing is cued on the settle beats: the picture has no event there.
  for (const entry of WELCOME_SHEET.cues) assert.ok(!WELCOME_BEATS.settle.includes(entry.at), `${entry.id} is not on a settle beat`);
  // Every plate sound lands on a measured hit of score #5, like the beats themselves.
  for (const entry of WELCOME_SHEET.cues.filter((item: Cue) => item.source !== "score")) {
    assert.ok(WELCOME_SCORE_HITS.includes(entry.at), `${entry.id} at ${entry.at} s is a measured hit`);
  }
  // Each plate cue's sound file, trim, gain and fades.
  const plates = WELCOME_SHEET.cues.filter((item: Cue) => item.source !== "score");
  assert.deepEqual(
    plates.map((item: Cue) => [item.id, item.source, item.from ?? 0, item.to ?? null, item.gainDb, item.fadeIn ?? 0, item.fadeOut]),
    [
      ["plate-1", "plate-slide", 0, null, -5, 0, 0.3],
      ["plate-2", "plate-slide", 0, null, -5, 0, 0.3],
      ["plate-3-slide", "plate-slide", 0, 0.12, -8, 0, 0.03],
      ["plate-3-lock", "plate-lock", 0, null, -5, 0, 0.3],
    ],
  );
  assert.deepEqual(validateSheet(welcomeSheet(), SOURCES), []);
});

test("every welcome plate transient lands on the frame where the picture seats a plate, one per plate", () => {
  // Where the shots' own motion meets the stack (plateTravel's seat), in film seconds: Maya and Leo play their clips
  // at full speed from their shot's start; Dre plays his in slow motion (dreAction).
  const dre = WELCOME_SHOTS[3];
  let dreSeat = dre.start;
  while (dreAction(dreSeat - dre.start) < LOADS.dre.seat) dreSeat += 1 / 600;
  const seats = [
    { plate: "Maya's", at: WELCOME_SHOTS[1].start + LOADS.maya.seat, spec: LOADS.maya, action: (t: number) => t - WELCOME_SHOTS[1].start },
    { plate: "Leo's", at: WELCOME_SHOTS[2].start + LOADS.leo.seat, spec: LOADS.leo, action: (t: number) => t - WELCOME_SHOTS[2].start },
    { plate: "Dre's", at: dreSeat, spec: LOADS.dre, action: (t: number) => dreAction(t - dre.start) },
  ];
  const transients = WELCOME_SHEET.cues.filter((item: Cue) => item.source !== "score" && playsTransient(item, SOURCES.get(item.source)));
  assert.deepEqual(transients.map((item: Cue) => item.id), ["plate-1", "plate-2", "plate-3-lock"]);
  for (const seat of seats) {
    const on = transients.filter((item: Cue) => Math.abs(item.at - seat.at) <= 1 / 60);
    assert.equal(on.length, 1, `${seat.plate} plate (seated at ${seat.at.toFixed(3)} s): exactly one sound within a 60 fps frame`);
    // Within a frame of that sound the plate is at the stack; a frame earlier it is still travelling.
    const at = on[0].at;
    assert.ok(plateTravel(seat.spec, seat.action(at + 1 / 60)).seated, `${seat.plate} plate is seated a frame after ${at} s`);
    assert.ok(!plateTravel(seat.spec, seat.action(at - 1 / 60)).seated, `${seat.plate} plate still moves a frame before ${at} s`);
  }
  // After each seat the plate rebounds within 0.05 s of its clip and then stays still to its shot's end: no later
  // event in the picture for a sound to sit on.
  seats.forEach((seat, index) => {
    const shot = WELCOME_SHOTS[index + 1];
    const settleFrom = seat.spec.seat + 0.05;
    for (let t = shot.start; t < shot.end; t += 1 / 60) {
      const action = seat.action(t);
      if (action >= settleFrom) assert.ok(Math.abs(plateTravel(seat.spec, action).z - seat.spec.zSeat) < 1e-9, `${seat.plate} plate still at ${t.toFixed(3)} s`);
    }
  });
});

test("playsTransient: a cue plays its source's hit only when its span holds the anchor", () => {
  const plate = SOURCES.get("plate-slide")!;
  assert.equal(playsTransient({ id: "full", source: "plate-slide", at: 2 }, plate), true);
  assert.equal(playsTransient({ id: "slide", source: "plate-slide", at: 2, to: plate.anchor.at - 0.01 }, plate), false);
  assert.equal(playsTransient({ id: "tail", source: "plate-slide", at: 2, from: plate.anchor.at + 0.05 }, plate), false);
  assert.equal(playsTransient({ id: "score", source: "score", at: 0 }, SOURCES.get("score")), false, "a start anchor is no transient");
  assert.equal(playsTransient({ id: "riser", source: "riser", at: 10.6, from: 3.13 }, SOURCES.get("riser")), true, "a boom is one");
});

test("the sting is 1.2 s of impact #6 from just before its hit, with a 150 ms fade, quieter than the films", () => {
  assert.equal(STING_SHEET.duration, STING_DURATION);
  assert.equal(STING_DURATION, 1.2);
  assert.equal(STING_SHEET.cues.length, 1);
  const where = span(STING_SHEET, "impact");
  assert.equal(cue(STING_SHEET, "impact").source, "impact");
  near(where.start, 0);
  near(where.length, 1.2, 1e-6);
  assert.equal(cue(STING_SHEET, "impact").fadeOut, 0.15);
  assert.ok(cue(STING_SHEET, "impact").at > 0 && cue(STING_SHEET, "impact").at <= 0.05, "the hit lands within 50 ms of play()");
  assert.equal(STING_SHEET.lufs, MIX.stingLufs);
  assert.ok(MIX.stingLufs < MIX.filmLufs);
});

test("the mix targets are BRIEF-2's: cues at −23 LUFS, films at −16, ceiling −1 dBTP, ± 10 ms, 300 KB and 40 KB caps", () => {
  assert.equal(MIX.cueLufs, -23);
  assert.equal(MIX.filmLufs, -16);
  assert.equal(MIX.truePeak, -1);
  assert.equal(MIX.lufsTolerance, 1);
  assert.equal(MIX.lengthToleranceMs, 10);
  assert.equal(MIX.maxFilmBytes, 300_000);
  assert.equal(MIX.maxStingBytes, 40_000);
  assert.equal(MIX.sampleRate, 48000);
  assert.deepEqual({ ...MIX.aac }, { codec: "aac", bitrate: "128k", channels: 2 });
  assert.equal(INTRO_SHEET.lufs, -16);
  assert.equal(WELCOME_SHEET.lufs, -16);
});

test("the six sources are the owner-approved Pixabay files, hashed, each with a measured anchor", () => {
  assert.equal(SOURCES.size, 6);
  const numbers = [...SOURCES.values()].map((source) => source.n).sort();
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6]);
  for (const source of SOURCES.values()) {
    assert.match(source.sha256, /^[0-9a-f]{64}$/, `${source.id} SHA-256`);
    assert.ok(source.bytes > 0 && source.duration > 0);
    assert.match(source.file, /^raw\/0\d-[^/]+\/[^/]+\.mp3$/, "outside the repo, in .alteration/audio/raw/");
    assert.ok(typeof source.anchor.at === "number" && source.anchor.at >= 0 && source.anchor.at < source.duration, `${source.id} anchor`);
  }
  assert.equal(SOURCES.get("score")!.anchor.at, 0);
});

test("sources.json agrees with .alteration/audio/CREDITS.md (sizes, SHA-256, files, pages)", { skip: !existsSync(CREDITS) && "CREDITS.md is outside the repo and not on this machine" }, () => {
  const credits = parseCredits(readFileSync(CREDITS, "utf8"));
  assert.equal(credits.size, 6);
  assert.deepEqual(checkSourcesAgainstCredits([...SOURCES.values()], credits), []);
});

test("parseCredits reads the table and checkSourcesAgainstCredits names every mismatch", () => {
  const table = [
    "| # | Use | Title | Author | Page | File | Bytes | SHA-256 | Length | Loudness |",
    "|---|---|---|---|---|---|---|---|---|---|",
    `| 2 | x | Whoosh | A | ${SOURCES.get("whoosh")!.page} | lordsonny-whoosh-cinematic-161021.mp3 | 96,966 | ${"A".repeat(64)} | 3.03 s | −8.2 LUFS |`,
  ].join("\n");
  const credits = parseCredits(table);
  assert.equal(credits.get(2)!.bytes, 96966);
  assert.equal(credits.get(2)!.sha256, "a".repeat(64));
  const problems = checkSourcesAgainstCredits([...SOURCES.values()], credits).join("\n");
  assert.match(problems, /#2 whoosh: SHA-256 differs/);
  assert.match(problems, /#1 riser: not in CREDITS\.md/);
});

test("no .mp3 or .wav ships under public/ (only FITX's own .m4a mixes, from S6)", () => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(mp3|wav)$/i.test(name)) found.push(file);
    }
  };
  walk("public");
  assert.deepEqual(found, []);
});

test("buildMixGraph trims, levels, delays and sums every cue to the exact film length", () => {
  const levels = Object.fromEntries(INTRO_SHEET.cues.map((entry: Cue) => [entry.id, -10]));
  const graph = buildMixGraph(INTRO_SHEET, SOURCES, levels);
  assert.match(graph, new RegExp(`amix=inputs=${INTRO_SHEET.cues.length}:normalize=0`));
  assert.match(graph, new RegExp(`apad=whole_len=${toSamples(FILM_DURATION)},atrim=end_sample=${toSamples(FILM_DURATION)}`));
  const whoosh = span(INTRO_SHEET, "whoosh-1");
  assert.ok(graph.includes(`adelay=delays=${toSamples(whoosh.start)}S:all=1`), "the first whoosh delayed to its film time, in samples");
  assert.ok(graph.includes("volume=-15dB"), "levelling (−10) plus the whoosh's own gain (−5)");
  assert.ok(graph.includes("lowpass=f=700"), "the drop is low-passed");
  assert.throws(() => buildMixGraph(INTRO_SHEET, SOURCES, {}), /no levelling gain/);
  const sting = buildMixGraph(STING_SHEET, SOURCES, { impact: 0 });
  assert.ok(!sting.includes("amix"), "one cue needs no amix");
  assert.match(sting, /\[mix\]$/);
});

test("the master chain adds the oversampled limiter only when asked", () => {
  assert.equal(masterFilter({ gainDb: 6.5 }), "volume=6.5dB");
  const limited = masterFilter({ gainDb: 7, ceilingDb: -1.5 });
  assert.match(limited, /^volume=7dB,aresample=192000,alimiter=limit=0\.8414:attack=1:release=60:level=disabled:latency=1,aresample=48000$/);
});

test("parseEbur128 reads the summary and the loudest windows; parseLoudnormJson reads the measuring pass", () => {
  const log = [
    "[Parsed_ebur128_0 @ 0x1] t: 0.4  TARGET:-23 LUFS    M: -14.3 S:-120.7     I: -14.4 LUFS",
    "[Parsed_ebur128_0 @ 0x1] t: 3.1  TARGET:-23 LUFS    M: -12.0 S: -15.5     I: -15.0 LUFS",
    "  Integrated loudness:",
    "    I:         -16.2 LUFS",
    "    Threshold: -26.4 LUFS",
    "  Loudness range:",
    "    LRA:         8.3 LU",
    "  True peak:",
    "    Peak:       -1.2 dBFS",
  ].join("\n");
  const prefix = "[Parsed_ebur128_0 @ 0x1] Summary:\n";
  const parsed = parseEbur128(`${log.split("\n").slice(0, 2).join("\n")}\n${prefix}${log.split("\n").slice(2).join("\n")}`);
  assert.deepEqual(parsed, { integrated: -16.2, range: 8.3, truePeak: -1.2, shortTermMax: -15.5, momentaryMax: -12 });
  const loudnorm = parseLoudnormJson('[Parsed_loudnorm_0 @ 0x1]\n{\n "input_i" : "-25.30",\n "input_tp" : "-6.67",\n "input_lra" : "3.10",\n "input_thresh" : "-35.6"\n}\n');
  assert.deepEqual(loudnorm, { integrated: -25.3, truePeak: -6.67, range: 3.1, threshold: -35.6 });
});

test("checkOutput flags loudness, true peak, length and size", () => {
  const ok = { measured: { integrated: -16.2, truePeak: -1.2 }, samples: toSamples(12.6), expectedSeconds: 12.6, lufs: -16, bytes: 205_000, maxBytes: MIX.maxFilmBytes };
  assert.deepEqual(checkOutput(ok), []);
  const bad = checkOutput({ ...ok, measured: { integrated: -18, truePeak: -0.5 }, samples: toSamples(12.62), bytes: 400_000 }).join("\n");
  assert.match(bad, /integrated -18 LUFS/);
  assert.match(bad, /true peak -0\.5/);
  assert.match(bad, /length off by 20 ms/);
  assert.match(bad, /400000 bytes/);
});

test("the onset scan finds a step in any band, and peakTime the loudest stretch", () => {
  const hop = 0.01;
  const flat = (level: number, length = 100) => new Array(length).fill(level);
  const low = flat(-40);
  const high = flat(-60);
  for (let index = 42; index < 100; index += 1) high[index] = -20;
  const strength = onsetStrength([low, high]);
  assert.equal(strength.indexOf(Math.max(...strength)), 42);
  assert.deepEqual(strongestOnset([low, high], hop), { at: 0.42, rise: 40 });
  assert.deepEqual(strongestOnset([low, high], hop, { after: 0.5 }).at, null, "nothing rises after 0.5 s");
  const envelope = flat(-30);
  envelope[70] = -3;
  envelope[71] = -4;
  assert.equal(peakTime(envelope, hop, 3).at, 0.7);
});
