import type { ActivitySource, ImportFormat } from "./types";

/*
 * How FITX says where an activity's data came from: recorded on the Record screen with the phone's
 * GPS, or imported from a file a watch or another app exported (with the device or app the file
 * names, never a guess).
 */

const FORMAT: Record<ImportFormat, string> = { gpx: "GPX", tcx: "TCX", fit: "FIT" };

export type SourceInfo = { source: ActivitySource; sourceFormat: ImportFormat | null; sourceDevice: string | null };

/** "Recorded with FITX", or "Imported · Garmin Forerunner 255 · FIT". */
export function sourceLabel(info: SourceInfo): string {
  if (info.source !== "file") return "Recorded with FITX";
  const parts = ["Imported"];
  if (info.sourceDevice) parts.push(info.sourceDevice);
  if (info.sourceFormat) parts.push(info.sourceDevice ? FORMAT[info.sourceFormat] : `${FORMAT[info.sourceFormat]} file`);
  return parts.join(" · ");
}

/** Calorie figures a device estimated (imported files) say so in their method text, which starts with this. */
export const DEVICE_KCAL_PREFIX = "Estimated by ";

export function kcalFromDevice(info: { source: ActivitySource; kcalMethod: string | null }): boolean {
  return info.source === "file" && (info.kcalMethod ?? "").startsWith(DEVICE_KCAL_PREFIX);
}

/** The longer sentence for an activity page. */
export function sourceSentence(info: SourceInfo): string {
  if (info.source !== "file") return "Recorded with FITX using your phone’s GPS.";
  const file = info.sourceFormat ? `a ${FORMAT[info.sourceFormat]} file` : "a file";
  return info.sourceDevice
    ? `Imported from ${file} from ${info.sourceDevice}. FITX worked out the numbers from the file’s points with the same rules as its own recordings.`
    : `Imported from ${file}. FITX worked out the numbers from the file’s points with the same rules as its own recordings.`;
}
