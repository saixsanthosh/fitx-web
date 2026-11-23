/**
 * FITX film audio: the pure parts of the mix (BRIEF-2 3.4). No file or process access here, so the cue tests can
 * check every number without ffmpeg. `mix.mjs` runs ffmpeg with what these functions return; `analyse.mjs` measures
 * the sources' anchors with `onsets` and `peakTime`.
 *
 * Terms:
 * - a **source** is one owner-approved Pixabay original (`sources.json`), with one **anchor**: the moment in the file
 *   that a cue lines up with the film (the riser's boom, the whoosh's pass, a plate's clang, the impact's hit);
 * - a **cue** plays part of a source (`from` to `to`, source seconds) so that its anchor lands at `at` (film seconds);
 * - a **sheet** is a film's list of cues plus its length (`intro.cues.mjs`, `welcome.cues.mjs`, `sting.cues.mjs`).
 */

/** Everything the mix settles on. S6 hashes this into the sting's rev, so a change here makes a new file name. */
export const MIX = Object.freeze({
  sampleRate: 48000,
  /** Every cue is levelled to this integrated loudness before its own gain (two-pass, BRIEF-2 3.4). */
  cueLufs: -23,
  /** The finished film mixes. */
  filmLufs: -16,
  /** The returning-reveal sting: quieter than the films. */
  stingLufs: -20,
  /** Allowed distance from the loudness targets, in LU (verify.mjs: I −16 ± 1). */
  lufsTolerance: 1,
  /** True-peak ceiling of every output, in dBTP, measured on the decoded AAC file. */
  truePeak: -1,
  /** The limiter's first ceiling (below `truePeak`, so AAC's overshoot still fits); lowered in 0.5 dB steps if not. */
  limiterCeiling: -1.5,
  /** Output length must match the sheet within this, in ms. */
  lengthToleranceMs: 10,
  aac: Object.freeze({ codec: "aac", bitrate: "128k", channels: 2 }),
  /** Byte caps (BRIEF-2 5, film budgets). */
  maxFilmBytes: 300_000,
  maxStingBytes: 40_000,
});

export const dbToLinear = (db) => 10 ** (db / 20);

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Seconds to whole samples at the mix rate. */
export const toSamples = (seconds, rate = MIX.sampleRate) => Math.round(seconds * rate);

/**
 * Reads the sources table in `.alteration/audio/CREDITS.md`: `| # | Use | Title | Author | Page | File | Bytes | SHA-256 | … |`.
 * Returns one entry per numbered row.
 */
export function parseCredits(markdown) {
  const rows = new Map();
  for (const line of String(markdown).split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 10 || !/^\d+$/.test(cells[1] ?? "")) continue;
    const [, n, use, title, author, page, file, bytes, sha256] = cells;
    rows.set(Number(n), { n: Number(n), use, title, author, page, file, bytes: Number(bytes.replace(/[^\d]/g, "")), sha256: sha256.toLowerCase() });
  }
  return rows;
}

/** Checks `sources.json` against the credits table: the same files, sizes and SHA-256. Returns the problems. */
export function checkSourcesAgainstCredits(sources, credits) {
  const problems = [];
  for (const source of sources) {
    const row = credits.get(source.n);
    if (!row) { problems.push(`#${source.n} ${source.id}: not in CREDITS.md`); continue; }
    if (row.sha256 !== source.sha256) problems.push(`#${source.n} ${source.id}: SHA-256 differs from CREDITS.md`);
    if (row.bytes !== source.bytes) problems.push(`#${source.n} ${source.id}: ${source.bytes} bytes, CREDITS.md says ${row.bytes}`);
    if (!source.file.endsWith(`/${row.file}`)) problems.push(`#${source.n} ${source.id}: file ${source.file}, CREDITS.md says ${row.file}`);
    if (row.page !== source.page) problems.push(`#${source.n} ${source.id}: page differs from CREDITS.md`);
  }
  return problems;
}

/** Where a cue sits: the source span it plays and the film span it fills (seconds). */
export function cueSpan(cue, source) {
  const from = cue.from ?? 0;
  const to = cue.to ?? source.duration;
  const start = cue.at - (source.anchor.at - from);
  return { from, to, length: to - from, start, end: start + (to - from) };
}

