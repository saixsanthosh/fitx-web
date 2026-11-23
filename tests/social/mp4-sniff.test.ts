// mp4-sniff (wave-2 brief 3.10): the MP4 boxes are built here, byte by byte, so every case is exact: ftyp first,
// the length from mvhd, from mehd, or (fragmented MP4, as MediaRecorder writes) from the fragments' trun samples with
// per-sample, tfhd and trex durations; codecs, frame, moov before mdat, 64-bit sizes, and broken files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffMp4 } from "@/lib/social/video/mp4-sniff";

const u32 = (value: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value); return b; };
const u64 = (value: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(value)); return b; };
const ascii = (value: string) => new Uint8Array([...value].map((c) => c.charCodeAt(0)));
const zeros = (n: number) => new Uint8Array(n);
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const box = (type: string, ...body: Uint8Array[]) => { const content = join(...body); return join(u32(content.length + 8), ascii(type), content); };
const full = (version: number, flags: number) => u32((version << 24) | flags);

const ftyp = (brand = "isom") => box("ftyp", ascii(brand), u32(512), ascii("isom"), ascii("iso6"), ascii("avc1"));
const mvhd = (timescale: number, duration: number, version = 0) => version === 1
  ? box("mvhd", full(1, 0), u64(0), u64(0), u32(timescale), u64(duration), zeros(80))
  : box("mvhd", full(0, 0), u32(0), u32(0), u32(timescale), u32(duration), zeros(80));
function tkhd(id: number, width: number, height: number) {
  // version 0: flags, created, modified, id, reserved, duration, 8 reserved, layer/group, volume/reserved, 36 matrix, width, height.
  return box("tkhd", full(0, 3), u32(0), u32(0), u32(id), u32(0), u32(0), zeros(8), zeros(4), zeros(4), zeros(36), u32(width * 65536), u32(height * 65536));
}
const mdhd = (timescale: number, duration: number) => box("mdhd", full(0, 0), u32(0), u32(0), u32(timescale), u32(duration), zeros(4));
const hdlr = (handler: string) => box("hdlr", full(0, 0), u32(0), ascii(handler), zeros(12), ascii("x\0"));
const stsd = (codec: string) => box("stsd", full(0, 0), u32(1), box(codec, zeros(70)));
const trak = (id: number, handler: string, codec: string, timescale: number, duration: number, width = 0, height = 0) =>
  box("trak", tkhd(id, width, height), box("mdia", mdhd(timescale, duration), hdlr(handler), box("minf", box("stbl", stsd(codec)))));
const trex = (id: number, defaultDuration: number) => box("trex", full(0, 0), u32(id), u32(1), u32(defaultDuration), u32(0), u32(0));
const mehd = (duration: number) => box("mehd", full(0, 0), u32(duration));
function traf(id: number, { tfhdDuration, samples, perSample }: { tfhdDuration?: number; samples: number; perSample?: number[] }) {
  const tfFlags = 0x020000 | (tfhdDuration === undefined ? 0 : 0x08);
  const tfhd = box("tfhd", full(0, tfFlags), u32(id), ...(tfhdDuration === undefined ? [] : [u32(tfhdDuration)]));
  // trun with data offset (0x01) and, when given, per-sample duration (0x100) and size (0x200).
  const flags = 0x01 | (perSample ? 0x300 : 0x200);
  const entries = Array.from({ length: samples }, (_, index) => perSample ? join(u32(perSample[index]), u32(100)) : u32(100));
  return box("traf", tfhd, box("tfdt", full(0, 0), u32(0)), box("trun", full(0, flags), u32(samples), u32(0), ...entries));
}

test("a plain MP4: brand, length from mvhd, H.264 and AAC, the frame, moov before mdat", () => {
  const file = join(ftyp("mp42"), box("moov", mvhd(1000, 12_345), trak(1, "vide", "avc1", 90_000, 1_111_050, 1280, 720), trak(2, "soun", "mp4a", 48_000, 592_560)), box("mdat", zeros(64)));
  const result = sniffMp4(file);
  assert.ok(result.ok);
  assert.equal(result.info.brand, "mp42");
  assert.deepEqual(result.info.compatible, ["isom", "iso6", "avc1"]);
  assert.equal(result.info.durationMs, 12_345);
  assert.equal(result.info.fragmented, false);
  assert.equal(result.info.moovFirst, true);
  assert.deepEqual(result.info.video, { codec: "avc1", width: 1280, height: 720 });
  assert.deepEqual(result.info.audio, { codec: "mp4a" });
  assert.equal(Math.round(result.info.tracks[0].durationMs ?? 0), 12_345);
});

