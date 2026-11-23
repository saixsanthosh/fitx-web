#!/usr/bin/env node
/**
 * Measures each source's anchor (the moment a cue lines up with the film) and its loudness, and compares them with
 * sources.json.
 *
 *   worktrees/heavy.sh node scripts/brand/films/audio/analyse.mjs           # print the measurements
 *   worktrees/heavy.sh node scripts/brand/films/audio/analyse.mjs --check   # exit 1 when an anchor moved by > 10 ms
 *   [--audio-dir=<.alteration/audio>]
 *
 * Anchor kinds (10 ms hops):
 * - `boom`: the strongest onset after `after` seconds (C0's onset method: each band's rise over the previous 80 ms,
 *   summed over three bands);
 * - `hit`: the strongest onset in the file;
 * - `peak`: the loudest 50 ms of the broadband level (a whoosh's pass);
 * - `start`: the file's first sample (the welcome score plays from 0, so score time is film time).
 */
import { audioDir, bandLevels, decodeMono, ffmpeg, levelsDb, parseArgs, verifiedSources } from "./io.mjs";
import { pathToFileURL } from "node:url";
import { parseEbur128, peakTime, strongestOnset } from "./lib.mjs";

export const HOP = 0.01;
const TOLERANCE = 0.01 + 1e-9;

export function measureAnchor(source) {
  const { kind } = source.anchor;
  if (kind === "start") return { at: 0, how: "the first sample" };
  if (kind === "peak") {
    const best = peakTime(levelsDb(decodeMono(source.path), HOP), HOP, 5);
    return { at: best.at, how: `loudest 50 ms, ${best.level} dB RMS` };
  }
  const bands = bandLevels(source.path, HOP);
  const best = strongestOnset(bands, HOP, { after: kind === "boom" ? source.anchor.after ?? 0 : 0 });
  return { at: best.at, how: `strongest onset${kind === "boom" ? ` after ${source.anchor.after} s` : ""}, +${best.rise} dB summed over 3 bands` };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = verifiedSources(audioDir(args["audio-dir"]));
  let moved = 0;
  for (const source of sources.values()) {
    const anchor = measureAnchor(source);
    const loudness = parseEbur128(ffmpeg(["-i", source.path, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { quiet: true }));
    const stored = source.anchor.at;
    const ok = stored !== null && Math.abs(stored - anchor.at) <= TOLERANCE;
    if (!ok) moved += 1;
    console.log(
      `#${source.n} ${source.id.padEnd(12)} ${source.anchor.kind.padEnd(5)} at ${anchor.at.toFixed(2)} s (${anchor.how})` +
        `  stored ${stored === null ? "none" : stored.toFixed(2)}${ok ? "" : "  <-- differs"}` +
        `  | I ${loudness.integrated} LUFS, TP ${loudness.truePeak} dBTP`,
    );
  }
  if (args.check && moved) {
    console.error(`${moved} anchor(s) differ from sources.json by more than 10 ms.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
