import type { Fix, Sport } from "./types";

/*
 * GPX 1.1 export (so people can take their tracks to other apps) and a small reader for GPX
 * files (used by the tests to replay recorded or synthetic tracks through the engine).
 */

const GPX_TYPE: Record<Sport, string> = { walk: "walking", run: "running", ride: "cycling" };

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function toGpx(options: { name: string; sport: Sport; segments: ReadonlyArray<ReadonlyArray<Fix>> }): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="FITX" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <trk>",
    `    <name>${escapeXml(options.name)}</name>`,
    `    <type>${GPX_TYPE[options.sport]}</type>`,
  ];
  for (const segment of options.segments) {
    if (!segment.length) continue;
    lines.push("    <trkseg>");
    for (const fix of segment) {
      const ele = fix.alt === null ? "" : `<ele>${fix.alt.toFixed(1)}</ele>`;
      lines.push(`      <trkpt lat="${fix.lat.toFixed(7)}" lon="${fix.lng.toFixed(7)}">${ele}<time>${new Date(fix.t).toISOString()}</time></trkpt>`);
    }
    lines.push("    </trkseg>");
  }
  lines.push("  </trk>", "</gpx>", "");
  return lines.join("\n");
}

function attribute(tag: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(tag);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

function element(body: string, name: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(body);
  return match ? match[1].trim() : null;
}

/**
 * Reads the track segments of a GPX file as fixes. Accuracy comes from <hdop> (x 5 m, a common
 * rough conversion) when present, else `defaultAccuracyM`; speed from a <speed> element if any.
 * Points without a valid time or position are skipped.
 */
export function parseGpx(xml: string, defaultAccuracyM = 5): Fix[][] {
  const segments: Fix[][] = [];
  const segmentPattern = /<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g;
  const pointPattern = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
  let segmentMatch: RegExpExecArray | null;
  while ((segmentMatch = segmentPattern.exec(xml))) {
    const fixes: Fix[] = [];
    let pointMatch: RegExpExecArray | null;
    pointPattern.lastIndex = 0;
    while ((pointMatch = pointPattern.exec(segmentMatch[1]))) {
      const lat = attribute(pointMatch[1], "lat");
      const lng = attribute(pointMatch[1], "lon");
      const body = pointMatch[2] ?? "";
      const time = element(body, "time");
      const t = time ? Date.parse(time) : NaN;
      if (lat === null || lng === null || !Number.isFinite(t)) continue;
      const ele = element(body, "ele");
      const hdop = element(body, "hdop");
      const speed = element(body, "speed");
      const alt = ele === null ? null : Number(ele);
      const hdopValue = hdop === null ? NaN : Number(hdop);
      const speedValue = speed === null ? NaN : Number(speed);
      fixes.push({
        t,
        lat,
        lng,
        acc: Number.isFinite(hdopValue) ? hdopValue * 5 : defaultAccuracyM,
        alt: alt !== null && Number.isFinite(alt) ? alt : null,
        altAcc: null,
        speed: Number.isFinite(speedValue) ? speedValue : null,
      });
    }
    if (fixes.length) segments.push(fixes);
  }
  return segments;
}
