import { ActivityEngine } from "./engine";
import { decodeTrackChunk } from "./polyline";
import type { ControlEvent, Fix, LogEntry, Sport } from "./types";

/** Controls that take effect before a fix with the same timestamp; the rest come after it. */
const BEFORE_FIXES = new Set<ControlEvent["type"]>(["start", "resume", "visible"]);

/**
 * Rebuilds a recording log from what the server stores: the control timeline (milliseconds after
 * the start) and the decoded GPS chunks. Used to redraw the detailed route and export GPX.
 */
export function logFromStored(sport: Sport, startedAt: number, timeline: ReadonlyArray<readonly [ControlEvent["type"], number]>, chunks: ReadonlyArray<{ seq: number; startedAt: number; points: string }>): LogEntry[] {
  const fixes: Fix[] = [...chunks].sort((a, b) => a.seq - b.seq).flatMap((chunk) => decodeTrackChunk(chunk.points, chunk.startedAt));
  const controls: ControlEvent[] = timeline.map(([type, offset]) => {
    const t = startedAt + offset;
    return type === "start" ? { type, t, sport } : ({ type, t } as ControlEvent);
  });
  const rank = (entry: LogEntry) => (entry.kind === "fix" ? 1 : BEFORE_FIXES.has(entry.event.type) ? 0 : 2);
  const time = (entry: LogEntry) => (entry.kind === "fix" ? entry.fix.t : entry.event.t);
  const entries: LogEntry[] = [
    ...controls.map((event): LogEntry => ({ kind: "control", event })),
    ...fixes.map((fix): LogEntry => ({ kind: "fix", fix })),
  ];
  // Stable: equal entries keep their original order (controls in timeline order, fixes in time order).
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => time(a.entry) - time(b.entry) || rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry);
}

export function replayStored(sport: Sport, startedAt: number, timeline: ReadonlyArray<readonly [ControlEvent["type"], number]>, chunks: ReadonlyArray<{ seq: number; startedAt: number; points: string }>): ActivityEngine {
  return ActivityEngine.replay(logFromStored(sport, startedAt, timeline, chunks));
}
