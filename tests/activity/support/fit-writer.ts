// A small FIT file writer for tests: definition and data messages (normal or compressed-timestamp
// headers, either byte order, developer fields), a 12- or 14-byte header and the CRC, written from
// the public FIT protocol independently of the app's decoder. Values are raw FIT values; helpers below
// scale degrees, metres and seconds the way devices store them.

export const BASE = {
  enum: 0x00, sint8: 0x01, uint8: 0x02, sint16: 0x83, uint16: 0x84, sint32: 0x85, uint32: 0x86,
  string: 0x07, float32: 0x88, uint8z: 0x0a, uint16z: 0x8b, uint32z: 0x8c, byte: 0x0d,
} as const;

const SIZE: Record<number, number> = { 0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x07: 1, 0x88: 4, 0x0a: 1, 0x8b: 2, 0x8c: 4, 0x0d: 1 };

/** [field number, base type, size in bytes (strings and arrays only)]. */
export type FieldSpec = [number, number, number?];
type Definition = { global: number; fields: Array<{ num: number; base: number; size: number }>; little: boolean; developer: number[] };

const TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
export function crc16(bytes: ArrayLike<number>, from = 0, to = bytes.length): number {
  let crc = 0;
  for (let i = from; i < to; i++) {
    const byte = bytes[i];
    let tmp = TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ TABLE[byte & 0xf];
    tmp = TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

/** FIT seconds (since 1989-12-31T00:00:00Z) for an epoch-ms time. */
export const fitTime = (ms: number) => Math.round((ms - Date.UTC(1989, 11, 31)) / 1000);
export const semicircles = (degrees: number) => Math.round((degrees * 2 ** 31) / 180);

export class FitWriter {
  private out: number[] = [];
  private definitions = new Map<number, Definition>();

  define(local: number, global: number, fields: FieldSpec[], options: { bigEndian?: boolean; developer?: number[] } = {}): this {
    const little = !options.bigEndian;
    const defs = fields.map(([num, base, size]) => ({ num, base, size: size ?? SIZE[base] }));
    const developer = options.developer ?? [];
    this.out.push(0x40 | (developer.length ? 0x20 : 0) | local, 0, little ? 0 : 1);
    this.out.push(...(little ? [global & 0xff, global >> 8] : [global >> 8, global & 0xff]));
    this.out.push(defs.length);
    for (const field of defs) this.out.push(field.num, field.size, field.base);
    if (developer.length) {
      this.out.push(developer.length);
      developer.forEach((size, i) => this.out.push(i, size, 0));
    }
    this.definitions.set(local, { global, fields: defs, little, developer });
    return this;
  }

  /** A data message; `values` follow the definition's fields (null writes the type's invalid value). */
  data(local: number, values: Array<number | string | null>, options: { compressedOffset?: number } = {}): this {
    const definition = this.definitions.get(local);
    if (!definition) throw new Error(`No definition for local type ${local}`);
    if (options.compressedOffset !== undefined) this.out.push(0x80 | ((local & 0x3) << 5) | (options.compressedOffset & 0x1f));
    else this.out.push(local);
    definition.fields.forEach((field, i) => this.out.push(...encode(values[i] ?? null, field.base, field.size, definition.little)));
    for (const size of definition.developer) for (let i = 0; i < size; i++) this.out.push(0xaa);
    return this;
  }

  raw(bytes: number[]): this {
    this.out.push(...bytes);
    return this;
  }

  build(options: { headerSize?: 12 | 14; headerCrc?: boolean; badCrc?: boolean; dataSize?: number } = {}): Uint8Array {
    const headerSize = options.headerSize ?? 14;
    const dataSize = options.dataSize ?? this.out.length;
    const header = [headerSize, 0x20, 0x08, 0x08, dataSize & 0xff, (dataSize >> 8) & 0xff, (dataSize >> 16) & 0xff, (dataSize >>> 24) & 0xff, 0x2e, 0x46, 0x49, 0x54];
    if (headerSize === 14) {
      const crc = options.headerCrc === false ? 0 : crc16(header);
      header.push(crc & 0xff, crc >> 8);
    }
    const bytes = [...header, ...this.out];
    let crc = crc16(bytes);
    if (options.badCrc) crc ^= 0xffff;
    bytes.push(crc & 0xff, crc >> 8);
    return Uint8Array.from(bytes);
  }
}

function encode(value: number | string | null, base: number, size: number, little: boolean): number[] {
  const view = new DataView(new ArrayBuffer(Math.max(size, 8)));
  if (base === BASE.string) {
    const text = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array();
    const bytes = new Array(size).fill(0);
    text.slice(0, size - 1).forEach((byte, i) => { bytes[i] = byte; });
    return bytes;
  }
  const invalid: Record<number, number> = { 0x00: 0xff, 0x01: 0x7f, 0x02: 0xff, 0x83: 0x7fff, 0x84: 0xffff, 0x85: 0x7fffffff, 0x86: 0xffffffff, 0x0a: 0, 0x8b: 0, 0x8c: 0, 0x0d: 0xff };
  const v = value === null ? invalid[base] : Number(value);
  switch (base) {
    case BASE.enum: case BASE.uint8: case BASE.uint8z: case BASE.byte: view.setUint8(0, v); break;
    case BASE.sint8: view.setInt8(0, v); break;
    case BASE.uint16: case BASE.uint16z: view.setUint16(0, v, little); break;
    case BASE.sint16: view.setInt16(0, v, little); break;
    case BASE.uint32: case BASE.uint32z: view.setUint32(0, v, little); break;
    case BASE.sint32: view.setInt32(0, v, little); break;
    case BASE.float32: if (value === null) view.setUint32(0, 0xffffffff, little); else view.setFloat32(0, v, little); break;
    default: throw new Error(`Unsupported base type ${base}`);
  }
  const unit = SIZE[base];
  const bytes = Array.from(new Uint8Array(view.buffer, 0, unit));
  // Arrays: the first element carries the value, the rest are invalid.
  while (bytes.length < size) bytes.push(0xff);
  return bytes;
}

// Message helpers (global numbers and field numbers from the FIT profile).
export const MSG = { fileId: 0, sport: 12, session: 18, lap: 19, record: 20, event: 21, deviceInfo: 23 } as const;

export const FILE_ID_FIELDS: FieldSpec[] = [[0, BASE.enum], [1, BASE.uint16], [2, BASE.uint16], [4, BASE.uint32], [8, BASE.string, 20]];
export const DEVICE_INFO_FIELDS: FieldSpec[] = [[253, BASE.uint32], [0, BASE.uint8], [2, BASE.uint16], [4, BASE.uint16], [27, BASE.string, 20]];
export const RECORD_FIELDS: FieldSpec[] = [[253, BASE.uint32], [0, BASE.sint32], [1, BASE.sint32], [78, BASE.uint32], [73, BASE.uint32], [5, BASE.uint32], [3, BASE.uint8]];
/** A record without its own timestamp, for compressed-timestamp headers. */
export const RECORD_FIELDS_NO_TIME: FieldSpec[] = [[0, BASE.sint32], [1, BASE.sint32], [2, BASE.uint16], [6, BASE.uint16], [5, BASE.uint32], [3, BASE.uint8]];
export const EVENT_FIELDS: FieldSpec[] = [[253, BASE.uint32], [0, BASE.enum], [1, BASE.enum]];
export const SESSION_FIELDS: FieldSpec[] = [[253, BASE.uint32], [2, BASE.uint32], [5, BASE.enum], [6, BASE.enum], [7, BASE.uint32], [8, BASE.uint32], [9, BASE.uint32], [11, BASE.uint16], [22, BASE.uint16]];
export const LAP_FIELDS: FieldSpec[] = [[253, BASE.uint32], [2, BASE.uint32], [7, BASE.uint32], [8, BASE.uint32], [9, BASE.uint32], [11, BASE.uint16], [21, BASE.uint16]];

export type RecordPoint = { t: number; lat: number; lng: number; alt?: number | null; speed?: number | null; distance?: number | null; hr?: number | null };

/** Record values for RECORD_FIELDS from a point in degrees, metres, m/s and epoch ms. */
export function recordValues(p: RecordPoint): Array<number | null> {
  return [
    fitTime(p.t), semicircles(p.lat), semicircles(p.lng),
    p.alt === null || p.alt === undefined ? null : Math.round((p.alt + 500) * 5),
    p.speed === null || p.speed === undefined ? null : Math.round(p.speed * 1000),
    p.distance === null || p.distance === undefined ? null : Math.round(p.distance * 100),
    p.hr === null || p.hr === undefined ? null : p.hr,
  ];
}

export type SessionInfo = { t: number; start: number; sport: number; subSport?: number; elapsedS: number; timerS: number; distanceM: number; kcal?: number | null; ascentM?: number | null };

export function sessionValues(s: SessionInfo): Array<number | null> {
  return [fitTime(s.t), fitTime(s.start), s.sport, s.subSport ?? 0, Math.round(s.elapsedS * 1000), Math.round(s.timerS * 1000), Math.round(s.distanceM * 100), s.kcal ?? null, s.ascentM ?? null];
}
