/**
 * Reads what an MP4 file says about itself, from its boxes (ISO/IEC 14496-12), before it is uploaded: that it is an MP4
 * at all (`ftyp` first), how long it is, its video and audio codecs and frame, whether it is fragmented (MediaRecorder
 * writes fragments, often with no length in `mvhd`) and whether `moov` comes before the media. Pure: bytes in, facts out.
 */

export type Mp4Track = { id: number; kind: "video" | "audio" | "other"; codec: string; timescale: number; durationMs: number | null; width: number; height: number };

export type Mp4Info = {
  brand: string;
  compatible: string[];
  /** The length: mvhd's, else mehd's, else the sum of the fragments' sample durations of the longest track. */
  durationMs: number | null;
  fragmented: boolean;
  /** moov before the first mdat (plays before it has fully loaded). */
  moovFirst: boolean;
  video: { codec: string; width: number; height: number } | null;
  audio: { codec: string } | null;
  tracks: Mp4Track[];
};

export type SniffResult = { ok: true; info: Mp4Info } | { ok: false; reason: "not_mp4" | "truncated" | "no_moov" };

type Box = { type: string; start: number; body: number; end: number };

const text = (bytes: Uint8Array, at: number, length = 4) => String.fromCharCode(...bytes.subarray(at, at + length));

