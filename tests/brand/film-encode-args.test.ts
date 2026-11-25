import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRF_RANGE, parseEncodeArgs, rungEncodes } from "../../scripts/brand/films/encode.mjs";
import { BUDGET, ENCODER } from "../../scripts/brand/films/lib/encoders.mjs";

// encode.mjs's arguments (scripts/brand/films/README.md, "Encoding"): --crf is the HEVC 60 rung's CRF and --avc-crf the
// AVC 30 rung's (D14: the welcome film's AVC 30 cuts re-encoded at the intro's CRF 31 to 32). Each sets that rung's one
// encode, or with --budget the CRF it starts stepping from; neither touches ENCODER, which is part of the film's rev.

const MASTER = "--master=/renders/welcome/abcd1234/laptop-dark/master.mkv";

test("by default each rung starts from ENCODER's CRF: HEVC 60 at 29, AVC 30 at 27, one encode each", () => {
  const request = parseEncodeArgs([MASTER, "--comp=laptop", "--theme=dark"]);
  assert.equal(request.crf, null);
  assert.equal(request.avcCrf, null);
  assert.equal(request.budget, false);
  assert.deepEqual(request.rungs, ["hevc60", "avc30", "poster"]);
  assert.deepEqual(rungEncodes(request), { hevc60: { start: 29, budget: null }, avc30: { start: 27, budget: null } });
  assert.deepEqual([ENCODER.hevc60.crf, ENCODER.avc30.crf], [29, 27]);
});

test("--avc-crf sets the AVC 30 rung's one encode and --budget's starting CRF, and nothing of the HEVC rung's", () => {
  const single = parseEncodeArgs([MASTER, "--comp=laptop", "--theme=dark", "--avc-crf=31"]);
  assert.equal(single.avcCrf, 31);
  assert.equal(single.crf, null);
  assert.deepEqual(rungEncodes(single), { hevc60: { start: 29, budget: null }, avc30: { start: 31, budget: null } });
  const budget = parseEncodeArgs([MASTER, "--comp=phone", "--theme=light", "--budget", "--avc-crf=32"]);
  assert.deepEqual(rungEncodes(budget), { hevc60: { start: 29, budget: BUDGET.hevc60 }, avc30: { start: 32, budget: BUDGET.avc30 } });
  // Only the AVC rung, as s6.sh's over-budget redo asks for one rung.
  const one = parseEncodeArgs([MASTER, "--comp=desktop", "--rungs=avc30", "--budget", "--avc-crf=31"]);
  assert.deepEqual(one.rungs, ["avc30"]);
  assert.equal(rungEncodes(one).avc30.start, 31);
  // --crf stays the HEVC rung's alone; the two together, in either order.
  const hevc = parseEncodeArgs([MASTER, "--comp=laptop", "--crf=28"]);
  assert.deepEqual(rungEncodes(hevc), { hevc60: { start: 28, budget: null }, avc30: { start: 27, budget: null } });
  const both = parseEncodeArgs(["--avc-crf=32", "--crf=30", MASTER, "--comp=tablet-l"]);
  assert.deepEqual([both.crf, both.avcCrf], [30, 32]);
  // ENCODER is left as it is (its CRFs are hashed into the rev).
  assert.deepEqual([ENCODER.hevc60.crf, ENCODER.avc30.crf], [29, 27]);
});

test("a CRF must be a whole number in --budget's range (20 to 40); typos never start an encode", () => {
  assert.deepEqual({ ...CRF_RANGE }, { min: 20, max: 40 });
  for (const crf of ["20", "31", "40"]) assert.equal(parseEncodeArgs([MASTER, "--comp=laptop", `--avc-crf=${crf}`]).avcCrf, Number(crf));
  for (const flag of ["avc-crf", "crf"]) {
    for (const bad of ["", "19", "41", "31.5", "3l", "-31", "0x1f", " 31", "1e1"]) {
      assert.throws(() => parseEncodeArgs([MASTER, "--comp=laptop", `--${flag}=${bad}`]), new RegExp(`--${flag} must be a whole number from 20 to 40`), `--${flag}=${bad}`);
    }
    assert.throws(() => parseEncodeArgs([MASTER, "--comp=laptop", `--${flag}`]), new RegExp(`--${flag} must be a whole number`), `--${flag} with no value`);
  }
  assert.throws(() => parseEncodeArgs([MASTER, "--comp=laptop", "--avc=31"]), /unknown flag --avc$/);
  assert.throws(() => parseEncodeArgs([MASTER, "--comp=laptop", "--avc-crf-start=31"]), /unknown flag --avc-crf-start/);
  assert.throws(() => parseEncodeArgs([MASTER, "--comp=laptop", "--avc_crf=31"]), /unknown argument --avc_crf=31/);
  assert.throws(() => parseEncodeArgs([MASTER, "--comp=laptop", "--AVC-CRF=31"]), /unknown argument/);
  assert.throws(() => parseEncodeArgs([MASTER, "--comp=laptop", "--avc-crf-=31"]), /unknown argument/);
  assert.throws(() => parseEncodeArgs(["--comp=laptop", "--avc-crf=31"]), /--master is required/);
});

test("the encodes use those plans: both video rungs encode from rungEncodes, and the README documents the flag", () => {
  const source = readFileSync("scripts/brand/films/encode.mjs", "utf8");
  assert.match(source, /const plan = rungEncodes\(request\);/);
  assert.match(source, /encodeToBudget\(\{ file, \.\.\.plan\.hevc60, lane,/);
  assert.match(source, /encodeToBudget\(\{ file, \.\.\.plan\.avc30, lane,/);
  assert.doesNotMatch(source, /start: ENCODER\.avc30\.crf/, "no encode starts at ENCODER's AVC CRF behind the flag's back");
  const readme = readFileSync("scripts/brand/films/README.md", "utf8");
  assert.match(readme, /`--avc-crf=<n>`/);
});
