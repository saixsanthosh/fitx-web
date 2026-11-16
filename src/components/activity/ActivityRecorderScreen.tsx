"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, CloudOff, Eye, EyeOff, Flag, Info, LocateFixed, Pause, Play, ShieldCheck, Sun, Trash2, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { SPORT_LABEL, SPORT_NOUN, usesPace } from "@/lib/activity/config";
import { formatActivityDate, formatDistance, formatDuration, kmValue, paceValue, speedValue } from "@/lib/activity/format";
import { recordingStore, type RecordingStore } from "@/lib/activity/local-store";
import { ActivityRecorder, type RecorderSnapshot } from "@/lib/activity/recorder";
import { uploadRecording } from "@/lib/activity/sync";
import { SPORTS, type Sport } from "@/lib/activity/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AccountError } from "./AccountError";
import { gapSentence, ISSUE_TEXT, SCREEN_ON_NOTE, SIGNAL_TEXT, WAKE_LOCK_TEXT } from "./messages";
import { SportIcon } from "./sports";
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

function SignalPill({ snapshot }: { snapshot: RecorderSnapshot }) {
  const tone = snapshot.signal === "good" ? "text-fitx-success" : snapshot.signal === "coarse" ? "text-fitx-danger" : snapshot.signal === "none" ? "text-fitx-text-secondary" : "text-fitx-warning";
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-fitx-border bg-fitx-surface px-3 text-xs font-medium text-fitx-text-secondary">
      <span className={cn("h-2 w-2 rounded-full bg-current", tone)} aria-hidden="true" />
      {SIGNAL_TEXT[snapshot.signal]}
      {snapshot.accuracyM !== null && snapshot.signal !== "none" && <span className="tabular-nums">± {Math.round(snapshot.accuracyM)} m</span>}
    </span>
  );
}

function Stat({ label, value, unit, large = false }: { label: string; value: string; unit?: string; large?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">{label}</p>
      <p className={cn("mt-1 truncate font-semibold tabular-nums tracking-tight text-fitx-text", large ? "text-[56px] leading-none sm:text-[64px]" : "text-2xl sm:text-[28px]")}>
        {value}
        {unit && <span className={cn("ml-1 font-medium text-fitx-text-secondary", large ? "text-xl" : "text-sm")}>{unit}</span>}
      </p>
    </div>
  );
}

