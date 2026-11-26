"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type Ref } from "react";
import { Check, ChevronDown, ChevronLeft, CircleAlert, CopyCheck, FileUp, Info, LoaderCircle, ShieldCheck, TriangleAlert, Watch, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { SPORT_LABEL, SPORT_NOUN } from "@/lib/activity/config";
import { focusDropped, handsFocusOn } from "@/lib/activity/focus";
import { formatActivityDate, formatDistance, formatDuration, formatDurationWords } from "@/lib/activity/format";
import { readActivityFile } from "@/lib/activity/import/detect";
import { importClientId } from "@/lib/activity/import/fingerprint";
import { canRemove, importFocusAfter, importFocusWitness, type ListedFile } from "@/lib/activity/import/focus";
import { checkImport, fullestOfEachSession, importBarShown, knownKey, lookupWindow, mergeKnown, OVERLAP_TOLERANCE_MS, refillsSaved, saveFailure, settleRepeat, shouldCountPoints, summariseResults, type Candidate, type ImportCheck, type ImportResult, type KnownActivity, type RecordShape } from "@/lib/activity/import/plan";
import { buildImportRecord, checkStartTime, FORMAT_LABEL, POINTS_KEPT_DAYS } from "@/lib/activity/import/to-record";
import { IMPORT_LIMITS, ImportError, type ParsedImport } from "@/lib/activity/import/types";
import { timeRange } from "@/lib/activity/import/gpx";
import { recordingStore } from "@/lib/activity/local-store";
import { activitySourcesReady, countTrackChunks, findActivitiesBetween, findActivitiesByClientIds, replaceImportedActivity, saveImportedActivity, type ActivityView } from "@/lib/activity/repository";
import { PRIMARY_SPORTS, SPORTS, type Sport } from "@/lib/activity/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AccountError } from "./AccountError";
import { EXPORT_HELP } from "./import-help";
import { SportIcon } from "./sports";
import { useActivityV2 } from "./useActivityV2";
import { useActivityAccount } from "./useActivityAccount";

type Gate = "checking" | "ready" | "needs-update" | "unavailable" | "error";

type Preview = { sport: Sport; distanceM: number; movingSeconds: number; deviceDistanceM: number | null; kcalFromDevice: boolean; pointsDropped: boolean };

type Entry = {
  key: string;
  name: string;
  phase: "reading" | "ready" | "unsupported" | "failed" | "importing" | "done";
  parsed: ParsedImport | null;
  clientId: string | null;
  error: string;
  sport: Sport | null;
  preview: Preview | null;
  confirmOverlap: boolean;
  /** For a fuller export of a saved import: the person chose to replace the saved one with it. */
  confirmReplace: boolean;
  result: ImportResult | null;
};

const ACCEPT = ".gpx,.tcx,.fit,.gz,application/gpx+xml,application/vnd.garmin.tcx+xml,application/octet-stream,application/gzip";

function knownFromView(view: ActivityView): KnownActivity {
  return {
    id: view.id, clientId: view.clientId, sport: view.sport, title: view.title, startedAt: view.startedAt, endedAt: view.endedAt, source: view.source, local: view.local,
    pointCount: view.pointCount, chunkCount: view.chunkCount, sourceFormat: view.sourceFormat, distanceM: view.distanceM, movingSeconds: view.movingSeconds,
  };
}

/** What a file builds to with this sport (null when it can't be built), kept per file. */
const shapes = new WeakMap<ParsedImport, Map<Sport, RecordShape | null>>();
function shapeFor(parsed: ParsedImport, sport: Sport): RecordShape | null {
  let bySport = shapes.get(parsed);
  if (!bySport) shapes.set(parsed, (bySport = new Map()));
  if (!bySport.has(sport)) {
    let shape: RecordShape | null = null;
    try {
      const { record } = buildImportRecord(parsed, { sport, clientId: "00000000-0000-4000-8000-000000000000", weightKg: null, importedAt: Date.now() });
      shape = { startedAt: record.startedAt, endedAt: record.endedAt, pointCount: record.pointCount, chunkCount: record.chunks.length, sourceFormat: record.sourceFormat ?? null, distanceM: record.distanceM, movingSeconds: record.movingSeconds };
    } catch {
      // A file that can't be built adds nothing.
    }
    bySport.set(sport, shape);
  }
  return bySport.get(sport) ?? null;
}

/** The numbers FITX will save for this file with this sport (replayed by its engine). */
function previewFor(parsed: ParsedImport, sport: Sport): Preview {
  const build = buildImportRecord(parsed, { sport, clientId: "00000000-0000-4000-8000-000000000000", weightKg: null, importedAt: Date.now() });
  return { sport, distanceM: build.record.distanceM, movingSeconds: build.record.movingSeconds, deviceDistanceM: build.deviceDistanceM, kcalFromDevice: build.kcalFromDevice, pointsDropped: build.pointsDropped };
}

function failureText(error: unknown): string {
  return error instanceof ImportError ? error.message : "This file couldn’t be read.";
}

const pointsIn = (parsed: ParsedImport) => parsed.segments.reduce((count, segment) => count + segment.length, 0);

/** A file's Remove in the list, found again by the file's key once the list has been drawn. */
function removeButton(list: HTMLElement | null, key: string): HTMLButtonElement | null {
  return Array.from(list?.querySelectorAll<HTMLButtonElement>('[data-import-control="remove"]') ?? []).find((button) => button.dataset.importFile === key) ?? null;
}

/**
 * The per-file check against the account and the files before it. Files chosen together that are one session
 * are imported once, from the one that holds the most of it: it is checked first, so the others are "the same
 * activity as" it.
 */
function computeChecks(entries: readonly Entry[], existing: readonly KnownActivity[]): Map<string, ImportCheck> {
  const checks = new Map<string, ImportCheck>();
  const earlier: Candidate[] = [];
  const ready = entries.filter((entry): entry is Entry & { parsed: ParsedImport; clientId: string } => entry.phase === "ready" && entry.parsed !== null && entry.clientId !== null);
  const fullest = fullestOfEachSession(ready.map((entry) => ({ key: entry.key, clientId: entry.clientId, endedAt: entry.parsed.endedAt, pointCount: pointsIn(entry.parsed) })));
  for (const entry of [...ready.filter((item) => fullest.has(item.key)), ...ready.filter((item) => !fullest.has(item.key))]) {
    const candidate: Candidate = { key: entry.key, clientId: entry.clientId, startedAt: entry.parsed.startedAt, endedAt: entry.parsed.endedAt };
    let check = checkImport(candidate, existing, earlier);
    // Only the file that made an incomplete activity can fill in its points (another export of the session has
    // other points); a fuller export of a saved import is offered as its replacement.
    if (check.kind === "incomplete" || check.kind === "already") check = settleRepeat(check, shapeFor(entry.parsed, check.activity.sport));
    checks.set(entry.key, check);
    if (check.kind !== "already" && check.kind !== "same-file") earlier.push(candidate);
  }
  return checks;
}

function SportChoice({ entry, onChoose, importSports }: { entry: Entry; onChoose: (sport: Sport) => void; importSports: readonly Sport[] }) {
  const said = entry.parsed?.sport;
  return (
    <div className="mt-3">
      <p className="text-xs text-fitx-text-secondary">
        {said?.kind === "known" ? `The file says ${said.label.toLowerCase()}. Change it if that’s wrong.` : said?.label ? `The file says “${said.label}”. Choose what it was:` : "The file doesn’t say the sport. Choose what it was:"}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label={`Sport for ${entry.name}`}>
        {importSports.map((sport) => (
          <button key={sport} type="button" aria-pressed={entry.sport === sport} onClick={() => onChoose(sport)}
            className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors", entry.sport === sport ? "border-fitx-primary bg-fitx-primary/10 text-fitx-primary-text" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40 hover:text-fitx-text")}>
            <SportIcon sport={sport} size={16} />{SPORT_LABEL[sport]}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckLine({ entry, check, names, checking, unchecked, onConfirm, onReplace }: { entry: Entry; check: ImportCheck | undefined; names: Map<string, string>; checking: boolean; unchecked: boolean; onConfirm: (value: boolean) => void; onReplace: (value: boolean) => void }) {
  if (checking && (!check || check.kind === "ready")) {
    return <p className="mt-3 flex items-center gap-1.5 text-xs text-fitx-text-secondary" role="status"><LoaderCircle size={14} aria-hidden="true" className="animate-spin" />Checking your activities for this session…</p>;
  }
  if (unchecked && (!check || check.kind === "ready" || check.kind === "overlap")) {
    return <p className="mt-3 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><CircleAlert size={14} aria-hidden="true" />Not checked against your activities yet, so it can’t be imported.</p>;
  }
  if (check?.kind === "incomplete") {
    return <p className="mt-3 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Info size={14} aria-hidden="true" className="text-fitx-info" />Already in FITX without all its GPS points. Importing it again adds them.</p>;
  }
  if (check?.kind === "fuller") {
    const saved = check.activity;
    const noun = SPORT_NOUN[saved.sport];
    const shape = entry.parsed ? shapeFor(entry.parsed, saved.sport) : null;
    const figures = (distanceM: number | undefined, movingSeconds: number | undefined) => (distanceM !== undefined && movingSeconds !== undefined ? `${formatDistance(distanceM)} in ${formatDuration(movingSeconds)}` : null);
    const savedFigures = figures(saved.distanceM, saved.movingSeconds);
    const fileFigures = figures(shape?.distanceM, shape?.movingSeconds);
    return (
      <div className="mt-3 rounded-lg border border-fitx-border bg-fitx-surface-variant p-3">
        <p className="flex gap-1.5 text-xs text-fitx-text">
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info" />
          <span>
            A shorter copy of this {noun} is in FITX{savedFigures ? `: ${savedFigures}` : ""}. This file has more of it{fileFigures ? `: ${fileFigures}` : ""}.{" "}
            {saved.id && <Link href={`/activity/${saved.id}`} className="font-medium text-fitx-primary-text underline underline-offset-2">Open the saved {noun}</Link>}
          </span>
        </p>
        <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fitx-text">
          <input type="checkbox" checked={entry.confirmReplace} onChange={(event) => onReplace(event.target.checked)} className="h-5 w-5 accent-fitx-primary" />
          Replace the saved {noun} with this file
        </label>
        <p className="mt-1 text-[11px] leading-4 text-fitx-text-secondary">Its name and sport stay as they are; its distance, times and route come from this file.</p>
      </div>
    );
  }
  if (!check || check.kind === "ready") {
    return entry.sport
      ? <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-fitx-success"><Check size={14} aria-hidden="true" />Ready to import</p>
      : <p className="mt-3 text-xs font-medium text-fitx-text-secondary">Choose a sport to import it.</p>;
  }
  if (check.kind === "already") {
    const href = check.activity.local ? `/activity/local-${check.activity.clientId}` : check.activity.id ? `/activity/${check.activity.id}` : null;
    return (
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fitx-text-secondary">
        <CopyCheck size={14} aria-hidden="true" className="text-fitx-primary" />Already in FITX, so it won’t be imported again.
        {href && <Link href={href} className="font-medium text-fitx-primary-text underline underline-offset-2">Open it</Link>}
      </p>
    );
  }
  if (check.kind === "same-file") {
    return <p className="mt-3 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><CopyCheck size={14} aria-hidden="true" className="text-fitx-primary" />Same activity as {names.get(check.otherKey) ?? "another file"}, which has as much of it or more: that one is imported.</p>;
  }
  const other = check.activity
    ? `your ${check.activity.source === "file" ? "imported" : "FITX"} ${SPORT_NOUN[check.activity.sport]} of ${formatActivityDate(check.activity.startedAt)}`
    : names.get(check.otherKey ?? "") ?? "another file";
  return (
    <div className="mt-3 rounded-lg border border-fitx-border bg-fitx-surface-variant p-3">
      <p className="flex gap-1.5 text-xs text-fitx-text"><TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" /><span>Overlaps {other}. It may be the same session recorded twice, so it’s skipped unless you say so. Importing both counts the time twice in your totals.</span></p>
      <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fitx-text">
        <input type="checkbox" checked={entry.confirmOverlap} onChange={(event) => onConfirm(event.target.checked)} className="h-5 w-5 accent-fitx-primary" />
        Import it anyway
      </label>
    </div>
  );
}

function ResultLine({ result }: { result: ImportResult }) {
  if (result.kind === "imported") {
    return <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm font-medium text-fitx-success"><Check size={16} aria-hidden="true" />Imported<Link href={`/activity/${result.id}`} className="text-fitx-primary-text underline underline-offset-2">Open activity</Link></p>;
  }
  if (result.kind === "replaced") {
    return <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm font-medium text-fitx-success"><Check size={16} aria-hidden="true" />Replaced the shorter copy<Link href={`/activity/${result.id}`} className="text-fitx-primary-text underline underline-offset-2">Open activity</Link></p>;
  }
  if (result.kind === "already") {
    return <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-fitx-text-secondary"><CopyCheck size={16} aria-hidden="true" className="text-fitx-primary" />Already in FITX{result.id && <Link href={`/activity/${result.id}`} className="font-medium text-fitx-primary-text underline underline-offset-2">Open it</Link>}</p>;
  }
  if (result.kind === "kept") {
    return <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-fitx-text-secondary"><Info size={16} aria-hidden="true" className="text-fitx-info" />Not imported: the shorter copy in FITX is kept{result.id && <Link href={`/activity/${result.id}`} className="font-medium text-fitx-primary-text underline underline-offset-2">Open it</Link>}</p>;
  }
  if (result.kind === "skipped") {
    return <p className="mt-3 flex items-center gap-1.5 text-sm text-fitx-text-secondary"><Info size={16} aria-hidden="true" className="text-fitx-info" />{result.reason === "overlap" ? "Skipped: it overlaps another activity." : "Skipped: the same activity is in another file."}</p>;
  }
  if (result.kind === "unsupported") {
    return <p className="mt-3 flex items-center gap-1.5 text-sm text-fitx-text-secondary"><CircleAlert size={16} aria-hidden="true" />Not imported: {result.label} isn’t a sport FITX records.</p>;
  }
  return <p className="mt-3 flex gap-1.5 text-sm text-fitx-danger"><CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />Not imported: {result.reason}</p>;
}

function FileCard({ entry, check, names, onSport, onConfirm, onReplace, onRemove, removeRef, busy, checking = false, unchecked = false, importSports }: { entry: Entry; check: ImportCheck | undefined; names: Map<string, string>; importSports: readonly Sport[]; onSport: (sport: Sport) => void; onConfirm: (value: boolean) => void; onReplace: (value: boolean) => void; onRemove: () => void; removeRef: Ref<HTMLButtonElement>; busy: boolean; checking?: boolean; unchecked?: boolean }) {
  const parsed = entry.parsed;
  const preview = entry.preview;
  const deviceDiffers = preview && preview.deviceDistanceM !== null && Math.abs(preview.deviceDistanceM - preview.distanceM) > Math.max(50, preview.distanceM * 0.01);
  return (
    <li className="fitx-panel p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-fitx-surface-variant text-[11px] font-bold tracking-wide text-fitx-text-secondary" aria-hidden="true">
          {parsed ? FORMAT_LABEL[parsed.format] : entry.phase === "reading" ? <LoaderCircle size={18} className="animate-spin" /> : "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fitx-text">{entry.name}</p>
          {parsed ? (
            <>
              <p className="mt-0.5 text-xs text-fitx-text-secondary">{formatActivityDate(parsed.startedAt)} · {formatDurationWords((parsed.endedAt - parsed.startedAt) / 1000)} long</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Watch size={13} aria-hidden="true" />{parsed.device ?? "The file doesn’t name its device"}</p>
            </>
          ) : entry.phase === "reading" ? (
            <p className="mt-0.5 text-xs text-fitx-text-secondary" role="status">Reading…</p>
          ) : null}
        </div>
        {/* Goes with its card; the next file's Remove, else the one before it, else Choose files takes focus (D5). */}
        {canRemove(entry.phase, busy) && (
          <button type="button" ref={removeRef} data-import-control="remove" data-import-file={entry.key} onClick={onRemove} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label={`Remove ${entry.name}`}><X size={17} aria-hidden="true" /></button>
        )}
      </div>

      {preview && (
        <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-fitx-surface-variant p-3 sm:grid-cols-3">
          <div><dt className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Distance</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-fitx-text">{formatDistance(preview.distanceM)}</dd></div>
          <div><dt className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Moving time</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-fitx-text">{formatDuration(preview.movingSeconds)}</dd></div>
          {deviceDiffers && <div className="col-span-2 sm:col-span-1"><dt className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Your device said</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums text-fitx-text-secondary">{formatDistance(preview.deviceDistanceM as number)}</dd></div>}
        </dl>
      )}
      {preview && (
        <p className="mt-2 text-[11px] leading-4 text-fitx-text-secondary">
          FITX works out distance and time from the file’s points with the same rules as its own recordings{deviceDiffers ? ", so it can differ a little from your device" : ""}.
          {preview.kcalFromDevice ? " Calories are your device’s estimate." : ""}
          {preview.pointsDropped ? " It ended more than 90 days ago, so only its route is kept, not every point." : ""}
        </p>
      )}

      {entry.result ? (
        <ResultLine result={entry.result} />
      ) : entry.phase === "importing" ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-fitx-text-secondary" role="status"><LoaderCircle size={16} aria-hidden="true" className="animate-spin" />Importing…</p>
      ) : entry.phase === "failed" ? (
        <p className="mt-3 flex gap-1.5 text-sm text-fitx-danger"><CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{entry.error}</p>
      ) : entry.phase === "unsupported" && parsed?.sport.kind === "unsupported" ? (
        <p className="mt-3 flex gap-1.5 text-sm text-fitx-text-secondary"><CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{parsed.sport.label} isn’t one of the sports FITX records, so it can’t be imported.</p>
      ) : entry.phase === "ready" && check?.kind !== "already" && check?.kind !== "same-file" && check?.kind !== "incomplete" && check?.kind !== "fuller" ? (
        <>
          <SportChoice entry={entry} onChoose={onSport} importSports={importSports} />
          <CheckLine entry={entry} check={check} names={names} checking={checking} unchecked={unchecked} onConfirm={onConfirm} onReplace={onReplace} />
        </>
      ) : entry.phase === "ready" ? (
        <CheckLine entry={entry} check={check} names={names} checking={checking} unchecked={unchecked} onConfirm={onConfirm} onReplace={onReplace} />
      ) : null}
    </li>
  );
}

/**
 * Import activities from files a watch or another app exported (GPX, TCX, FIT, also
 * .gz). Files are read on this device; only the derived activity is saved, through the same
 * idempotent save as FITX's own recordings, so importing a file twice never duplicates it.
 */
export function ActivityImportScreen() {
  const account = useActivityAccount();
  const [gate, setGate] = useState<Gate>("checking");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [existing, setExisting] = useState<KnownActivity[]>([]);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  // The account couldn't be checked for repeats and overlaps: nothing is imported until it has been.
  const [lookupFailed, setLookupFailed] = useState(false);
  // How many checks have failed: the alert stays while Check again checks (so focus stays on it, D5), and a check that
  // fails again draws its message anew, so it is read out again.
  const [lookupFailures, setLookupFailures] = useState(0);
  const counter = useRef(0);
  // Import was pressed. Once every file has its result the bar goes with its button (nothing is left for it to do), so
  // the result ("2 imported.", partial results and failures too) takes focus if it fell to the page (D5).
  const importPressed = useRef(false);
  const summaryRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (importing || !importPressed.current) return;
    importPressed.current = false;
    if (handsFocusOn(document, { pressed: true, wentWithFocus: false })) summaryRef.current?.focus();
  }, [importing]);
  // The newer sports only once the database takes them (migration 20261123100050).
  const v2 = useActivityV2(account.status === "ready" ? account.userId : null);
  const importSports: readonly Sport[] = v2 ? SPORTS : PRIMARY_SPORTS;
  // Files read before the check finished: once the newer sports are known to be accepted, take the file's own sport.
  const [v2Applied, setV2Applied] = useState(false);
  if (v2 === true && !v2Applied) {
    setV2Applied(true);
    setEntries((list) => list.map((entry) => (entry.phase === "ready" && !entry.sport && entry.parsed?.sport.kind === "known"
      ? { ...entry, sport: entry.parsed.sport.sport, preview: previewFor(entry.parsed, entry.parsed.sport.sport) }
      : entry)));
  }
  const userId = account.status === "ready" ? account.userId : null;
  const weightKg = account.status === "ready" ? account.weightKg : null;

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void activitySourcesReady(supabase, userId).then((result) => {
      if (!active) return;
      if (result.status === "ok") setGate(result.data ? "ready" : "needs-update");
      else setGate(result.status === "unavailable" ? "unavailable" : "error");
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const checks = useMemo(() => computeChecks(entries, existing), [entries, existing]);
  const names = useMemo(() => new Map(entries.map((entry) => [entry.key, entry.name])), [entries]);

  const update = useCallback((key: string, change: Partial<Entry> | ((entry: Entry) => Partial<Entry>)) => {
    setEntries((list) => list.map((entry) => (entry.key === key ? { ...entry, ...(typeof change === "function" ? change(entry) : change) } : entry)));
  }, []);

  /**
   * Looks up what the account (and this device) already holds around these files' times. False
   * when the account couldn't be read: the files are then unchecked, so none of them is imported.
   */
  const lookUp = useCallback(async (list: readonly Entry[]): Promise<boolean> => {
    if (!userId) return false;
    const supabase = createClient();
    if (!supabase) return false;
    const ready = list.filter((entry) => entry.phase === "ready" && entry.parsed && entry.clientId);
    const candidates: Candidate[] = ready.map((entry) => ({ key: entry.key, clientId: entry.clientId as string, startedAt: entry.parsed!.startedAt, endedAt: entry.parsed!.endedAt }));
    const span = lookupWindow(candidates);
    if (!span) return true;
    const found: KnownActivity[] = [];
    const byId = await findActivitiesByClientIds(supabase, userId, candidates.map((candidate) => candidate.clientId));
    if (byId.status !== "ok") return false;
    // An earlier import that saved the activity but not all its points is offered again to add them.
    const now = Date.now();
    for (const view of byId.data) {
      const known = knownFromView(view);
      if (shouldCountPoints(view, now, POINTS_KEPT_DAYS)) {
        const stored = await countTrackChunks(supabase, userId, view.id as string);
        if (stored.status !== "ok") return false;
        known.missingPoints = stored.data < view.chunkCount;
      }
      found.push(known);
    }
    const around = await findActivitiesBetween(supabase, userId, span.from - OVERLAP_TOLERANCE_MS, span.to + OVERLAP_TOLERANCE_MS);
    if (around.status !== "ok") return false;
    // The client-id matches come first and win below; these add the activities around the files.
    found.push(...around.data.filter((view) => !byId.data.some((match) => match.clientId === view.clientId)).map(knownFromView));
    // A long span (a history import) may hold more than one page: then each file is looked up on its own.
    if (around.data.length >= 1000) {
      for (const candidate of candidates) {
        const near = await findActivitiesBetween(supabase, userId, candidate.startedAt - OVERLAP_TOLERANCE_MS, candidate.endedAt + OVERLAP_TOLERANCE_MS, 50);
        if (near.status !== "ok") return false;
        found.push(...near.data.filter((view) => !byId.data.some((match) => match.clientId === view.clientId)).map(knownFromView));
      }
    }
    try {
      const store = await recordingStore();
      for (const recording of await store.listRecordings(userId)) {
        if (recording.state !== "finished" || !recording.record) continue;
        const record = recording.record;
        found.push({ id: null, clientId: record.clientId, sport: record.sport, title: record.title, startedAt: record.startedAt, endedAt: record.endedAt, source: record.source ?? "fitx_gps", local: true });
      }
    } catch {
      // No device storage: nothing recorded offline to compare with.
    }
    const unique = new Map<string, KnownActivity>();
    for (const activity of found) unique.set(knownKey(activity), activity);
    // An activity found again only by time keeps the points count an earlier lookup made.
    setExisting((previous) => mergeKnown(previous, [...unique.values()]));
    return true;
  }, [userId]);

  async function addFiles(files: readonly File[]) {
    if (!files.length || reading || importing) return;
    setSummary("");
    const room = Math.max(0, IMPORT_LIMITS.maxFiles - entries.length);
    const chosen = files.slice(0, room);
    setNotice(files.length > room ? `FITX reads up to ${IMPORT_LIMITS.maxFiles} files at a time; ${files.length - room} ${files.length - room === 1 ? "was" : "were"} left out. Import these first, then choose the rest.` : "");
    if (!chosen.length) return;
    const fresh: Entry[] = chosen.map((file) => ({
      key: `file-${++counter.current}`, name: file.name || "Activity file", phase: "reading", parsed: null, clientId: null, error: "", sport: null, preview: null, confirmOverlap: false, confirmReplace: false, result: null,
    }));
    setEntries((list) => [...list, ...fresh]);
    setReading(true);
    const readEntries: Entry[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const file = chosen[i];
      const entry = fresh[i];
      let next: Entry;
      try {
        if (file.size > IMPORT_LIMITS.maxFileBytes) throw new ImportError("too-large", "This file is too large to import (the limit is 30 MB).");
        const parsed = await readActivityFile(new Uint8Array(await file.arrayBuffer()));
        // Refused before anything else is asked (the sport): a start after now can't be placed in your weeks.
        checkStartTime(parsed, Date.now());
        const clientId = await importClientId(timeRange(parsed.segments).first);
        if (parsed.sport.kind === "unsupported") {
          next = { ...entry, phase: "unsupported", parsed, clientId };
        } else {
          // A sport this database can't take yet is left for the person to choose.
          const sport = parsed.sport.kind === "known" && importSports.includes(parsed.sport.sport) ? parsed.sport.sport : null;
          next = { ...entry, phase: "ready", parsed, clientId, sport, preview: sport ? previewFor(parsed, sport) : null };
        }
      } catch (error) {
        next = { ...entry, phase: "failed", error: failureText(error) };
      }
      readEntries.push(next);
      update(entry.key, next);
      // Let the page breathe between files.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    // Importing waits until the account has been checked for these sessions (repeats and overlaps).
    // After a failed check, the earlier files are checked again with the new ones.
    const ok = await lookUp(lookupFailed ? [...entries, ...readEntries] : readEntries).catch(() => false);
    setLookupFailed(!ok);
    if (!ok) setLookupFailures((count) => count + 1);
    setReading(false);
  }

  async function checkAgain() {
    // Check again says aria-disabled while it checks (disabled would drop keyboard focus; D5): a press then does nothing.
    if (reading || importing) return;
    setReading(true);
    const ok = await lookUp(entries).catch(() => false);
    setLookupFailed(!ok);
    if (!ok) setLookupFailures((count) => count + 1);
    setReading(false);
  }

  function chooseSport(entry: Entry, sport: Sport) {
    if (!entry.parsed) return;
    try {
      update(entry.key, { sport, preview: previewFor(entry.parsed, sport) });
    } catch (error) {
      update(entry.key, { phase: "failed", error: failureText(error) });
    }
  }

  function chooseSportForUnknown(sport: Sport) {
    for (const entry of entries) if (entry.phase === "ready" && !entry.sport && entry.parsed?.sport.kind === "unknown") chooseSport(entry, sport);
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? [...event.target.files] : [];
    event.target.value = "";
    void addFiles(files);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer?.files ? [...event.dataTransfer.files] : []);
  }

  /** The sport to save with: an earlier import being filled in or replaced keeps the sport it was saved with. */
  const sportOf = (entry: Entry): Sport | null => {
    const check = checks.get(entry.key);
    return check?.kind === "incomplete" || check?.kind === "fuller" ? check.activity.sport : entry.sport;
  };
  const importable = (entry: Entry) => {
    const check = checks.get(entry.key);
    return !lookupFailed && entry.phase === "ready" && !entry.result && sportOf(entry) !== null && entry.parsed !== null && entry.clientId !== null && check !== undefined
      && (check.kind === "ready" || check.kind === "incomplete" || (check.kind === "overlap" && entry.confirmOverlap) || (check.kind === "fuller" && entry.confirmReplace));
  };
  const toImport = entries.filter(importable);
  const unknownSport = entries.filter((entry) => {
    const kind = checks.get(entry.key)?.kind;
    return entry.phase === "ready" && !entry.result && !entry.sport && entry.parsed?.sport.kind === "unknown" && kind !== "incomplete" && kind !== "fuller";
  }).length;
  const barShown = importBarShown(entries.map((entry) => ({ phase: entry.phase, done: entry.result !== null, sport: sportOf(entry) })), importing);

  // D5: a file's Remove goes with its card, Clear list with the whole list, Check again with its alert once a check
  // works, and "Set them all to:" once every file has its sport; the browser dropped focus to the page. One ref sees
  // which control went with focus (importFocusWitness), and once that draw is done focus moves to what is left in its
  // place (importFocusAfter): only while the page has focus, so focus the member moved stays where it is. Import's own
  // hand-off is importPressed's, above.
  const [{ ref: controlRef, take: controlWent }] = useState(() => importFocusWitness<HTMLElement>());
  const drawnFiles = useRef<readonly ListedFile[]>([]);
  const listRef = useRef<HTMLUListElement | null>(null);
  const chooseRef = useRef<HTMLInputElement | null>(null);
  const filesTitleRef = useRef<HTMLHeadingElement | null>(null);
  const importButtonRef = useRef<HTMLButtonElement | null>(null);
  const listed: ListedFile[] = entries.map((entry) => ({ key: entry.key, removable: canRemove(entry.phase, importing) }));
  const importReady = gate === "ready" && barShown && toImport.length > 0;
  useEffect(() => {
    const before = drawnFiles.current;
    drawnFiles.current = listed;
    const went = controlWent();
    if (!went || !focusDropped(document)) return;
    const target = importFocusAfter(went, { before, after: listed, importReady });
    if (target === "choose") chooseRef.current?.focus();
    else if (target === "import") importButtonRef.current?.focus();
    else if (target === "files") filesTitleRef.current?.focus();
    else removeButton(listRef.current, target.remove)?.focus();
  });

  async function importAll() {
    // The button says aria-disabled while it imports, and once nothing is left to import (disabled would drop keyboard
    // focus; D5): a press then does nothing.
    if (!userId || importing || reading || lookupFailed || toImport.length === 0) return;
    const supabase = createClient();
    if (!supabase) return;
    importPressed.current = true;
    setImporting(true);
    setSummary("");
    const results: ImportResult[] = [];
    // Files that won't be imported say why.
    for (const entry of entries) {
      if (entry.result || importable(entry)) continue;
      const check = checks.get(entry.key);
      let result: ImportResult | null = null;
      if (entry.phase === "failed") result = { kind: "failed", reason: entry.error };
      else if (entry.phase === "unsupported" && entry.parsed?.sport.kind === "unsupported") result = { kind: "unsupported", label: entry.parsed.sport.label };
      else if (check?.kind === "already") result = { kind: "already", id: check.activity.id };
      else if (check?.kind === "fuller") result = { kind: "kept", id: check.activity.id };
      else if (check?.kind === "same-file") result = { kind: "skipped", reason: "same-file" };
      else if (check?.kind === "overlap" && entry.sport) result = { kind: "skipped", reason: "overlap" };
      if (result) {
        results.push(result);
        update(entry.key, { result, phase: "done" });
      }
    }
    let stopped: string | null = null;
    for (const entry of toImport) {
      if (stopped) {
        const result: ImportResult = { kind: "failed", reason: stopped };
        results.push(result);
        update(entry.key, { result, phase: "done" });
        continue;
      }
      update(entry.key, { phase: "importing" });
      let result: ImportResult;
      try {
        const check = checks.get(entry.key);
        // A replacement keeps the saved activity's name (and, through sportOf, its sport).
        const title = check?.kind === "fuller" ? check.activity.title : null;
        const build = buildImportRecord(entry.parsed as ParsedImport, { sport: sportOf(entry) as Sport, clientId: entry.clientId as string, weightKg, importedAt: Date.now(), title });
        if (check?.kind === "incomplete" && !refillsSaved(check.activity, { startedAt: build.record.startedAt, endedAt: build.record.endedAt, pointCount: build.record.pointCount, chunkCount: build.record.chunks.length, sourceFormat: build.record.sourceFormat ?? null })) {
          result = { kind: "already", id: check.activity.id };
          results.push(result);
          update(entry.key, { result, phase: "done" });
          continue;
        }
        // A save that fails part way is taken back out, so importing the file again starts clean. A replacement
        // changes the saved row in place (its points first), so it is never left with two files' points.
        const replacing = check?.kind === "fuller" && check.activity.id ? check.activity.id : null;
        const saved = replacing ? await replaceImportedActivity(supabase, userId, replacing, build.record) : await saveImportedActivity(supabase, userId, build.record);
        if (saved.status === "ok") {
          result = replacing ? { kind: "replaced", id: saved.data.id } : { kind: "imported", id: saved.data.id };
        } else {
          const failure = saveFailure(saved);
          if (failure.stop) stopped = failure.reason;
          result = { kind: "failed", reason: failure.reason };
        }
      } catch (error) {
        result = { kind: "failed", reason: failureText(error) };
      }
      results.push(result);
      update(entry.key, { result, phase: "done" });
    }
    setSummary(summariseResults(results));
    setImporting(false);
  }

  function clearList() {
    setEntries([]);
    setSummary("");
    setNotice("");
    setLookupFailed(false);
  }

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Imports aren’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "error") return <AccountError />;
  if (account.status === "signed-out") return <EmptyState title="Sign in to import activities" description="Imported activities are saved to your account." action={<Link href="/signin?next=/activity/import" className="fitx-button min-h-11">Sign in</Link>} />;

  const open = gate === "ready";
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/activity" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Back to activity"><ChevronLeft size={20} aria-hidden="true" /></Link>
        <p className="text-sm text-fitx-text-secondary">Activity</p>
      </div>
      <header>
        <h1 className="text-[26px] font-bold leading-tight tracking-[-.03em] text-fitx-text sm:text-[30px]">Import activities</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-fitx-text-secondary">Bring in activities recorded on a watch or another app, as GPX, TCX or FIT files. FITX reads them on this device and saves each activity once, however many times you import it.</p>
      </header>

      {gate === "checking" && <div className="h-40 animate-pulse rounded-xl bg-fitx-surface-variant" aria-hidden="true" />}
      {(gate === "needs-update" || gate === "unavailable") && (
        <p role="status" className="fitx-alert flex gap-2"><Info size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info" /><span><span className="font-semibold">Imports switch on after the next database update.</span> Until then FITX can’t save imported activities. Recording on the Record screen works as usual.</span></p>
      )}
      {gate === "error" && (
        <p role="alert" className="fitx-alert fitx-alert-danger">FITX couldn’t check whether imports are ready. Check your connection and reload this page.</p>
      )}

      {open && (
        <section
          aria-labelledby="pick-title"
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn("rounded-2xl border-2 border-dashed p-5 text-center transition-colors sm:p-8", dragging ? "border-fitx-primary bg-fitx-primary/5" : "border-fitx-border bg-fitx-surface")}
        >
          <FileUp size={28} aria-hidden="true" className="mx-auto text-fitx-primary" />
          <h2 id="pick-title" className="mt-2 text-base font-semibold text-fitx-text">Choose activity files</h2>
          <p className="mt-1 text-sm text-fitx-text-secondary">GPX, TCX or FIT, also .gz. Up to {IMPORT_LIMITS.maxFiles} at a time.<span className="hidden sm:inline"> You can drop them here too.</span></p>
          <label className={cn("fitx-button mt-4 min-h-12 cursor-pointer px-6 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-fitx-primary", (reading || importing) && "pointer-events-none opacity-60")}>
            <FileUp size={17} aria-hidden="true" />Choose files
            {/* Not disabled while files are read or imported, so keyboard focus stays here (D5): the picker doesn't open meanwhile. */}
            <input ref={chooseRef} type="file" multiple accept={ACCEPT} className="sr-only" onChange={onPick} aria-disabled={reading || importing || undefined} onClick={(event) => { if (reading || importing) event.preventDefault(); }} />
          </label>
        </section>
      )}

      {notice && <p role="status" className="fitx-alert">{notice}</p>}

      {entries.length > 0 && (
        <section aria-labelledby="files-title" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="files-title" ref={filesTitleRef} tabIndex={-1} className="text-sm font-semibold text-fitx-text">{entries.length} {entries.length === 1 ? "file" : "files"}</h2>
            {/* Goes with the list: Choose files takes focus (D5). */}
            {!importing && <button type="button" ref={controlRef} data-import-control="clear" onClick={clearList} className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm">Clear list</button>}
          </div>
          {/* Stays while it checks again, so Check again keeps focus (aria-disabled meanwhile) and keeps it when the check
              fails again, the message drawn anew to be read out again; once a check works it goes, and the Import
              button, else the files' heading, takes focus (D5). */}
          {lookupFailed && (
            <div className="fitx-alert fitx-alert-danger flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p key={lookupFailures} role="alert">FITX couldn’t check your activities for these sessions, so nothing can be imported yet. Check your connection and try again.</p>
              <button type="button" ref={controlRef} data-import-control="check" onClick={() => void checkAgain()} aria-disabled={reading || importing || undefined} className="fitx-button fitx-button-secondary min-h-11 shrink-0 aria-disabled:cursor-progress aria-disabled:opacity-60">
                {reading ? <><LoaderCircle size={17} aria-hidden="true" className="animate-spin" />Checking…</> : "Check again"}
              </button>
            </div>
          )}
          {/* Goes once every file has its sport: the Import button, else the files' heading, takes focus (D5). */}
          {unknownSport > 1 && !importing && (
            <div className="fitx-panel p-4">
              <p className="text-sm text-fitx-text">{unknownSport} files don’t say their sport. Set them all to:</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="Sport for files that don’t say">
                {importSports.map((sport) => (
                  <button key={sport} type="button" ref={controlRef} data-import-control="set-all" onClick={() => chooseSportForUnknown(sport)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-fitx-border text-sm font-medium text-fitx-text-secondary hover:border-fitx-primary/40 hover:text-fitx-text">
                    <SportIcon sport={sport} size={16} />{SPORT_LABEL[sport]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ul ref={listRef} className="space-y-3">
            {entries.map((entry) => (
              <FileCard
                key={entry.key}
                entry={entry}
                check={checks.get(entry.key)}
                names={names}
                importSports={importSports}
                busy={importing}
                checking={reading}
                unchecked={lookupFailed}
                onSport={(sport) => chooseSport(entry, sport)}
                onConfirm={(value) => update(entry.key, { confirmOverlap: value })}
                onReplace={(value) => update(entry.key, { confirmReplace: value })}
                onRemove={() => setEntries((list) => list.filter((item) => item.key !== entry.key))}
                removeRef={controlRef}
              />
            ))}
          </ul>
          {/* Floats above the phone's bar (from 768 px, near the window's foot), and 8 px above the privacy banner while
              that is open (--fitx-inset-consent), so Import stays in reach on a long list. Shown the whole time it imports. */}
          {open && barShown && (
            <div data-coach-avoid="" className="sticky bottom-[max(5rem,calc(var(--fitx-inset-consent,0px)+8px))] z-10 rounded-xl border border-fitx-border bg-fitx-elevated p-3 shadow-lg md:bottom-[max(1rem,calc(var(--fitx-inset-consent,0px)+8px))]">
              <button type="button" ref={importButtonRef} onClick={() => void importAll()} aria-disabled={importing || reading || toImport.length === 0 || undefined} className="fitx-button min-h-12 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-60">
                {importing ? <><LoaderCircle size={17} aria-hidden="true" className="animate-spin" />Importing…</> : toImport.length ? `Import ${toImport.length} ${toImport.length === 1 ? "activity" : "activities"}` : "Nothing to import yet"}
              </button>
            </div>
          )}
        </section>
      )}

      {/* The import's result, where the Import bar ends: it takes focus once the bar has gone (importPressed). */}
      <p ref={summaryRef} tabIndex={-1} role="status" aria-live="polite" className={cn("text-sm font-medium text-fitx-text", !summary && "sr-only")}>{summary}</p>

      <section className="fitx-panel p-4 sm:p-5" aria-labelledby="help-title">
        <h2 id="help-title" className="text-sm font-semibold text-fitx-text">How to get a file from your watch or app</h2>
        <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">FITX doesn’t connect to these services; you export a file there and choose it here.</p>
        <div className="mt-3 divide-y divide-fitx-divider rounded-xl border border-fitx-border">
          {EXPORT_HELP.map((help) => (
            <details key={help.id} className="group px-4">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-fitx-text">
                {help.name}
                <ChevronDown size={16} aria-hidden="true" className="text-fitx-text-secondary transition-transform group-open:rotate-180" />
              </summary>
              <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-xs leading-5 text-fitx-text-secondary">
                {help.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              {help.note && <p className="mb-3 text-xs leading-5 text-fitx-text-secondary">{help.note}</p>}
            </details>
          ))}
        </div>
      </section>

      <section className="fitx-panel p-4 sm:p-5" aria-labelledby="import-privacy-title">
        <h2 id="import-privacy-title" className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><ShieldCheck size={16} aria-hidden="true" className="text-fitx-primary" />What FITX keeps</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-fitx-text-secondary">
          <li>Files are read on this device and never uploaded. FITX saves the activity it works out from them: the summary, the route and the GPS points (points are deleted after 90 days, like your own recordings).</li>
          <li>The device or app the file names is saved with the activity, so you can always see where it came from.</li>
          <li>Heart rate in a file isn’t saved: FITX doesn’t keep heart-rate data yet.</li>
          <li>Routes stay private to your account. Share images leave out the area around the start and finish.</li>
        </ul>
      </section>
    </div>
  );
}
