import { looksLikeFit, readFit } from "./fit";
import { readGpx } from "./gpx";
import { readTcx } from "./tcx";
import { IMPORT_LIMITS, ImportError, type ParsedImport } from "./types";

/*
 * Reads one activity file, whatever its format: FIT (".FIT" at byte 8), GPX ("<gpx") or TCX
 * ("<TrainingCenterDatabase"), also inside a .gz (Strava's bulk export gzips its files). Everything
 * happens on this device; the file itself is never uploaded.
 */

const isGzip = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
const isZip = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** Unpacks gzip data with the browser's DecompressionStream, stopping once it passes `limit` bytes. */
export async function gunzip(bytes: Uint8Array, limit: number = IMPORT_LIMITS.maxUnpackedBytes): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new ImportError("unknown-format", "This browser can’t open .gz files. Unpack the file first, then choose the file inside.");
  }
  const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ImportError("too-large", "This file is too large to import once unpacked.");
      }
      parts.push(value);
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("damaged", "This .gz file is damaged or cut short.");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Text of an XML file: UTF-8 unless it starts with a UTF-16 byte-order mark. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Which reader a file needs, from its first bytes (not its name, which can be wrong). */
export function sniffFormat(bytes: Uint8Array): "fit" | "gpx" | "tcx" | "gzip" | "zip" | null {
  if (looksLikeFit(bytes)) return "fit";
  if (isGzip(bytes)) return "gzip";
  if (isZip(bytes)) return "zip";
  const head = decodeText(bytes.subarray(0, 4096));
  if (/<(?:\w+:)?gpx[\s>]/.test(head)) return "gpx";
  if (/<(?:\w+:)?TrainingCenterDatabase[\s>]/.test(head)) return "tcx";
  return null;
}

/**
 * Reads an activity file into the import shape, or throws ImportError with a reason to show. The
 * whole activity must fit FITX's limits: at most 48 hours long.
 */
export async function readActivityFile(input: Uint8Array): Promise<ParsedImport> {
  if (input.byteLength > IMPORT_LIMITS.maxFileBytes) throw new ImportError("too-large", "This file is too large to import (the limit is 30 MB).");
  let bytes = input;
  let format = sniffFormat(bytes);
  if (format === "gzip") {
    bytes = await gunzip(bytes);
    format = sniffFormat(bytes);
    if (format === "gzip") throw new ImportError("unknown-format", "This file is packed twice. Unpack it, then choose the file inside.");
  }
  if (format === "zip") throw new ImportError("unknown-format", "This is a zip archive. Unpack it, then choose the .fit, .gpx or .tcx file inside.");
  if (!format) throw new ImportError("unknown-format", "FITX can read GPX, TCX and FIT files. This file isn’t one of them.");
  const parsed = format === "fit" ? readFit(bytes) : format === "gpx" ? readGpx(decodeText(bytes)) : readTcx(decodeText(bytes));
  if (parsed.endedAt - parsed.startedAt > 48 * 3600 * 1000) {
    throw new ImportError("too-long", "This activity is longer than 48 hours, the most FITX keeps for one activity.");
  }
  return parsed;
}