const EPSILON = 0.5 / MIX.sampleRate;

/** Every problem with a sheet: unknown sources, spans outside the source or the film, fades longer than the cue. */
export function validateSheet(sheet, sourcesById) {
  const problems = [];
  if (!(sheet.duration > 0)) problems.push(`${sheet.film}: no duration`);
  const ids = new Set();
  for (const cue of sheet.cues) {
    const where = `${sheet.film}/${cue.id}`;
    if (ids.has(cue.id)) problems.push(`${where}: duplicate id`);
    ids.add(cue.id);
    const source = sourcesById.get(cue.source);
    if (!source) { problems.push(`${where}: unknown source ${cue.source}`); continue; }
    const span = cueSpan(cue, source);
    if (span.from < -EPSILON) problems.push(`${where}: starts before the source (from ${span.from})`);
    if (span.to > source.duration + EPSILON) problems.push(`${where}: runs past the source (to ${span.to} > ${source.duration})`);
    if (!(span.length > 0)) problems.push(`${where}: empty`);
    if (span.start < -EPSILON) problems.push(`${where}: starts before the film (${round(span.start)} s)`);
    if (span.end > sheet.duration + EPSILON) problems.push(`${where}: runs past the film (${round(span.end)} s > ${sheet.duration} s)`);
    const fadeIn = cue.fadeIn ?? 0;
    const fadeOut = cue.fadeOut ?? 0;
    if (fadeIn < 0 || fadeOut < 0 || fadeIn + fadeOut > span.length + EPSILON) problems.push(`${where}: fades longer than the cue`);
    if (!Number.isFinite(cue.gainDb ?? 0) || Math.abs(cue.gainDb ?? 0) > 24) problems.push(`${where}: gain out of range`);
    if (cue.lowpass !== undefined && !(cue.lowpass > 20 && cue.lowpass < 20000)) problems.push(`${where}: low-pass out of range`);
  }
  return problems;
}

/** The part of a cue's chain that shapes the source before levelling: resample, trim, optional low-pass. */
export function segmentFilter(cue, source) {
  const span = cueSpan(cue, source);
  const parts = [
    `aresample=${MIX.sampleRate}`,
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
    `atrim=start_sample=${toSamples(span.from)}:end_sample=${toSamples(span.to)}`,
    "asetpts=PTS-STARTPTS",
  ];
  if (cue.lowpass) parts.push(`lowpass=f=${cue.lowpass}:p=2`, `lowpass=f=${cue.lowpass}:p=2`);
  return parts.join(",");
}

/** A key that is the same for cues whose levelling measurement is the same (same source, span and filter). */
export const segmentKey = (cue, source) => `${source.id}|${segmentFilter(cue, source)}`;

/** Gain (dB) that brings a measured segment to the cue level: what loudnorm's linear second pass applies. */
export const levellingGain = (measuredLufs, target = MIX.cueLufs) => target - measuredLufs;

/**
 * The ffmpeg filter graph for a sheet: input `i` is cue `i`'s source file. Each cue is trimmed, levelled
 * (`levels[cue.id]`, from `levellingGain`), given its own gain and fades, delayed to its film time, then all are summed
 * (amix without normalisation, so the cue gains mean what they say) and padded or cut to the film length exactly.
 */
export function buildMixGraph(sheet, sourcesById, levels) {
  const total = toSamples(sheet.duration);
  const chains = sheet.cues.map((cue, index) => {
    const source = sourcesById.get(cue.source);
    const span = cueSpan(cue, source);
    const gain = (levels[cue.id] ?? Number.NaN) + (cue.gainDb ?? 0);
    if (!Number.isFinite(gain)) throw new Error(`${sheet.film}/${cue.id}: no levelling gain`);
    const parts = [segmentFilter(cue, source)];
    if (cue.fadeIn) parts.push(`afade=t=in:st=0:d=${round(cue.fadeIn, 4)}`);
    if (cue.fadeOut) parts.push(`afade=t=out:st=${round(span.length - cue.fadeOut, 4)}:d=${round(cue.fadeOut, 4)}`);
    parts.push(`volume=${round(gain, 3)}dB`);
    const delay = Math.max(0, toSamples(span.start));
    if (delay > 0) parts.push(`adelay=delays=${delay}S:all=1`);
    return `[${index}:a]${parts.join(",")}[c${index}]`;
  });
  const labels = sheet.cues.map((_, index) => `[c${index}]`).join("");
  const sum = sheet.cues.length > 1
    ? `${labels}amix=inputs=${sheet.cues.length}:normalize=0:duration=longest:dropout_transition=0,`
    : `${labels}`;
  const tail = `apad=whole_len=${total},atrim=end_sample=${total},asetpts=PTS-STARTPTS[mix]`;
  return [...chains, sheet.cues.length > 1 ? `${sum}${tail}` : `${labels}${tail}`].join(";");
}

