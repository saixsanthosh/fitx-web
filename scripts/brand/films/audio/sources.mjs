/** The six owner-approved sources (sources.json), by id. Pure data: no file on disk is checked here (io.mjs does that). */
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("./sources.json", import.meta.url), "utf8"));

/** @type {ReadonlyMap<string, { id: string; n: number; use: string; title: string; author: string; page: string; file: string; bytes: number; sha256: string; duration: number; anchor: { kind: string; at: number; after?: number; how: string } }>} */
export const SOURCES = new Map(data.sources.map((source) => [source.id, Object.freeze(source)]));
export const SOURCE_LICENSE = data.license;

export function source(id) {
  const found = SOURCES.get(id);
  if (!found) throw new Error(`Unknown source ${id}`);
  return found;
}

/**
 * The `to` (source seconds) that ends a cue at the film's end at the latest, so the last cues of a film are cut
 * (with their fade) instead of running past it.
 */
export function fitTo(sourceId, at, filmDuration, wantedTo) {
  const { anchor, duration } = source(sourceId);
  const latest = anchor.at + (filmDuration - at);
  return Math.round(Math.min(wantedTo ?? duration, duration, latest) * 1000) / 1000;
}