/** The boxes between `start` and `end`, or null when one claims to run past `end`. */
function boxes(view: DataView, bytes: Uint8Array, start: number, end: number): Box[] | null {
  const list: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = text(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return null;
      const big = view.getBigUint64(at + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return null;
    list.push({ type, start: at, body: at + header, end: at + size });
    at += size;
  }
  return list;
}

const child = (list: Box[] | null, type: string) => list?.find((box) => box.type === type) ?? null;

/** version 0 fields are 32-bit, version 1 fields 64-bit. */
function readVersioned(view: DataView, at: number, version: number): number {
  return version === 1 ? Number(view.getBigUint64(at)) : view.getUint32(at);
}

export function sniffMp4(input: Uint8Array | ArrayBuffer): SniffResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 16 || text(bytes, 4) !== "ftyp") return { ok: false, reason: "not_mp4" };
  const top = boxes(view, bytes, 0, bytes.byteLength);
  if (!top) return { ok: false, reason: "truncated" };
  const ftyp = top[0];
  const brand = text(bytes, ftyp.body);
  const compatible: string[] = [];
  for (let at = ftyp.body + 8; at + 4 <= ftyp.end; at += 4) compatible.push(text(bytes, at));

  const moov = child(top, "moov");
  if (!moov) return { ok: false, reason: "no_moov" };
  const firstMdat = top.findIndex((box) => box.type === "mdat");
  const moovFirst = firstMdat < 0 || top.indexOf(moov) < firstMdat;
  const inMoov = boxes(view, bytes, moov.body, moov.end);
  if (!inMoov) return { ok: false, reason: "truncated" };

  let movieScale = 0;
  let movieDuration = 0;
  const mvhd = child(inMoov, "mvhd");
  if (mvhd) {
    const version = bytes[mvhd.body];
    const offset = version === 1 ? 20 : 12;
    movieScale = view.getUint32(mvhd.body + offset);
    movieDuration = readVersioned(view, mvhd.body + offset + 4, version);
  }

  const mvex = child(inMoov, "mvex");
  const inMvex = mvex ? boxes(view, bytes, mvex.body, mvex.end) : null;
  let fragmentDuration = 0;
  const trexDefaults = new Map<number, number>();
  for (const box of inMvex ?? []) {
    if (box.type === "mehd") fragmentDuration = readVersioned(view, box.body + 4, bytes[box.body]);
    if (box.type === "trex") trexDefaults.set(view.getUint32(box.body + 4), view.getUint32(box.body + 12));
  }

  const tracks: Mp4Track[] = [];
  for (const trak of inMoov.filter((box) => box.type === "trak")) {
    const inTrak = boxes(view, bytes, trak.body, trak.end);
    const tkhd = child(inTrak, "tkhd");
    const mdia = child(inTrak, "mdia");
    if (!tkhd || !mdia) continue;
    const tkVersion = bytes[tkhd.body];
    const id = view.getUint32(tkhd.body + (tkVersion === 1 ? 20 : 12));
    const sizeAt = tkhd.body + (tkVersion === 1 ? 88 : 76);
    const width = sizeAt + 8 <= tkhd.end ? Math.round(view.getUint32(sizeAt) / 65536) : 0;
    const height = sizeAt + 8 <= tkhd.end ? Math.round(view.getUint32(sizeAt + 4) / 65536) : 0;
    const inMdia = boxes(view, bytes, mdia.body, mdia.end);
    const mdhd = child(inMdia, "mdhd");
    const hdlr = child(inMdia, "hdlr");
    let timescale = 0;
    let duration = 0;
    if (mdhd) {
      const version = bytes[mdhd.body];
      const offset = version === 1 ? 20 : 12;
      timescale = view.getUint32(mdhd.body + offset);
      duration = readVersioned(view, mdhd.body + offset + 4, version);
    }
    const handler = hdlr ? text(bytes, hdlr.body + 8) : "";
    const minf = child(inMdia, "minf");
    const stbl = minf ? child(boxes(view, bytes, minf.body, minf.end), "stbl") : null;
    const stsd = stbl ? child(boxes(view, bytes, stbl.body, stbl.end), "stsd") : null;
    const codec = stsd && stsd.body + 16 <= stsd.end ? text(bytes, stsd.body + 12) : "";
    tracks.push({
      id, kind: handler === "vide" ? "video" : handler === "soun" ? "audio" : "other", codec, timescale,
      durationMs: timescale > 0 && duration > 0 && duration < 0xffffffff ? (duration / timescale) * 1000 : null, width, height,
    });
  }

  // Fragments: sum each track's sample durations (trun, else tfhd's default, else trex's).
  const fragmentTicks = new Map<number, number>();
  const moofs = top.filter((box) => box.type === "moof");
  for (const moof of moofs) {
    for (const traf of (boxes(view, bytes, moof.body, moof.end) ?? []).filter((box) => box.type === "traf")) {
      const inTraf = boxes(view, bytes, traf.body, traf.end) ?? [];
      const tfhd = child(inTraf, "tfhd");
      if (!tfhd) continue;
      const tfFlags = view.getUint32(tfhd.body) & 0xffffff;
      const trackId = view.getUint32(tfhd.body + 4);
      let at = tfhd.body + 8;
      if (tfFlags & 0x01) at += 8;
      if (tfFlags & 0x02) at += 4;
      const fallback = tfFlags & 0x08 ? view.getUint32(at) : trexDefaults.get(trackId) ?? 0;
      for (const trun of inTraf.filter((box) => box.type === "trun")) {
        const flags = view.getUint32(trun.body) & 0xffffff;
        const count = view.getUint32(trun.body + 4);
        let sample = trun.body + 8;
        if (flags & 0x01) sample += 4;
        if (flags & 0x04) sample += 4;
        const stride = [0x100, 0x200, 0x400, 0x800].filter((bit) => flags & bit).length * 4;
        let ticks = 0;
        for (let index = 0; index < count; index += 1) {
          if (flags & 0x100) {
            if (sample + 4 > trun.end) return { ok: false, reason: "truncated" };
            ticks += view.getUint32(sample);
          } else {
            ticks += fallback;
          }
          sample += stride;
        }
        fragmentTicks.set(trackId, (fragmentTicks.get(trackId) ?? 0) + ticks);
      }
    }
  }
  for (const track of tracks) {
    const ticks = fragmentTicks.get(track.id);
    if (ticks && track.timescale > 0 && track.durationMs === null) track.durationMs = (ticks / track.timescale) * 1000;
  }

  let durationMs: number | null = null;
  if (movieScale > 0 && movieDuration > 0 && movieDuration < 0xffffffff) durationMs = (movieDuration / movieScale) * 1000;
  else if (movieScale > 0 && fragmentDuration > 0) durationMs = (fragmentDuration / movieScale) * 1000;
  else {
    const lengths = tracks.map((track) => track.durationMs).filter((value): value is number => value !== null);
    durationMs = lengths.length ? Math.max(...lengths) : null;
  }

  const video = tracks.find((track) => track.kind === "video");
  const audio = tracks.find((track) => track.kind === "audio");
  return {
    ok: true,
    info: {
      brand, compatible, durationMs: durationMs === null ? null : Math.round(durationMs), fragmented: moofs.length > 0 || Boolean(mvex), moovFirst,
      video: video ? { codec: video.codec, width: video.width, height: video.height } : null,
      audio: audio ? { codec: audio.codec } : null,
      tracks,
    },
  };
}
