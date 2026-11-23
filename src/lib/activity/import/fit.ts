import { timeRange } from "./gpx";
import { sportFromFit } from "./sport";
import { IMPORT_LIMITS, ImportError, sumIfAllKnown, type DeviceTotals, type ImportPoint, type ParsedImport } from "./types";

/*
 * A small decoder for FIT activity files (the binary format of Garmin, COROS, Wahoo, Polar, Suunto
 * and most other watches and bike computers), written from the public FIT protocol:
 *
 *   header (12 or 14 bytes: size, protocol, profile, data size, ".FIT", optional header CRC)
 *   records: definition messages (a local type 0-15 -> global message number, endianness and field
 *            list) and data messages (normal header, or a compressed-timestamp header)
 *   a CRC-16 over header and data.
 *
 * It reads file_id, device_info, record (time, position, altitude, distance, speed, heart rate),
 * event (timer start and stop), lap and session, and steps over every other message and developer
 * field by size. Invalid-value sentinels become null, never 0. Damaged, truncated or oversized
 * files fail with a plain reason instead of a partial import.
 */

/** FIT times count seconds from 1989-12-31T00:00:00Z. */
export const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** FIT's CRC-16 of `bytes[from..to)`. */
export function fitCrc(bytes: Uint8Array, from = 0, to = bytes.length, start = 0): number {
  let crc = start;
  for (let i = from; i < to; i++) {
    const byte = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

/** True when the bytes start like a FIT file (".FIT" at byte 8). */
export function looksLikeFit(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && (bytes[0] === 12 || bytes[0] === 14) && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

/** Manufacturer ids from the FIT profile that are named in FITX. Others stay unnamed rather than guessed. */
const MANUFACTURERS: Record<number, string> = {
  1: "Garmin",
  23: "Suunto",
  32: "Wahoo",
  123: "Polar",
  260: "Zwift",
  265: "Strava",
  267: "Bryton",
  289: "Hammerhead",
  294: "COROS",
};

const MESSAGE = { fileId: 0, sport: 12, session: 18, lap: 19, record: 20, event: 21, deviceInfo: 23 } as const;
const WANTED = new Set<number>(Object.values(MESSAGE));
const TIMESTAMP_FIELD = 253;

type FieldDef = { num: number; size: number; base: number };
type Definition = { global: number; little: boolean; fields: FieldDef[]; size: number; timestampOffset: number };
type Value = number | string | null;

/** Bytes per value of each base type (index = base type number, 0-16). */
const BASE_SIZE = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];

function readValue(view: DataView, bytes: Uint8Array, pos: number, size: number, baseType: number, little: boolean): Value {
  const base = baseType & 0x1f;
  if (base > 16) return null;
  if (base === 7) {
    let end = pos;
    while (end < pos + size && bytes[end] !== 0) end++;
    if (end === pos) return null;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(pos, end)).replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 120) : null;
  }
  const unit = BASE_SIZE[base];
  if (size < unit) return null;
  switch (base) {
    case 0: case 2: case 13: { const v = view.getUint8(pos); return v === 0xff ? null : v; }
    case 1: { const v = view.getInt8(pos); return v === 0x7f ? null : v; }
    case 3: { const v = view.getInt16(pos, little); return v === 0x7fff ? null : v; }
    case 4: { const v = view.getUint16(pos, little); return v === 0xffff ? null : v; }
    case 5: { const v = view.getInt32(pos, little); return v === 0x7fffffff ? null : v; }
    case 6: { const v = view.getUint32(pos, little); return v === 0xffffffff ? null : v; }
    case 8: { const v = view.getFloat32(pos, little); return Number.isFinite(v) ? v : null; }
    case 9: { const v = view.getFloat64(pos, little); return Number.isFinite(v) ? v : null; }
    case 10: { const v = view.getUint8(pos); return v === 0 ? null : v; }
    case 11: { const v = view.getUint16(pos, little); return v === 0 ? null : v; }
    case 12: { const v = view.getUint32(pos, little); return v === 0 ? null : v; }
    default: return null; // 64-bit integers: no field FITX reads uses them.
  }
}

const damaged = (detail: string) => new ImportError("damaged", `This FIT file is damaged or cut short (${detail}).`);

type Session = { startTime: number | null; sport: number | null; elapsed: number | null; timer: number | null; distance: number | null; kcal: number | null; ascent: number | null };