/**
 * The mastering chain after the sum: gain, then (only when needed) a 4× oversampled limiter for the true peak.
 * @param {{ gainDb: number; ceilingDb?: number | null }} options
 */
export function masterFilter({ gainDb, ceilingDb = null }) {
  const parts = [`volume=${round(gainDb, 3)}dB`];
  if (ceilingDb !== null) {
    parts.push(
      `aresample=${MIX.sampleRate * 4}`,
      `alimiter=limit=${round(dbToLinear(ceilingDb), 5)}:attack=1:release=60:level=disabled:latency=1`,
      `aresample=${MIX.sampleRate}`,
    );
  }
  return parts.join(",");
}

/**
 * Parses ffmpeg's `ebur128=peak=true:framelog=info` log: the summary's integrated loudness, range and true peak,
 * plus the loudest short-term (3 s) and momentary (400 ms) values from the per-frame lines (null when a window never
 * filled).
 */
export function parseEbur128(log) {
  const text = String(log);
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const number = (pattern) => {
    const match = summary.match(pattern);
    return match ? Number(match[1]) : null;
  };
  let shortTermMax = null;
  let momentaryMax = null;
  for (const match of text.matchAll(/M:\s*(-?[\d.]+|-inf)\s+S:\s*(-?[\d.]+|-inf)/g)) {
    // ebur128 prints -120.7 before a window has filled (a 3 s short-term window never fills in a 1.2 s file).
    const m = Number(match[1]) > -120 ? Number(match[1]) : Number.NaN;
    const s = Number(match[2]) > -120 ? Number(match[2]) : Number.NaN;
    if (Number.isFinite(m) && (momentaryMax === null || m > momentaryMax)) momentaryMax = m;
    if (Number.isFinite(s) && (shortTermMax === null || s > shortTermMax)) shortTermMax = s;
  }
  return {
    integrated: number(/I:\s*(-?[\d.]+)\s*LUFS/),
    range: number(/LRA:\s*(-?[\d.]+)\s*LU/),
    truePeak: number(/True peak:\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/),
    shortTermMax,
    momentaryMax,
  };
}

/** Parses the JSON block loudnorm prints in its measuring pass. */
export function parseLoudnormJson(log) {
  const text = String(log);
  const start = text.lastIndexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm printed no measurement");
  const json = JSON.parse(text.slice(start, end + 1));
  return { integrated: Number(json.input_i), truePeak: Number(json.input_tp), range: Number(json.input_lra), threshold: Number(json.input_thresh) };
}

/**
 * Checks one output against its targets. `measured` is the decoded file's ebur128 result plus `samples`.
 * `lufs` null skips the loudness check (none is set for the sting by verify.mjs, but FITX checks −20 ± 1 too).
 */
export function checkOutput({ measured, samples, expectedSeconds, lufs, bytes, maxBytes }) {
  const problems = [];
  if (lufs !== null && (measured.integrated === null || Math.abs(measured.integrated - lufs) > MIX.lufsTolerance)) {
    problems.push(`integrated ${measured.integrated} LUFS, target ${lufs} ± ${MIX.lufsTolerance}`);
  }
  if (measured.truePeak === null || measured.truePeak > MIX.truePeak) problems.push(`true peak ${measured.truePeak} dBTP, ceiling ${MIX.truePeak}`);
  const lengthMs = (samples / MIX.sampleRate - expectedSeconds) * 1000;
  if (Math.abs(lengthMs) > MIX.lengthToleranceMs) problems.push(`length off by ${round(lengthMs, 1)} ms (± ${MIX.lengthToleranceMs})`);
  if (bytes > maxBytes) problems.push(`${bytes} bytes, cap ${maxBytes}`);
  return problems;
}