test("moov after mdat is read too, and reported as not first", () => {
  const result = sniffMp4(join(ftyp(), box("mdat", zeros(32)), box("moov", mvhd(600, 6000), trak(1, "vide", "avc1", 600, 6000, 640, 360))));
  assert.ok(result.ok);
  assert.equal(result.info.moovFirst, false);
  assert.equal(result.info.durationMs, 10_000);
});

test("version 1 boxes (64-bit times) and a 64-bit mdat size", () => {
  const bigMdat = join(u32(1), ascii("mdat"), u64(16 + 8), zeros(8));
  const result = sniffMp4(join(ftyp(), box("moov", mvhd(1000, 7_500, 1), trak(1, "vide", "avc3", 30_000, 225_000, 720, 1280)), bigMdat));
  assert.ok(result.ok);
  assert.equal(result.info.durationMs, 7_500);
  assert.equal(result.info.video?.codec, "avc3");
});

test("fragmented MP4 with no length in mvhd: the sum of trun sample durations (per sample)", () => {
  const moov = box("moov", mvhd(1000, 0), trak(1, "vide", "avc1", 30_000, 0, 1280, 720), box("mvex", trex(1, 0)));
  const frag = (durations: number[]) => join(box("moof", box("mfhd", full(0, 0), u32(1)), traf(1, { samples: durations.length, perSample: durations })), box("mdat", zeros(16)));
  // 3 fragments: 30 + 30 + 15 samples of 1,000 ticks at 30,000 a second = 2.5 s.
  const result = sniffMp4(join(ftyp("iso6"), moov, frag(Array(30).fill(1000)), frag(Array(30).fill(1000)), frag(Array(15).fill(1000))));
  assert.ok(result.ok);
  assert.equal(result.info.fragmented, true);
  assert.equal(result.info.durationMs, 2500);
});

test("fragment durations fall back to tfhd's default, then trex's", () => {
  const moov = box("moov", mvhd(1000, 0), trak(1, "vide", "avc1", 90_000, 0, 640, 480), trak(2, "soun", "mp4a", 48_000, 0), box("mvex", trex(1, 3000), trex(2, 1024)));
  const moof = box("moof", box("mfhd", full(0, 0), u32(1)), traf(1, { samples: 90, tfhdDuration: 3000 }), traf(2, { samples: 141 }));
  const moof2 = box("moof", box("mfhd", full(0, 0), u32(2)), traf(1, { samples: 60 }));
  const result = sniffMp4(join(ftyp(), moov, moof, box("mdat", zeros(8)), moof2, box("mdat", zeros(8))));
  assert.ok(result.ok);
  // Video: 150 samples × 3000 / 90,000 = 5 s; audio: 141 × 1024 / 48,000 ≈ 3.008 s. The longest track wins.
  assert.equal(Math.round(result.info.tracks[0].durationMs ?? 0), 5000);
  assert.equal(Math.round(result.info.tracks[1].durationMs ?? 0), 3008);
  assert.equal(result.info.durationMs, 5000);
});

test("mehd gives the fragmented length when mvhd has none", () => {
  const moov = box("moov", mvhd(1000, 0), trak(1, "vide", "avc1", 30_000, 0, 640, 360), box("mvex", mehd(4200), trex(1, 1000)));
  const result = sniffMp4(join(ftyp(), moov));
  assert.ok(result.ok);
  assert.equal(result.info.durationMs, 4200);
});

test("not an MP4, cut short, or without moov", () => {
  assert.deepEqual(sniffMp4(join(box("moov", mvhd(1000, 1000)), ftyp())), { ok: false, reason: "not_mp4" });
  assert.deepEqual(sniffMp4(ascii("\u001aEß£ webm header....")), { ok: false, reason: "not_mp4" });
  const whole = join(ftyp(), box("moov", mvhd(1000, 5000), trak(1, "vide", "avc1", 1000, 5000, 320, 240)));
  assert.deepEqual(sniffMp4(whole.subarray(0, whole.length - 10)), { ok: false, reason: "truncated" });
  assert.deepEqual(sniffMp4(join(ftyp(), box("mdat", zeros(10)))), { ok: false, reason: "no_moov" });
  assert.deepEqual(sniffMp4(new Uint8Array(4)), { ok: false, reason: "not_mp4" });
});

test("an ArrayBuffer works as well as a Uint8Array (with an offset)", () => {
  const file = join(ftyp(), box("moov", mvhd(1000, 3000), trak(1, "vide", "avc1", 1000, 3000, 320, 240)));
  const padded = join(zeros(5), file);
  assert.equal((sniffMp4(padded.subarray(5)) as { ok: true; info: { durationMs: number } }).info.durationMs, 3000);
  assert.equal((sniffMp4(file.slice().buffer) as { ok: true; info: { durationMs: number } }).info.durationMs, 3000);
});
