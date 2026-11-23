"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { ChevronDown, ChevronLeft, CloudOff, Download, Eye, EyeOff, Flag, Info, LocateFixed, Lock, Pause, Play, RefreshCw, ShieldCheck, Sun, Trash2, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { SPORT_INFO, SPORT_LABEL, SPORT_NOUN, usesPace } from "@/lib/activity/config";
import { splitCue, stateCue } from "@/lib/activity/audio-cues";
import { formatActivityDate, formatDistance, formatDuration, kmValue, localDateKey, paceValue, speedValue } from "@/lib/activity/format";
import type { LocksLike } from "@/lib/activity/device-recordings";
import { uploadWithin, type KeptReason } from "@/lib/activity/finish";
import { recordingStore, type RecordingStore, type StoredRecording } from "@/lib/activity/local-store";
import type { ActivityRecord } from "@/lib/activity/record";
import { ActivityRecorder, type FinishResult, type RecorderSnapshot } from "@/lib/activity/recorder";
import { toGpx } from "@/lib/activity/gpx";
import { replayStored } from "@/lib/activity/replay";
import { downloadBlob } from "@/lib/activity/share-card";
import { uploadRecording } from "@/lib/activity/sync";
import { isSport, PRIMARY_SPORTS, type Sport } from "@/lib/activity/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AccountError } from "./AccountError";
import { FinishedResult } from "./FinishedResult";
import { gapSentence, ISSUE_TEXT, LOCATION_USE_NOTE, MAP_TILES_NOTE, SCREEN_ON_NOTE, SIGNAL_TEXT, WAKE_LOCK_TEXT } from "./messages";
import { SPORT_PLURAL, sportHref } from "./sports";
import { AUDIO_CUES_KEY, AUTO_PAUSE_KEY, SettingSwitch, SportPicker, UnlockButton, useCueVoice, useDeviceSwitch } from "./RecordingExtras";
import { useActivityV2 } from "./useActivityV2";
import { useActivityAccount } from "./useActivityAccount";

const ActivityMap = dynamic(() => import("./ActivityMap"), {
  ssr: false,
  loading: () => <div className="h-full min-h-64 w-full animate-pulse rounded-xl bg-fitx-surface-variant" aria-hidden="true" />,
});

const SHOW_MAP_KEY = "fitx:activity:show-map";
const SPORT_KEY = "fitx:activity:sport";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Preference only. */ }
}

function useRecorderSnapshot(recorder: ActivityRecorder | null): RecorderSnapshot | null {
  const subscribe = useCallback((onChange: () => void) => (recorder ? recorder.subscribe(onChange) : () => undefined), [recorder]);
  const getSnapshot = useCallback(() => (recorder ? recorder.getSnapshot() : null), [recorder]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

const SIGNAL_BARS: Record<RecorderSnapshot["signal"], number> = { none: 0, coarse: 1, weak: 1, fair: 2, good: 3 };

/** GPS state in words, bars and accuracy (never colour alone). */
function SignalPill({ snapshot, className }: { snapshot: RecorderSnapshot; className?: string }) {
  const tone = snapshot.signal === "good" ? "bg-fitx-success" : snapshot.signal === "coarse" ? "bg-fitx-danger" : snapshot.signal === "none" ? "bg-fitx-text-disabled" : "bg-fitx-warning";
  const bars = SIGNAL_BARS[snapshot.signal];
  return (
    <span className={cn("inline-flex min-h-9 items-center gap-2 rounded-full border border-fitx-border bg-fitx-elevated/95 px-3 text-xs font-medium text-fitx-text shadow-sm", className)}>
      <span className="flex h-3.5 items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <span key={bar} className={cn("w-[3px] rounded-full", bar <= bars ? tone : "bg-fitx-border", bar === 1 ? "h-1.5" : bar === 2 ? "h-2.5" : "h-3.5", snapshot.signal === "none" && "motion-safe:animate-pulse")} />
        ))}
      </span>
      {SIGNAL_TEXT[snapshot.signal]}
      {snapshot.accuracyM !== null && snapshot.signal !== "none" && <span className="tabular-nums text-fitx-text-secondary">± {Math.round(snapshot.accuracyM)} m</span>}
    </span>
  );
}

type Size = "hero" | "large" | "small";