/** Decodes a FIT activity file into the import shape. Throws ImportError with a reason. */
export function readFit(bytes: Uint8Array): ParsedImport {
  if (bytes.length > IMPORT_LIMITS.maxFileBytes) throw new ImportError("too-large", "This file is too large to import.");
  if (!looksLikeFit(bytes)) throw new ImportError("unknown-format", "This isn’t a FIT file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  const dataSize = view.getUint32(4, true);
  const end = headerSize + dataSize;
  if (end + 2 > bytes.length) throw damaged("it ends early");
  if (headerSize >= 14) {
    const headerCrc = view.getUint16(12, true);
    if (headerCrc !== 0 && headerCrc !== fitCrc(bytes, 0, 12)) throw damaged("its header checksum doesn’t match");
  }
  if (view.getUint16(end, true) !== fitCrc(bytes, 0, end)) throw damaged("its checksum doesn’t match");

  const definitions: Array<Definition | undefined> = new Array(16);
  let lastTimestamp: number | null = null;
  let messages = 0;
  let fileType: number | null = null;
  let fileManufacturer: number | null = null;
  let fileProductName: string | null = null;
  let creatorManufacturer: number | null = null;
  let creatorProductName: string | null = null;
  let sportMessage: number | null = null;
  const sessions: Session[] = [];
  const laps: Session[] = [];
  const timer: Array<{ t: number; running: boolean }> = [];
  const points: ImportPoint[] = [];
  let skipped = 0;

  let pos = headerSize;
  while (pos < end) {
    if (++messages > IMPORT_LIMITS.maxFitMessages) throw new ImportError("too-large", "This file holds more data than FITX can import at once.");
    const header = bytes[pos++];
    if ((header & 0x80) === 0 && (header & 0x40) !== 0) {
      // Definition message.
      const local = header & 0x0f;
      const hasDeveloperFields = (header & 0x20) !== 0;
      if (pos + 5 > end) throw damaged("a message ends early");
      const little = bytes[pos + 1] === 0;
      const global = view.getUint16(pos + 2, little);
      const count = bytes[pos + 4];
      pos += 5;
      if (pos + count * 3 > end) throw damaged("a message ends early");
      const fields: FieldDef[] = [];
      let size = 0;
      let timestampOffset = -1;
      for (let i = 0; i < count; i++) {
        const field = { num: bytes[pos], size: bytes[pos + 1], base: bytes[pos + 2] };
        if (field.num === TIMESTAMP_FIELD && field.size === 4) timestampOffset = size;
        fields.push(field);
        size += field.size;
        pos += 3;
      }
      if (hasDeveloperFields) {
        if (pos + 1 > end) throw damaged("a message ends early");
        const developerCount = bytes[pos++];
        if (pos + developerCount * 3 > end) throw damaged("a message ends early");
        for (let i = 0; i < developerCount; i++) size += bytes[pos + i * 3 + 1];
        pos += developerCount * 3;
      }
      definitions[local] = { global, little, fields, size, timestampOffset };
      continue;
    }

    // Data message: normal header, or compressed timestamp (local type 0-3, 5-bit time offset).
    const compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 0x03 : header & 0x0f;
    const definition = definitions[local];
    if (!definition) throw damaged("data comes before its definition");
    if (pos + definition.size > end) throw damaged("a message ends early");
    let timestamp: number | null = null;
    if (compressed) {
      const offset = header & 0x1f;
      if (lastTimestamp !== null) {
        let next: number = lastTimestamp - (lastTimestamp % 32) + offset;
        if (offset < lastTimestamp % 32) next += 32;
        timestamp = next;
        lastTimestamp = next;
      }
    } else if (definition.timestampOffset >= 0) {
      const raw = view.getUint32(pos + definition.timestampOffset, definition.little);
      if (raw !== 0xffffffff) {
        timestamp = raw;
        lastTimestamp = raw;
      }
    }
    if (!WANTED.has(definition.global)) {
      pos += definition.size;
      continue;
    }
    const values = new Map<number, Value>();
    let at = pos;
    for (const field of definition.fields) {
      values.set(field.num, readValue(view, bytes, at, field.size, field.base, definition.little));
      at += field.size;
    }
    pos += definition.size;
    const n = (key: number): number | null => {
      const value = values.get(key);
      return typeof value === "number" ? value : null;
    };
    const s = (key: number): string | null => {
      const value = values.get(key);
      return typeof value === "string" ? value : null;
    };
    const ms = (seconds: number | null) => (seconds === null ? null : FIT_EPOCH_MS + seconds * 1000);

    switch (definition.global) {
      case MESSAGE.fileId:
        fileType = n(0);
        fileManufacturer = n(1);
        fileProductName = s(8);
        break;
      case MESSAGE.deviceInfo:
        // Device index 0 is the device that created the file (others are sensors).
        if (n(0) === 0) {
          creatorManufacturer ??= n(2);
          creatorProductName ??= s(27);
        }
        break;
      case MESSAGE.sport:
        sportMessage ??= n(0);
        break;
      case MESSAGE.session:
      case MESSAGE.lap: {
        const scaled = (key: number, scale: number) => { const v = n(key); return v === null ? null : v / scale; };
        const entry: Session = {
          startTime: ms(n(2)),
          sport: definition.global === MESSAGE.session ? n(5) : null,
          elapsed: scaled(7, 1000),
          timer: scaled(8, 1000),
          distance: scaled(9, 100),
          kcal: n(11),
          ascent: n(definition.global === MESSAGE.session ? 22 : 21),
        };
        (definition.global === MESSAGE.session ? sessions : laps).push(entry);
        break;
      }
      case MESSAGE.event: {
        // Event 0 is the timer: type 0 start; 1 stop, 4 stop all, 8 stop disable, 9 stop disable all.
        const type = n(1);
        if (n(0) === 0 && timestamp !== null && type !== null) {
          if (type === 0) timer.push({ t: FIT_EPOCH_MS + timestamp * 1000, running: true });
          else if (type === 1 || type === 4 || type === 8 || type === 9) timer.push({ t: FIT_EPOCH_MS + timestamp * 1000, running: false });
        }
        break;
      }
      case MESSAGE.record: {
        const lat = n(0);
        const lng = n(1);
        if (timestamp === null || lat === null || lng === null) {
          skipped++;
          break;
        }
        const latitude = lat * SEMICIRCLES_TO_DEGREES;
        const longitude = lng * SEMICIRCLES_TO_DEGREES;
        if (!(latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180)) {
          skipped++;
          break;
        }
        if (points.length >= IMPORT_LIMITS.maxPoints) throw new ImportError("too-large", "This file has more points than FITX can import at once.");
        const enhancedAltitude = n(78);
        const altitude = n(2);
        const enhancedSpeed = n(73);
        const speed = n(6);
        const distance = n(5);
        const hr = n(3);
        points.push({
          t: FIT_EPOCH_MS + timestamp * 1000,
          lat: latitude,
          lng: longitude,
          alt: enhancedAltitude !== null ? enhancedAltitude / 5 - 500 : altitude !== null ? altitude / 5 - 500 : null,
          speed: enhancedSpeed !== null ? enhancedSpeed / 1000 : speed !== null ? speed / 1000 : null,
          distanceM: distance !== null ? distance / 100 : null,
          heartRate: hr !== null && hr > 0 ? hr : null,
          acc: null,
          altAcc: null,
        });
        break;
      }
    }
  }

  if (fileType !== null && fileType !== 4) {
    throw new ImportError("not-activity", "This FIT file isn’t a recorded activity (it may be a course, a workout plan or device settings).");
  }
  if (sessions.length > 1) {
    throw new ImportError("not-activity", "This file holds several sessions (a multisport activity). FITX imports one activity per file.");
  }
  if (!points.length) {
    throw new ImportError("no-points", "This FIT file has no GPS points (an indoor or treadmill session?). FITX imports activities with a recorded route.");
  }

  const session = sessions[0] ?? null;
  // Without a session message the laps are added up, but only when every lap has the value.
  const sumOf = (key: "timer" | "distance" | "kcal" | "ascent" | "elapsed") => sumIfAllKnown(laps.map((lap) => lap[key]));
  const totals: DeviceTotals = session
    ? { distanceM: session.distance, timerSeconds: session.timer, elapsedSeconds: session.elapsed, ascentM: session.ascent, kcal: session.kcal }
    : { distanceM: sumOf("distance"), timerSeconds: sumOf("timer"), elapsedSeconds: sumOf("elapsed"), ascentM: sumOf("ascent"), kcal: sumOf("kcal") };

  const { first, last } = timeRange([points]);
  // The device's own start (its timer start) when it is shortly before the first point.
  const declaredStart = session?.startTime ?? timer.find((event) => event.running)?.t ?? null;
  const startedAt = declaredStart !== null && declaredStart <= first && first - declaredStart <= 15 * 60_000 ? declaredStart : first;
  const declaredEnd = session && session.elapsed !== null ? startedAt + session.elapsed * 1000 : null;
  const endedAt = declaredEnd !== null && declaredEnd >= last && declaredEnd - last <= 10 * 60_000 ? declaredEnd : last;

  const manufacturer = creatorManufacturer ?? fileManufacturer;
  const brand = manufacturer === null ? null : MANUFACTURERS[manufacturer] ?? null;
  const product = creatorProductName ?? fileProductName;
  const device = product && brand && !product.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${product}` : product ?? brand;

  return {
    format: "fit",
    device: device ? device.slice(0, 120) : null,
    sport: sportFromFit(session?.sport ?? sportMessage),
    name: null,
    segments: [points],
    pauses: timerPauses(timer, startedAt, endedAt),
    segmentsArePauses: false,
    startedAt,
    endedAt,
    totals,
    skippedPoints: skipped,
  };
}

/** Stretches with the device's timer stopped (auto-pause or the stop button), inside the activity. */
export function timerPauses(events: ReadonlyArray<{ t: number; running: boolean }>, startedAt: number, endedAt: number): Array<{ start: number; end: number }> {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const pauses: Array<{ start: number; end: number }> = [];
  let stoppedAt: number | null = null;
  for (const event of sorted) {
    if (!event.running) {
      if (stoppedAt === null) stoppedAt = event.t;
    } else if (stoppedAt !== null) {
      const start = Math.max(startedAt, stoppedAt);
      const end = Math.min(endedAt, event.t);
      if (end > start) pauses.push({ start, end });
      stoppedAt = null;
    }
  }
  return pauses;
}