export function ActivityRecorderScreen() {
  const account = useActivityAccount();
  const router = useRouter();
  const [recorder, setRecorder] = useState<ActivityRecorder | null>(null);
  const storeRef = useRef<RecordingStore | null>(null);
  const snapshot = useRecorderSnapshot(recorder);
  const [sport, setSport] = useState<Sport>("run");
  const [showMap, setShowMap] = useState(true);
  const [confirm, setConfirm] = useState<"finish" | "discard" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => {
      const savedSport = readLocal(SPORT_KEY);
      if (savedSport === "walk" || savedSport === "run" || savedSport === "ride") setSport(savedSport);
      if (readLocal(SHOW_MAP_KEY) === "0") setShowMap(false);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const userId = account.status === "ready" ? account.userId : null;
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let instance: ActivityRecorder | null = null;
    void (async () => {
      const store = await recordingStore();
      if (disposed) return;
      storeRef.current = store;
      const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> } };
      instance = new ActivityRecorder({
        geolocation: "geolocation" in navigator ? navigator.geolocation : null,
        queryPermission: navigator.permissions?.query ? () => navigator.permissions.query({ name: "geolocation" as PermissionName }) : null,
        wakeLock: nav.wakeLock ?? null,
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

  // Leaving or reloading the page stops location updates: ask first while recording.
  useEffect(() => {
    if (!recording) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);

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
    if (!recorder || account.status !== "ready") return;
    setError("");
    await recorder.start(sport, account.weightKg);
    setAnnouncement(`${SPORT_LABEL[sport]} started`);
  }

  function pause() {
    recorder?.pause();
    setAnnouncement("Paused");
  }

  function resume() {
    recorder?.resume();
    setAnnouncement("Recording");
  }

  async function finish() {
    if (!recorder || account.status !== "ready") return;
    setSaving(true);
    setError("");
    setConfirm(null);
    const record = await recorder.finish(null);
    if (!record) {
      setSaving(false);
      setError("This activity could not be finished. Try again.");
      return;
    }
    const store = storeRef.current;
    const supabase = createClient();
    const stored = store ? await store.getRecording(record.clientId) : null;
    if (store && supabase && stored) {
      const outcome = await uploadRecording(store, supabase, account.userId, stored);
      if (outcome.result.status === "ok") {
        router.replace(`/activity/${outcome.result.data.id}`);
        return;
      }
    }
    router.replace(`/activity/local-${record.clientId}`);
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
    const record = await recorder.finishRestored(account.weightKg);
    if (!record) {
      setSaving(false);
      setError("This recording could not be finished.");
      return;
    }
    const store = storeRef.current;
    const supabase = createClient();
    const stored = store ? await store.getRecording(record.clientId) : null;
    if (store && supabase && stored) {
      const outcome = await uploadRecording(store, supabase, account.userId, stored);
      if (outcome.result.status === "ok") {
        router.replace(`/activity/${outcome.result.data.id}`);
        return;
      }
    }
    router.replace(`/activity/local-${record.clientId}`);
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

  return (
    <div className="mx-auto max-w-6xl">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/activity" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Back to activity history"><ChevronLeft size={20} aria-hidden="true" /></Link>
          <h1 className="text-[22px] font-bold tracking-[-.03em] text-fitx-text sm:text-[26px]">
            {recording ? (phase === "paused" ? "Paused" : `Recording ${SPORT_NOUN[activeSport]}`) : "Record an activity"}
          </h1>
        </div>
        <SignalPill snapshot={snapshot} />
      </div>

      {snapshot.restorable && !recording && phase !== "finished" && (
        <section className="fitx-panel mb-4 flex flex-col gap-3 border-fitx-primary/40 p-4 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="restore-title">
          <div>
            <h2 id="restore-title" className="text-sm font-semibold text-fitx-text">Unfinished {SPORT_NOUN[snapshot.restorable.sport]} on this device</h2>
            <p className="mt-1 text-xs text-fitx-text-secondary">Started {formatActivityDate(snapshot.restorable.startedAt)} · {formatDistance(snapshot.restorable.distanceM)} so far{snapshot.restorable.paused ? " · paused" : ""}. Time away from this screen is marked as a gap.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void resumeRestored()} className="fitx-button min-h-11"><Play size={15} aria-hidden="true" />Resume</button>
            <button type="button" disabled={saving} onClick={() => void finishRestored()} className="fitx-button fitx-button-secondary min-h-11"><Flag size={15} aria-hidden="true" />Finish &amp; save</button>
            <button type="button" onClick={() => setConfirm("discard")} className="fitx-button fitx-button-quiet min-h-11"><Trash2 size={15} aria-hidden="true" />Discard</button>
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="order-2 lg:order-1">
          {showMap ? (
            <ActivityMap
              segments={segments}
              version={stats?.routeVersion ?? 0}
              current={current}
              follow
              className="h-[42vh] min-h-64 w-full lg:h-[calc(100dvh-220px)] lg:min-h-[480px]"
              label={recording ? "Map of your route so far" : "Map of your current position"}
            />
          ) : (
            <div className="grid h-40 place-items-center rounded-xl border border-dashed border-fitx-border bg-fitx-surface text-center text-sm text-fitx-text-secondary lg:h-[calc(100dvh-220px)]">
              <p className="px-6">Map hidden to save battery. Tracking continues.</p>
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={toggleMap} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
              {showMap ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              {showMap ? "Hide map (saves battery)" : "Show map"}
            </button>
          </div>
        </div>

        <div className="order-1 space-y-4 lg:order-2">
          {!recording && phase !== "finished" && (
            <section className="fitx-panel p-4 sm:p-5" aria-labelledby="sport-title">
              <h2 id="sport-title" className="text-sm font-semibold text-fitx-text">Activity</h2>
              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Activity type">
                {SPORTS.map((option) => (
                  <button key={option} type="button" role="radio" aria-checked={sport === option} onClick={() => chooseSport(option)}
                    className={cn("flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors", sport === option ? "border-fitx-primary bg-fitx-primary/10 text-fitx-primary-text" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40 hover:text-fitx-text")}>
                    <SportIcon sport={option} size={20} />
                    {SPORT_LABEL[option]}
                  </button>
                ))}
              </div>

              {needsPermission ? (
                <div className="mt-4 rounded-lg border border-fitx-border bg-fitx-surface-variant p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><LocateFixed size={16} aria-hidden="true" className="text-fitx-primary" />Allow location to record</p>
                  <p className="mt-1.5 text-[13px] leading-5 text-fitx-text-secondary">FITX uses your location only while this screen is recording. Your routes are private to your account.</p>
                  <button type="button" onClick={() => recorder?.warmUp()} className="fitx-button mt-3 min-h-11 w-full">Allow location</button>
                </div>
              ) : (
                <button type="button" disabled={blocking || !recorder} onClick={() => void start()} className="fitx-button mt-4 min-h-14 w-full text-base">
                  <Play size={18} aria-hidden="true" />Start {SPORT_NOUN[sport]}
                </button>
              )}
              {!needsPermission && !blocking && (snapshot.signal === "none" || snapshot.signal === "weak" || snapshot.signal === "coarse") && (
                <p className="mt-2 text-xs text-fitx-text-secondary">{snapshot.signal === "none" ? "Waiting for GPS. You can start now; the route begins with the first good position." : "The signal is weak: the route may be less precise until it improves."}</p>
              )}
              <p className="mt-4 flex gap-2 text-xs leading-5 text-fitx-text-secondary"><Sun size={15} aria-hidden="true" className="mt-0.5 shrink-0" />{SCREEN_ON_NOTE}</p>
              {!snapshot.durable && <p className="mt-2 flex gap-2 text-xs leading-5 text-fitx-warning"><CloudOff size={15} aria-hidden="true" className="mt-0.5 shrink-0" />This browser can’t keep a backup on the device. Keep this page open until you finish.</p>}
            </section>
          )}

          {(recording || phase === "finished") && stats && (
            <section className="fitx-panel p-4 sm:p-5" aria-label="Live statistics">
              <Stat label="Distance" value={kmValue(stats.distanceM)} unit="km" large />
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Stat label="Time" value={formatDuration(stats.activeSeconds)} />
                {pace
                  ? <Stat label="Pace" value={stats.stopped ? "–" : paceValue(stats.currentPaceSecondsPerKm)} unit="/km" />
                  : <Stat label="Speed" value={stats.stopped ? "0.0" : speedValue(stats.currentSpeedMps)} unit="km/h" />}
                {pace
                  ? <Stat label="Avg pace" value={paceValue(stats.avgPaceSecondsPerKm)} unit="/km" />
                  : <Stat label="Avg speed" value={speedValue(stats.avgSpeedMps)} unit="km/h" />}
                <Stat label="Moving" value={formatDuration(stats.movingSeconds)} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-fitx-text-secondary">
                {stats.stopped && phase === "recording" && <span className="rounded-full bg-fitx-surface-variant px-2.5 py-1">Stopped · moving time held</span>}
                {snapshot.kcal !== null && <span className="rounded-full bg-fitx-surface-variant px-2.5 py-1 tabular-nums">≈ {snapshot.kcal} kcal (estimated)</span>}
                {wakeText && <span className={cn("rounded-full px-2.5 py-1", snapshot.wakeLock === "active" ? "bg-fitx-surface-variant" : "bg-fitx-danger-bg text-fitx-danger")}>{wakeText}</span>}
                {stats.gaps.length > 0 && <span className="rounded-full bg-fitx-surface-variant px-2.5 py-1">{stats.gaps.length} gap{stats.gaps.length === 1 ? "" : "s"} · {formatDuration(stats.gapSeconds)} not tracked</span>}
              </div>

              {confirm === "finish" ? (
                <div className="mt-5 rounded-lg border border-fitx-border bg-fitx-surface-variant p-4" role="group" aria-label="Finish this activity?">
                  <p className="text-sm font-semibold text-fitx-text">Finish and save this {SPORT_NOUN[activeSport]}?</p>
                  {shortRecording && <p className="mt-1 text-xs text-fitx-text-secondary">Almost no distance was recorded. You can still save it, or discard it.</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setConfirm(null)} className="fitx-button fitx-button-secondary min-h-12">Keep going</button>
                    <button type="button" onClick={() => void finish()} disabled={saving} className="fitx-button min-h-12"><Flag size={16} aria-hidden="true" />{saving ? "Saving…" : "Finish"}</button>
                  </div>
                </div>
              ) : confirm === "discard" ? (
                <div className="mt-5 rounded-lg border border-fitx-danger-border bg-fitx-danger-bg p-4" role="group" aria-label="Discard this activity?">
                  <p className="text-sm font-semibold text-fitx-danger">Discard this {SPORT_NOUN[activeSport]}? It can’t be recovered.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setConfirm(null)} className="fitx-button fitx-button-secondary min-h-12">Keep it</button>
                    <button type="button" onClick={() => void discard()} className="fitx-button fitx-button-danger min-h-12"><Trash2 size={16} aria-hidden="true" />Discard</button>
                  </div>
                </div>
              ) : phase === "recording" ? (
                <div className="mt-5 grid grid-cols-[1fr_auto] gap-2">
                  <button type="button" onClick={pause} className="fitx-button min-h-14 text-base"><Pause size={18} aria-hidden="true" />Pause</button>
                  <button type="button" onClick={() => setConfirm("finish")} className="fitx-button fitx-button-secondary min-h-14 px-5"><Flag size={17} aria-hidden="true" />Finish</button>
                </div>
              ) : phase === "paused" ? (
                <div className="mt-5 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={resume} className="fitx-button min-h-14 text-base"><Play size={18} aria-hidden="true" />Resume</button>
                    <button type="button" onClick={() => setConfirm("finish")} className="fitx-button fitx-button-secondary min-h-14"><Flag size={17} aria-hidden="true" />Finish</button>
                  </div>
                  <button type="button" onClick={() => setConfirm("discard")} className="fitx-button fitx-button-quiet min-h-11 w-full"><Trash2 size={15} aria-hidden="true" />Discard</button>
                </div>
              ) : (
                <p className="mt-5 text-sm text-fitx-text-secondary" role="status">Saving your {SPORT_NOUN[activeSport]}…</p>
              )}
            </section>
          )}

          {(recording || phase === "finished") && (
            <p className="flex gap-2 px-1 text-xs leading-5 text-fitx-text-secondary"><ShieldCheck size={15} aria-hidden="true" className="mt-0.5 shrink-0" />Saved on this device as you go. Leaving this screen stops location updates; come back to continue, and the time away is shown as a gap.</p>
          )}
          {confirm === "discard" && !recording && snapshot.restorable && (
            <div className="rounded-lg border border-fitx-danger-border bg-fitx-danger-bg p-4" role="group" aria-label="Discard the unfinished recording?">
              <p className="text-sm font-semibold text-fitx-danger">Discard the unfinished {SPORT_NOUN[snapshot.restorable.sport]}? It can’t be recovered.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirm(null)} className="fitx-button fitx-button-secondary min-h-12">Keep it</button>
                <button type="button" onClick={() => void discard()} className="fitx-button fitx-button-danger min-h-12"><Trash2 size={16} aria-hidden="true" />Discard</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