function Stat({ label, value, unit, size = "small", className }: { label: string; value: string; unit?: string; size?: Size; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className={cn("font-medium text-fitx-text-secondary", size === "small" ? "text-[11px]" : "text-xs")}>{label}</p>
      <p className={cn(
        "mt-1 truncate font-heading font-bold tabular-nums text-fitx-text",
        size === "hero" ? "text-[72px] leading-[.9] tracking-[-.05em] sm:text-[88px]" : size === "large" ? "text-[36px] leading-none tracking-[-.04em] sm:text-[40px]" : "text-xl leading-tight tracking-[-.02em]",
      )}>
        {value}
        {unit && value !== "–" && <span className={cn("ml-1 font-body font-medium tracking-normal text-fitx-text-secondary", size === "hero" ? "text-xl" : "text-sm")}>{unit}</span>}
      </p>
    </div>
  );
}

/** A round control with its word under it: the big buttons people hit while moving. */
function RoundButton({ label, icon, onClick, tone = "primary", size = "large", disabled, buttonRef }: {
  label: string; icon: ReactNode; onClick: () => void; tone?: "primary" | "secondary" | "quiet"; size?: "large" | "medium"; disabled?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <button type="button" ref={buttonRef} onClick={onClick} disabled={disabled} className="group flex min-w-16 flex-col items-center gap-2 rounded-2xl text-sm font-semibold text-fitx-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-fitx-primary disabled:opacity-50">
      <span aria-hidden="true" className={cn(
        "grid place-items-center rounded-full transition-transform duration-150 motion-safe:group-active:scale-95",
        size === "large" ? "h-20 w-20" : "h-16 w-16",
        tone === "primary" ? "bg-fitx-primary text-fitx-on-primary shadow-lg" : tone === "secondary" ? "border border-fitx-border bg-fitx-surface text-fitx-text" : "bg-fitx-surface-variant text-fitx-text-secondary",
      )}>{icon}</span>
      {label}
    </button>
  );
}

