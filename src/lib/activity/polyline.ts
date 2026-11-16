import type { Fix, LatLng } from "./types";

/*
 * Compact text encodings used to store routes and GPS points.
 *
 * Both build on Google's encoded polyline algorithm: each integer is zig-zag encoded and written
 * as 5-bit groups in the printable ASCII range 63..126. Values are deltas from the previous
 * point, so typical GPS steps take one or two characters per field.
 */

function encodeSigned(value: number): string {
  let v = value < 0 ? -2 * value - 1 : 2 * value;
  let out = "";
  while (v >= 32) {
    out += String.fromCharCode((32 + (v % 32)) + 63);
    v = Math.floor(v / 32);
  }
  return out + String.fromCharCode(v + 63);
}

/** Reads one zig-zag integer starting at `index`; returns the value and the next index. */
function decodeSigned(text: string, index: number): [number, number] {
  let result = 0;
  let factor = 1;
  let byte: number;
  do {
    if (index >= text.length) throw new Error("Truncated polyline");
    byte = text.charCodeAt(index++) - 63;
    if (byte < 0 || byte > 63) throw new Error("Invalid polyline character");
    result += (byte % 32) * factor;
    factor *= 32;
  } while (byte >= 32);
  const value = result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  return [value, index];
}

/** Google encoded polyline of `points` (precision 5 = about 1 m, the common interchange format). */
export function encodePolyline(points: readonly LatLng[], precision = 5): string {
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    out += encodeSigned(lat - lastLat) + encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

export function decodePolyline(text: string, precision = 5): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let lat = 0;
  let lng = 0;
  let index = 0;
  while (index < text.length) {
    let delta: number;
    [delta, index] = decodeSigned(text, index);
    lat += delta;
    [delta, index] = decodeSigned(text, index);
    lng += delta;
    points.push({ lat: lat / factor, lng: lng / factor });
  }
  return points;
}

/** A route of several continuous stretches: one polyline each, separated by a space (never joined). */
export function encodeRoute(segments: readonly (readonly LatLng[])[], precision = 5): string {
  return segments.filter((segment) => segment.length > 0).map((segment) => encodePolyline(segment, precision)).join(" ");
}

export function decodeRoute(text: string | null | undefined, precision = 5): LatLng[][] {
  if (!text) return [];
  return text.split(" ").filter(Boolean).map((part) => decodePolyline(part, precision));
}

const FLAG_ALTITUDE = 1;
const FLAG_SPEED = 2;
const FLAG_ALTITUDE_ACCURACY = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Encodes GPS fixes for public.activity_track_chunks (encoding 1). Per fix:
 *   flags, time (0.1 s after `baseMs`), latitude and longitude (1e-6 degrees, about 0.1 m),
 *   accuracy (0.1 m), then altitude (0.1 m), speed (0.01 m/s) and altitude accuracy (1 m) when
 *   flagged. Every number except the flags is a delta from the previous fix that had it.
 */
export function encodeTrackChunk(fixes: readonly Fix[], baseMs: number): string {
  let last = { t: 0, lat: 0, lng: 0, acc: 0, alt: 0, speed: 0, altAcc: 0 };
  let out = "";
  for (const fix of fixes) {
    const t = Math.round((fix.t - baseMs) / 100);
    const lat = Math.round(fix.lat * 1e6);
    const lng = Math.round(fix.lng * 1e6);
    const acc = Math.round(clamp(fix.acc, 0, 100000) * 10);
    const hasAlt = fix.alt !== null && Number.isFinite(fix.alt);
    const hasSpeed = fix.speed !== null && Number.isFinite(fix.speed);
    const hasAltAcc = fix.altAcc !== null && Number.isFinite(fix.altAcc);
    const flags = (hasAlt ? FLAG_ALTITUDE : 0) | (hasSpeed ? FLAG_SPEED : 0) | (hasAltAcc ? FLAG_ALTITUDE_ACCURACY : 0);
    out += encodeSigned(flags) + encodeSigned(t - last.t) + encodeSigned(lat - last.lat) + encodeSigned(lng - last.lng) + encodeSigned(acc - last.acc);
    const next = { ...last, t, lat, lng, acc };
    if (hasAlt) {
      const alt = Math.round(clamp(fix.alt as number, -10000, 10000) * 10);
      out += encodeSigned(alt - last.alt);
      next.alt = alt;
    }
    if (hasSpeed) {
      const speed = Math.round(clamp(fix.speed as number, 0, 100) * 100);
      out += encodeSigned(speed - last.speed);
      next.speed = speed;
    }
    if (hasAltAcc) {
      const altAcc = Math.round(clamp(fix.altAcc as number, 0, 10000));
      out += encodeSigned(altAcc - last.altAcc);
      next.altAcc = altAcc;
    }
    last = next;
  }
  return out;
}

export function decodeTrackChunk(text: string, baseMs: number): Fix[] {
  const fixes: Fix[] = [];
  const last = { t: 0, lat: 0, lng: 0, acc: 0, alt: 0, speed: 0, altAcc: 0 };
  let index = 0;
  const read = () => {
    let value: number;
    [value, index] = decodeSigned(text, index);
    return value;
  };
  while (index < text.length) {
    const flags = read();
    last.t += read();
    last.lat += read();
    last.lng += read();
    last.acc += read();
    let alt: number | null = null;
    let speed: number | null = null;
    let altAcc: number | null = null;
    if (flags & FLAG_ALTITUDE) { last.alt += read(); alt = last.alt / 10; }
    if (flags & FLAG_SPEED) { last.speed += read(); speed = last.speed / 100; }
    if (flags & FLAG_ALTITUDE_ACCURACY) { last.altAcc += read(); altAcc = last.altAcc; }
    fixes.push({ t: baseMs + last.t * 100, lat: last.lat / 1e6, lng: last.lng / 1e6, acc: last.acc / 10, alt, altAcc, speed });
  }
  return fixes;
}