/**
 * Onsets from band levels (C0's method, so the anchors and the welcome hits are measured the same way): for each
 * hop, each band's level rise over the mean of the previous `lookback` hops, summed over the bands (only rises
 * count). `bands` is an array of per-band dB arrays of equal length.
 */
export function onsetStrength(bands, lookback = 8) {
  const length = Math.min(...bands.map((band) => band.length));
  const strength = new Array(length).fill(0);
  for (let index = lookback; index < length; index += 1) {
    let sum = 0;
    for (const band of bands) {
      let mean = 0;
      for (let back = 1; back <= lookback; back += 1) mean += band[index - back];
      mean /= lookback;
      sum += Math.max(0, band[index] - mean);
    }
    strength[index] = sum;
  }
  return strength;
}

/** The strongest onset between `after` and `before` (seconds), as { at, rise }. */
export function strongestOnset(bands, hop, { after = 0, before = Infinity, lookback = 8, floorDb = -60 } = {}) {
  const strength = onsetStrength(bands, lookback);
  let best = { at: null, rise: 0 };
  strength.forEach((rise, index) => {
    const at = index * hop;
    if (at < after || at > before) return;
    if (Math.max(...bands.map((band) => band[index])) < floorDb) return;
    if (rise > best.rise) best = { at: round(at, 3), rise: round(rise, 1) };
  });
  return best;
}

/** The time of the loudest stretch (`smooth` hops wide, centred) of a dB envelope. */
export function peakTime(levels, hop, smooth = 5) {
  let best = { at: null, level: -Infinity };
  const half = Math.floor(smooth / 2);
  for (let index = 0; index < levels.length; index += 1) {
    let power = 0;
    let count = 0;
    for (let k = Math.max(0, index - half); k <= Math.min(levels.length - 1, index + half); k += 1) {
      power += 10 ** (levels[k] / 10);
      count += 1;
    }
    const level = 10 * Math.log10(power / count);
    if (level > best.level) best = { at: round(index * hop, 3), level: round(level, 1) };
  }
  return best;
}

/**
 * A CSS cubic-bezier's progress at a fraction of its duration, and the inverse: the fraction of the duration at
 * which progress reaches `progress`. Used to land a sound on the frame where a CSS plate seats.
 */
export function cubicBezier(x1, y1, x2, y2) {
  const coordinate = (a, b, s) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
  const solve = (fn, value) => {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 60; step += 1) {
      const mid = (low + high) / 2;
      if (fn(mid) < value) low = mid; else high = mid;
    }
    return (low + high) / 2;
  };
  return {
    at: (fraction) => coordinate(y1, y2, solve((s) => coordinate(x1, x2, s), fraction)),
    timeFor: (progress) => coordinate(x1, x2, solve((s) => coordinate(y1, y2, s), progress)),
  };
}

/** A short content hash for a file name (`rev8`), from any JSON-able value. `hash` is a sha256-hex function. */
export const rev8 = (value, hash) => hash(JSON.stringify(value)).slice(0, 8);

/** The cue sheet as plain data for a summary or a hash: every cue's resolved spans in source and film time. */
export function describeSheet(sheet, sourcesById) {
  return {
    film: sheet.film,
    duration: sheet.duration,
    lufs: sheet.lufs,
    cues: sheet.cues.map((cue) => {
      const source = sourcesById.get(cue.source);
      const span = cueSpan(cue, source);
      return {
        id: cue.id,
        source: `#${source.n} ${source.id}`,
        anchorAt: cue.at,
        film: [round(span.start), round(span.end)],
        from: round(span.from),
        to: round(span.to),
        gainDb: cue.gainDb ?? 0,
        fadeIn: cue.fadeIn ?? 0,
        fadeOut: cue.fadeOut ?? 0,
        ...(cue.lowpass ? { lowpass: cue.lowpass } : {}),
        note: cue.note,
      };
    }),
  };
}