export function ActivityRecorderScreen({ initialSport = null }: { initialSport?: Sport | null }) {
  const account = useActivityAccount();
  const router = useRouter();
  const [recorder, setRecorder] = useState<ActivityRecorder | null>(null);
  const storeRef = useRef<RecordingStore | null>(null);
  const snapshot = useRecorderSnapshot(recorder);
  const [sport, setSport] = useState<Sport>(initialSport ?? "run");
  const [showMap, setShowMap] = useState(true);
  const [confirm, setConfirm] = useState<"finish" | "discard" | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [unsaved, setUnsaved] = useState<FinishResult | null>(null);
  // A finished activity whose upload hasn't worked yet: its result is shown here, from the device copy.
  const [finished, setFinished] = useState<{ record: ActivityRecord; reason: KeptReason } | null>(null);
  // Keyboard and screen-reader users land on the safe choice when a confirmation opens, and back
  // on the button that opened it when it closes.
  const focusOnMount = useCallback((element: HTMLElement | null) => element?.focus(), []);
  const finishTriggerRef = useRef<HTMLButtonElement | null>(null);
  const discardTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState("");
  // An upload that finishes after the member has left this screen must not pull them back to the
  // activity: only open it while the recorder (and so its finished result) is still on screen.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const openSaved = useCallback((id: string) => {
    if (mountedRef.current) router.replace(`/activity/${id}`);
  }, [router]);
  const [announcement, setAnnouncement] = useState("");
  const [autoPause, setAutoPause] = useDeviceSwitch(AUTO_PAUSE_KEY);
  const [audioCues, setAudioCues] = useDeviceSwitch(AUDIO_CUES_KEY);
  const [locked, setLocked] = useState(false);
  const cueVoice = useCueVoice();
  const speakCues = audioCues && cueVoice.available;
  const speak = cueVoice.speak;

  useEffect(() => {
    const id = window.setTimeout(() => {
      // A sport page's Start button names the sport; otherwise the last one used.
      const savedSport = readLocal(SPORT_KEY);
      if (initialSport) writeLocal(SPORT_KEY, initialSport);
      else if (isSport(savedSport)) setSport(savedSport);
      if (readLocal(SHOW_MAP_KEY) === "0") setShowMap(false);
    }, 0);
    return () => window.clearTimeout(id);
  }, [initialSport]);

  const userId = account.status === "ready" ? account.userId : null;
  const v2 = useActivityV2(userId);
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let instance: ActivityRecorder | null = null;
    void (async () => {
      const store = await recordingStore();
      if (disposed) return;
      storeRef.current = store;
      const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> }; locks?: LocksLike };
      instance = new ActivityRecorder({
        geolocation: "geolocation" in navigator ? navigator.geolocation : null,
        queryPermission: navigator.permissions?.query ? () => navigator.permissions.query({ name: "geolocation" as PermissionName }) : null,
        wakeLock: nav.wakeLock ?? null,
        locks: nav.locks ?? null,
        document,
        window,
        isSecureContext: window.isSecureContext,
        store,
        now: () => Date.now(),
        randomId: uuid,
        setInterval: (callback, ms) => window.setInterval(callback, ms),
        clearInterval: (handle) => window.clearInterval(handle as number),
      });
      await instance.init(userId);
      if (disposed) {
        void instance.dispose();
        return;
      }
      setRecorder(instance);
      if (instance.getSnapshot().permission === "granted") instance.warmUp();
    })();
    return () => {
      disposed = true;
      void instance?.dispose();
    };
  }, [userId]);

  const phase = snapshot?.phase ?? "idle";
  const recording = phase === "recording" || phase === "paused";

  // Leaving or reloading the page stops location updates: ask first while recording, and while a
  // finished activity exists only in this tab.
  const guardLeaving = recording || unsaved !== null;
  useEffect(() => {
    if (!guardLeaving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guardLeaving]);

  const stats = snapshot?.stats ?? null;
  const latestGap = stats?.gaps.length ? stats.gaps[stats.gaps.length - 1] : null;
  const recentGap = latestGap && snapshot && latestGap.end > snapshot.now - 120_000 ? latestGap : null;
  const gapKey = recentGap ? `${recentGap.start}` : "";
  useEffect(() => {
    if (!recentGap) return;
    const id = window.setTimeout(() => setAnnouncement(gapSentence(recentGap)), 0);
    return () => window.clearTimeout(id);
    // Announce each interruption once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapKey]);

  const activeSport = recording || phase === "finished" ? (snapshot?.sport ?? sport) : sport;
  const pace = usesPace(activeSport);
  const current = snapshot?.lastFix ? { lat: snapshot.lastFix.lat, lng: snapshot.lastFix.lng, acc: snapshot.lastFix.acc } : null;
  const segments = useMemo(() => stats?.segments ?? [], [stats?.segments]);

  // Spoken cues: each whole-kilometre split (every 5 km on speed sports), and auto-pause changes.
  const closedSplits = stats?.splits.filter((split) => split.distanceM >= 990).length ?? 0;
  const spokenSplits = useRef(0);
  useEffect(() => {
    if (!recording) {
      spokenSplits.current = 0;
      return;
    }
    if (closedSplits <= spokenSplits.current || !stats) return;
    spokenSplits.current = closedSplits;
    if (!speakCues) return;
    const line = splitCue(activeSport, stats.splits.filter((split) => split.distanceM >= 990), { movingSeconds: stats.movingSeconds, distanceM: stats.distanceM });
    if (line) speak(line);
    // Only a newly closed kilometre speaks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedSplits, recording]);
  const autoPaused = autoPause && phase === "recording" && Boolean(stats?.stopped) && (stats?.distanceM ?? 0) > 0;
  const wasAutoPaused = useRef(false);
  useEffect(() => {
    if (autoPaused === wasAutoPaused.current) return;
    wasAutoPaused.current = autoPaused;
    const id = window.setTimeout(() => setAnnouncement(autoPaused ? "Auto-paused" : "Moving again"), 0);
    if (speakCues) speak(stateCue(activeSport, autoPaused ? "auto-paused" : "auto-resumed"));
    return () => window.clearTimeout(id);
    // Speaks on the change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPaused]);
  // Controls unlock by themselves when recording stops (finished, discarded).
  if (locked && !recording) setLocked(false);
  // A newer sport (from a link or this device's last choice) on a database that can't save it yet: back to Run.
  if (v2 === false && !recording && phase !== "finished" && !PRIMARY_SPORTS.includes(sport)) setSport("run");

  function chooseSport(next: Sport) {
    setSport(next);
    writeLocal(SPORT_KEY, next);
    recorder?.setSport(next);
  }

  function toggleMap() {
    setShowMap((value) => {
      writeLocal(SHOW_MAP_KEY, value ? "0" : "1");
      return !value;
    });
  }

  async function start() {
    if (!recorder || account.status !== "ready" || starting) return;
    setStarting(true);
    setError("");
    try {
      await recorder.start(sport, account.weightKg);
      setAnnouncement(`${SPORT_LABEL[sport]} started`);
      // Spoken from the Start press, so browsers that need a tap before speech allow the later cues.
      if (speakCues) speak(stateCue(sport, "started"));
    } finally {
      setStarting(false);
    }
  }

  function pause() {
    recorder?.pause();
    setAnnouncement("Paused");
    if (speakCues) speak(stateCue(activeSport, "paused"));
  }

  function resume() {
    recorder?.resume();
    setAnnouncement("Recording");
    if (speakCues) speak(stateCue(activeSport, "resumed"));
  }

  /**
   * Uploads a just-finished activity. The upload uses the record in memory when the device copy
   * couldn't be written, and if neither worked the activity stays on this screen (not lost).
   */
  async function saveFinished(result: FinishResult) {
    if (account.status !== "ready") return;
    const { record } = result;
    const store = storeRef.current;
    const supabase = createClient();
    const stored = store ? await store.getRecording(record.clientId).catch(() => null) : null;
    const row: StoredRecording = stored?.record
      ? stored
      : { clientId: record.clientId, userId: account.userId, sport: record.sport, startedAt: record.startedAt, state: "finished", updatedAt: Date.now(), record };
    if (store && supabase) {
      // Never wait long on the network: after a few seconds the result shows from the device copy.
      const outcome = await uploadWithin(() => uploadRecording(store, supabase, account.userId, row));
      if (outcome.kind === "uploaded") {
        openSaved(outcome.id);
        return;
      }
      if (result.savedLocally || (await store.getRecording(record.clientId).catch(() => null))) {
        setSaving(false);
        setUnsaved(null);
        setFinished({ record, reason: outcome.reason });
        // A slow upload that still finishes moves on to the saved activity.
        void outcome.pending?.then((late) => {
          if (late.result.status === "ok") openSaved(late.result.data.id);
        });
        return;
      }
    } else if (result.savedLocally) {
      setSaving(false);
      setFinished({ record, reason: "error" });
      return;
    }
    setSaving(false);
    setUnsaved(result);
  }

  async function finish() {
    if (!recorder || account.status !== "ready") return;
    setSaving(true);
    setError("");
    setConfirm(null);
    const result = await recorder.finish(null);
    if (!result) {
      setSaving(false);
      setError("This activity could not be finished. Try again.");
      return;
    }
    await saveFinished(result);
  }

  async function retryUnsaved() {
    if (!unsaved) return;
    setSaving(true);
    await saveFinished(unsaved);
  }

  function downloadUnsavedGpx() {
    if (!unsaved) return;
    const { record } = unsaved;
    const engine = replayStored(record.sport, record.startedAt, record.timeline, record.chunks);
    const gpx = toGpx({ name: record.title, sport: record.sport, segments: engine.acceptedSegments.filter((segment) => segment.length > 1) });
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), `fitx-${record.sport}-${localDateKey(record.startedAt)}.gpx`);
  }

  function cancelConfirm() {
    const trigger = confirm === "discard" ? discardTriggerRef : finishTriggerRef;
    setConfirm(null);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }

  async function discard() {
    setConfirm(null);
    await recorder?.discard();
    setAnnouncement("Recording discarded");
  }

  async function resumeRestored() {
    if (!recorder || account.status !== "ready") return;
    await recorder.resumeRestored(account.weightKg);
  }

  async function finishRestored() {
    if (!recorder || account.status !== "ready") return;
    setSaving(true);
    const result = await recorder.finishRestored(account.weightKg);
    if (!result) {
      setSaving(false);
      setError("This recording could not be finished.");
      return;
    }
    await saveFinished(result);
  }

  if (finished && account.status === "ready") {
    return <FinishedResult record={finished.record} userId={account.userId} reason={finished.reason} onUploaded={openSaved} />;
  }
  if (account.status === "loading" || (account.status === "ready" && !snapshot)) {
    return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Preparing activity tracking…</div>;
  }
  if (account.status === "error") return <AccountError />;
  if (account.status === "unconfigured") return <EmptyState title="Activity tracking isn’t connected" description="FITX is not connected to its database on this site, so activities can’t be saved." />;
  if (account.status === "signed-out" || !snapshot) return <EmptyState title="Sign in to record activities" description="Your activities are saved to your account." action={<Link href="/signin?next=/activity/record" className="fitx-button min-h-11">Sign in</Link>} />;

  const issue = snapshot.issue ? ISSUE_TEXT[snapshot.issue] : null;
  const blocking = snapshot.issue === "unsupported" || snapshot.issue === "insecure" || snapshot.issue === "denied";
  const needsPermission = !recording && phase !== "finished" && snapshot.permission !== "granted" && snapshot.permission !== "denied" && phase === "idle" && !blocking;
  const wakeText = recording ? WAKE_LOCK_TEXT[snapshot.wakeLock] : null;
  const shortRecording = (stats?.distanceM ?? 0) < 50;
  const live = (recording || phase === "finished") && stats !== null;
  // The last whole kilometre, for runs.
  const lastKm = stats?.splits.filter((split) => split.distanceM >= 990).at(-1) ?? null;
  const lastKmPace = lastKm ? lastKm.movingSeconds / (lastKm.distanceM / 1000) : null;
  const backHref = recording ? "/activity" : sportHref(sport);
  const family = SPORT_INFO[activeSport].family;
  const climbs = SPORT_INFO[activeSport].climbs;
  const altitude = snapshot.lastFix && snapshot.lastFix.alt !== null && (snapshot.lastFix.altAcc === null || snapshot.lastFix.altAcc <= 30) ? Math.round(snapshot.lastFix.alt) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {/* Top bar: back, what is happening, and the GPS state. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1">
          <Link href={backHref} className="-ml-2 grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label={recording ? "Back to activity history" : `Back to ${SPORT_PLURAL[sport].toLowerCase()}`}><ChevronLeft size={22} aria-hidden="true" /></Link>
          <h1 className="flex min-w-0 items-center gap-2 truncate font-heading text-xl font-bold tracking-[-.03em] text-fitx-text sm:text-2xl">
            {phase === "recording" && (
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inset-0 rounded-full bg-fitx-danger motion-safe:animate-ping" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-fitx-danger" />
              </span>
            )}
            {recording ? (phase === "paused" ? "Paused" : `Recording ${SPORT_NOUN[activeSport]}`) : SPORT_LABEL[sport]}
          </h1>
        </div>
        <SignalPill snapshot={snapshot} className="shrink-0" />
      </div>

      {snapshot.restorable && !recording && phase !== "finished" && (
        <section className="mb-4 flex flex-col gap-3 rounded-2xl border border-fitx-primary/40 bg-fitx-card p-4 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="restore-title">
          <div>
            <h2 id="restore-title" className="text-sm font-semibold text-fitx-text">Unfinished {SPORT_NOUN[snapshot.restorable.sport]} on this device</h2>
            <p className="mt-1 text-xs text-fitx-text-secondary">
              Started {formatActivityDate(snapshot.restorable.startedAt)} · {formatDistance(snapshot.restorable.distanceM)} so far{snapshot.restorable.paused ? " · paused" : ""}.{" "}
              {snapshot.restorable.canResume ? "Time away from this screen is marked as a gap." : "It’s too old to continue (an activity can last at most 48 hours): finish it to save it as it was."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {snapshot.restorable.canResume && <button type="button" onClick={() => void resumeRestored()} className="fitx-button min-h-11"><Play size={15} aria-hidden="true" />Resume</button>}
            <button type="button" disabled={saving} onClick={() => void finishRestored()} className={cn("fitx-button min-h-11", snapshot.restorable.canResume && "fitx-button-secondary")}><Flag size={15} aria-hidden="true" />Finish &amp; save</button>
            <button type="button" ref={discardTriggerRef} onClick={() => setConfirm("discard")} className="fitx-button fitx-button-quiet min-h-11"><Trash2 size={15} aria-hidden="true" />Discard</button>
          </div>
        </section>
      )}

      {snapshot.elsewhere && !recording && (
        <p role="status" className="fitx-alert mb-4 flex gap-2"><Info size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info" />An activity is being recorded in another FITX window or tab. Finish it there before starting a new one.</p>
      )}
      {unsaved && (
        <section role="alert" className="fitx-alert fitx-alert-danger mb-4 space-y-3" aria-label="Activity not saved yet">
          <p><span className="font-semibold">Your {SPORT_NOUN[unsaved.record.sport]} isn’t saved yet.</span> It couldn’t be stored on this device or uploaded. Keep this screen open and try again, or download its GPX file.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void retryUnsaved()} disabled={saving} className="fitx-button min-h-11"><RefreshCw size={15} aria-hidden="true" />{saving ? "Trying…" : "Try again"}</button>
            <button type="button" onClick={downloadUnsavedGpx} className="fitx-button fitx-button-secondary min-h-11"><Download size={15} aria-hidden="true" />Download GPX</button>
          </div>
        </section>
      )}
      {error && <p role="alert" className="fitx-alert fitx-alert-danger mb-4">{error}</p>}
      {issue && (
        <div role={blocking ? "alert" : "status"} className={cn("fitx-alert mb-4 flex gap-3", blocking || snapshot.issue === "coarse" ? "fitx-alert-danger" : "")}>
          <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div><p className="font-semibold">{issue.title}</p><p className="mt-1 text-[13px] leading-5">{issue.body}</p></div>
        </div>
      )}
      {recentGap && <p role="status" className="fitx-alert mb-4 flex gap-3 text-[13px]"><Info size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-info" />{gapSentence(recentGap)}</p>}

      {/* Phones: the map leads and the panel sits over its lower edge. Large screens: map left, panel right. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-5">
        <div className="relative">
          {showMap ? (
            <>
              <ActivityMap
                segments={segments}
                version={stats?.routeVersion ?? 0}
                current={current}
                follow
                className={cn(
                  "w-full [--fitx-map-inset-bottom:28px] [--fitx-map-inset-top:52px] lg:h-[calc(100dvh-200px)] lg:min-h-[520px] lg:[--fitx-map-inset-bottom:0px]",
                  live ? "h-[32dvh] min-h-48" : "h-[50dvh] min-h-72",
                )}
                label={recording ? "Map of your route so far" : "Map of your current position"}
              />
              <button type="button" onClick={toggleMap} aria-label="Hide map (saves battery)" className="absolute left-2.5 top-2.5 z-[3] inline-flex min-h-11 items-center gap-2 rounded-full border border-fitx-border bg-fitx-elevated/95 px-3.5 text-sm font-medium text-fitx-text-secondary shadow-sm hover:text-fitx-text">
                <EyeOff size={16} aria-hidden="true" />Hide map
              </button>
            </>
          ) : (
            <div className="mb-4 flex min-h-16 flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-fitx-border bg-fitx-surface px-4 py-3 text-sm text-fitx-text-secondary lg:mb-0 lg:h-[calc(100dvh-200px)] lg:flex-col lg:justify-center lg:text-center">
              <p>Map hidden to save battery. Tracking continues.</p>
              <button type="button" onClick={toggleMap} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-medium text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text"><Eye size={16} aria-hidden="true" />Show map</button>
            </div>
          )}
        </div>

        <div className={cn("relative z-[4] space-y-4", showMap && "-mt-7 lg:mt-0")}>
          {!recording && phase !== "finished" && (
            <section className="rounded-t-3xl border border-fitx-border bg-fitx-card p-5 shadow-lg sm:p-6 lg:rounded-3xl lg:shadow-none" aria-labelledby="sport-title">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-fitx-border lg:hidden" aria-hidden="true" />
              <h2 id="sport-title" className="text-sm font-semibold text-fitx-text">Choose a sport</h2>
              <div className="mt-4">
                <SportPicker sport={sport} onChoose={chooseSport} more={v2 === true} />
              </div>

              {needsPermission ? (
                <div className="mt-5 rounded-2xl bg-fitx-surface-variant p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><LocateFixed size={16} aria-hidden="true" className="text-fitx-primary" />Allow location to record</p>
                  <p className="mt-1.5 text-[13px] leading-5 text-fitx-text-secondary">Once you allow it, FITX uses your location while this screen is open, to show the GPS signal and then to record, until you finish or leave. Only the positions from while you record are kept, and your routes are private to your account. {MAP_TILES_NOTE}</p>
                  <button type="button" onClick={() => recorder?.warmUp()} className="fitx-button mt-3 min-h-12 w-full">Allow location</button>
                </div>
              ) : (
                <button type="button" disabled={blocking || !recorder || starting || snapshot.elsewhere} onClick={() => void start()} className="fitx-button mt-5 min-h-14 w-full rounded-full text-base">
                  <Play size={18} aria-hidden="true" />Start {SPORT_NOUN[sport]}
                </button>
              )}
              {!needsPermission && !blocking && (snapshot.signal === "none" || snapshot.signal === "weak" || snapshot.signal === "coarse") && (
                <p className="mt-2 text-center text-xs text-fitx-text-secondary">{snapshot.signal === "none" ? "Waiting for GPS. You can start now; the route begins with the first good position." : "Weak signal: the route may be less precise until it improves."}</p>
              )}
              <div className="mt-4 divide-y divide-fitx-divider border-t border-fitx-divider" aria-label="Recording settings" role="group">
                <SettingSwitch label="Auto-pause" hint="The clock shows moving time and holds while you stop. Moving time is saved either way." on={autoPause} onChange={setAutoPause} />
                {cueVoice.available && (
                  <SettingSwitch label="Audio cues" hint={usesPace(sport) ? "Spoken pace every kilometre, with your phone’s own voice." : "Spoken speed every 5 km, with your phone’s own voice."} on={audioCues} onChange={setAudioCues} />
                )}
              </div>
              {!snapshot.durable && <p className="mt-3 flex gap-2 text-xs leading-5 text-fitx-warning"><CloudOff size={15} aria-hidden="true" className="mt-0.5 shrink-0" />This browser can’t keep a backup on the device. Keep this page open until you finish.</p>}
              <details className="group mt-4 border-t border-fitx-divider pt-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs font-medium text-fitx-text-secondary [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2"><Sun size={15} aria-hidden="true" />Keep the screen on while you record</span>
                  <ChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">{SCREEN_ON_NOTE}</p>
                {!needsPermission && <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">{LOCATION_USE_NOTE} {MAP_TILES_NOTE}</p>}
              </details>
            </section>
          )}

          {live && stats && (
            <section className="rounded-t-3xl border border-fitx-border bg-fitx-card px-5 pt-5 shadow-lg sm:px-6 sm:pt-6 lg:rounded-3xl lg:pb-6 lg:shadow-none" aria-label="Live statistics">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-fitx-border lg:hidden" aria-hidden="true" />
              <Stat label="Distance" value={kmValue(stats.distanceM)} unit="km" size="hero" />
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-fitx-divider pt-4">
                {autoPause
                  ? <Stat label={autoPaused ? "Moving time · auto-paused" : "Moving time"} value={formatDuration(stats.movingSeconds)} size="large" />
                  : <Stat label="Time" value={formatDuration(stats.activeSeconds)} size="large" />}
                {pace
                  ? <Stat label="Pace" value={stats.stopped ? "–" : paceValue(stats.currentPaceSecondsPerKm)} unit="/km" size="large" />
                  : <Stat label="Speed" value={stats.stopped ? "0.0" : speedValue(stats.currentSpeedMps)} unit="km/h" size="large" />}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-fitx-divider pt-4">
                {pace
                  ? <Stat label="Avg pace" value={paceValue(stats.avgPaceSecondsPerKm)} unit="/km" />
                  : <Stat label="Avg speed" value={speedValue(stats.avgSpeedMps)} unit="km/h" />}
                {autoPause ? <Stat label="Elapsed" value={formatDuration(stats.activeSeconds)} /> : <Stat label="Moving" value={formatDuration(stats.movingSeconds)} />}
                {pace && family !== "walk" && <Stat label="Last km" value={paceValue(lastKmPace)} unit="/km" />}
                {!pace && <Stat label="Top speed" value={speedValue(stats.maxSpeedMps)} unit="km/h" />}
                {pace && family === "walk" && <Stat label="Energy (est.)" value={snapshot.kcal !== null ? String(snapshot.kcal) : "–"} unit="kcal" />}
                {/* Climb and altitude only when the phone reports a usable altitude; never shown as 0 without one. */}
                {stats.elevationGainM !== null && <Stat label="Climb (GPS)" value={String(stats.elevationGainM)} unit="m" />}
                {climbs && altitude !== null && <Stat label="Altitude (GPS)" value={String(altitude)} unit="m" />}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-fitx-text-secondary">
                {stats.stopped && phase === "recording" && <span className="rounded-full bg-fitx-surface-variant px-2.5 py-1">{autoPause ? "Auto-paused" : "Stopped · moving time held"}</span>}
                {locked && <span className="inline-flex items-center gap-1 rounded-full bg-fitx-surface-variant px-2.5 py-1"><Lock size={12} aria-hidden="true" />Controls locked</span>}
                {snapshot.kcal !== null && !(pace && family === "walk") && <span className="rounded-full bg-fitx-surface-variant px-2.5 py-1 tabular-nums">≈ {snapshot.kcal} kcal (estimated)</span>}
                {wakeText && <span className={cn("rounded-full px-2.5 py-1", snapshot.wakeLock === "active" ? "bg-fitx-surface-variant" : "bg-fitx-danger-bg text-fitx-danger")}>{wakeText}</span>}
                {stats.gaps.length > 0 && <span className="rounded-full bg-fitx-surface-variant px-2.5 py-1">{stats.gaps.length} gap{stats.gaps.length === 1 ? "" : "s"} · {formatDuration(stats.gapSeconds)} not tracked</span>}
              </div>

              {/* Phones: the controls stay pinned to the bottom of the screen, so Pause and Finish never need a scroll mid-run. */}
              <div className="sticky bottom-0 z-[5] -mx-5 mt-4 border-t border-fitx-divider bg-fitx-card px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
                {confirm === "finish" ? (
                  <div className="mt-1 rounded-2xl border border-fitx-border bg-fitx-surface-variant p-4" role="alertdialog" aria-labelledby="finish-question">
                    <p id="finish-question" className="text-sm font-semibold text-fitx-text">Finish and save this {SPORT_NOUN[activeSport]}?</p>
                    {shortRecording && <p className="mt-1 text-xs text-fitx-text-secondary">Almost no distance was recorded. You can still save it, or discard it.</p>}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" ref={focusOnMount} onClick={cancelConfirm} className="fitx-button fitx-button-secondary min-h-12">Keep going</button>
                      <button type="button" onClick={() => void finish()} disabled={saving} className="fitx-button min-h-12"><Flag size={16} aria-hidden="true" />{saving ? "Saving…" : "Finish"}</button>
                    </div>
                  </div>
                ) : confirm === "discard" ? (
                  <div className="mt-1 rounded-2xl border border-fitx-danger-border bg-fitx-danger-bg p-4" role="alertdialog" aria-labelledby="discard-question">
                    <p id="discard-question" className="text-sm font-semibold text-fitx-danger">Discard this {SPORT_NOUN[activeSport]}? It can’t be recovered.</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" ref={focusOnMount} onClick={cancelConfirm} className="fitx-button fitx-button-secondary min-h-12">Keep it</button>
                      <button type="button" onClick={() => void discard()} className="fitx-button fitx-button-danger min-h-12"><Trash2 size={16} aria-hidden="true" />Discard</button>
                    </div>
                  </div>
                ) : locked && recording ? (
                  <div className="mt-2 flex justify-center"><UnlockButton onUnlock={() => { setLocked(false); setAnnouncement("Controls unlocked"); }} /></div>
                ) : phase === "recording" ? (
                  <div className="mt-2 flex items-end justify-center gap-6 sm:gap-8">
                    <RoundButton label="Lock" icon={<Lock size={22} aria-hidden="true" />} onClick={() => { setLocked(true); setAnnouncement("Controls locked. Hold the lock button to unlock."); }} tone="quiet" size="medium" />
                    <RoundButton label="Pause" icon={<Pause size={30} aria-hidden="true" />} onClick={pause} />
                    <RoundButton label="Finish" icon={<Flag size={24} aria-hidden="true" />} onClick={() => setConfirm("finish")} tone="secondary" size="medium" buttonRef={finishTriggerRef} />
                  </div>
                ) : phase === "paused" ? (
                  <div className="mt-2 flex items-end justify-center gap-6 sm:gap-8">
                    <RoundButton label="Discard" icon={<Trash2 size={22} aria-hidden="true" />} onClick={() => setConfirm("discard")} tone="quiet" size="medium" buttonRef={discardTriggerRef} />
                    <RoundButton label="Resume" icon={<Play size={30} aria-hidden="true" />} onClick={resume} />
                    <RoundButton label="Finish" icon={<Flag size={24} aria-hidden="true" />} onClick={() => setConfirm("finish")} tone="secondary" size="medium" buttonRef={finishTriggerRef} />
                  </div>
                ) : (
                  !unsaved && <p className="mt-1 text-sm text-fitx-text-secondary" role="status">Saving your {SPORT_NOUN[activeSport]}…</p>
                )}
              </div>
            </section>
          )}

          {(recording || (phase === "finished" && !unsaved)) && (
            snapshot.durable
              ? <p className="flex gap-2 px-1 text-xs leading-5 text-fitx-text-secondary"><ShieldCheck size={15} aria-hidden="true" className="mt-0.5 shrink-0" />Saved on this device as you go. Leaving this screen stops location updates; come back to continue, and the time away is shown as a gap.</p>
              : <p className="flex gap-2 px-1 text-xs leading-5 text-fitx-warning"><CloudOff size={15} aria-hidden="true" className="mt-0.5 shrink-0" />Kept in this tab only: this browser can’t save it on the device, so don’t reload or close FITX until you finish.</p>
          )}
          {confirm === "discard" && !recording && snapshot.restorable && (
            <div className="rounded-2xl border border-fitx-danger-border bg-fitx-danger-bg p-4" role="alertdialog" aria-labelledby="discard-restorable-question">
              <p id="discard-restorable-question" className="text-sm font-semibold text-fitx-danger">Discard the unfinished {SPORT_NOUN[snapshot.restorable.sport]}? It can’t be recovered.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" ref={focusOnMount} onClick={cancelConfirm} className="fitx-button fitx-button-secondary min-h-12">Keep it</button>
                <button type="button" onClick={() => void discard()} className="fitx-button fitx-button-danger min-h-12"><Trash2 size={16} aria-hidden="true" />Discard</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
