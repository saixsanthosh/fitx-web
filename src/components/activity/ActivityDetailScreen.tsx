"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronLeft, CloudOff, Download, Info, Pencil, RefreshCw, Share2, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { KCAL_METHOD } from "@/lib/activity/calories";
import { SPORT_LABEL, SPORT_NOUN, usesPace } from "@/lib/activity/config";
import { cleanTitle, formatActivityDate, formatDistance, formatDuration, formatPace, formatSpeed, kmValue, paceValue, speedValue } from "@/lib/activity/format";
import { toGpx } from "@/lib/activity/gpx";
import { recordingStore } from "@/lib/activity/local-store";
import { decodeRoute } from "@/lib/activity/polyline";
import { replayStored } from "@/lib/activity/replay";
import { deleteActivity, getActivity, getTrackChunks, updateActivity, viewFromRecord, type ActivityView } from "@/lib/activity/repository";
import { downloadBlob, type CardData } from "@/lib/activity/share-card";
import { uploadRecording } from "@/lib/activity/sync";
import type { Fix, LatLng } from "@/lib/activity/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { GAP_LABEL } from "./messages";
import { ShareCardDialog } from "./ShareCardDialog";
import { AccountError } from "./AccountError";
import { SportIcon } from "./sports";
import { useActivityAccount } from "./useActivityAccount";

const ActivityMap = dynamic(() => import("./ActivityMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-fitx-surface-variant" aria-hidden="true" />,
});

type LoadState =
  | { status: "loading" }
  | { status: "ready"; view: ActivityView; uploadNote: string | null }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "error"; offline: boolean };

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-fitx-border bg-fitx-surface p-3 sm:p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-fitx-text sm:text-2xl">{value}</p>
      {note && <p className="mt-1 text-[11px] leading-4 text-fitx-text-secondary">{note}</p>}
    </div>
  );
}

export function ActivityDetailScreen({ id }: { id: string }) {
  const account = useActivityAccount();
  const router = useRouter();
  const localClientId = id.startsWith("local-") ? id.slice("local-".length) : null;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [detail, setDetail] = useState<{ segments: Fix[][]; route: LatLng[][] } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"" | "rename" | "delete" | "upload">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  const userId = account.status === "ready" ? account.userId : null;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      if (localClientId) {
        const store = await recordingStore();
        const stored = await store.getRecording(localClientId);
        if (!active) return;
        if (!stored || stored.userId !== userId || !stored.record) setState({ status: "missing" });
        else setState({ status: "ready", view: viewFromRecord(stored.record), uploadNote: stored.lastUploadError ?? null });
        return;
      }
      const supabase = createClient();
      if (!supabase) return;
      const result = await getActivity(supabase, userId, id);
      if (!active) return;
      if (result.status === "unavailable") setState({ status: "unavailable" });
      else if (result.status === "error") setState({ status: "error", offline: result.offline });
      else if (!result.data) setState({ status: "missing" });
      else setState({ status: "ready", view: result.data, uploadNote: null });
    })();
    return () => {
      active = false;
    };
  }, [userId, id, localClientId, reload]);

  const view = state.status === "ready" ? state.view : null;

  // Detailed GPS points: replayed for a precise route and the GPX export, while they are kept.
  useEffect(() => {
    if (!userId || !view || view.local || !view.id || !view.chunkCount) return;
    let active = true;
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const chunks = await getTrackChunks(supabase, userId, view.id as string);
      if (!active || chunks.status !== "ok" || !chunks.data.length) return;
      const engine = replayStored(view.sport, view.startedAt, view.timeline, chunks.data);
      setDetail({ segments: engine.acceptedSegments.filter((s) => s.length > 1), route: engine.segments.map((s) => s.map(({ lat, lng }) => ({ lat, lng }))) });
    })();
    return () => {
      active = false;
    };
  }, [userId, view]);

  const route = useMemo<LatLng[][]>(() => detail?.route ?? (view ? decodeRoute(view.routePolyline) : []), [detail, view]);
  const card = useMemo<CardData | null>(() => view && {
    sport: view.sport, title: view.title, startedAt: view.startedAt, distanceM: view.distanceM, movingSeconds: view.movingSeconds,
    avgSpeedMps: view.avgSpeedMps, avgPaceSecondsPerKm: view.avgPaceSecondsPerKm, kcal: view.kcal, elevationGainM: view.elevationGainM, sharePolyline: view.sharePolyline,
  }, [view]);

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading activity…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Activities aren’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "signed-out") return <EmptyState title="Sign in to see this activity" description="Activities are private to your account." action={<Link href={`/signin?next=${encodeURIComponent(`/activity/${id}`)}`} className="fitx-button min-h-11">Sign in</Link>} />;
  if (account.status === "error") return <AccountError />;
  if (state.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading activity…</div>;
  if (state.status === "unavailable") return <EmptyState title="Activity history isn’t available yet" description="FITX is finishing an update. Activities you record stay on this device until history is ready." action={<Link href="/activity" className="fitx-button fitx-button-secondary min-h-11">Back to activity</Link>} />;
  if (state.status === "error") return <EmptyState title="This activity couldn’t be loaded" description={state.offline ? "You seem to be offline. Check your connection and try again." : "Something went wrong. Try again in a moment."} action={<button type="button" onClick={() => setReload((n) => n + 1)} className="fitx-button fitx-button-secondary min-h-11"><RefreshCw size={15} aria-hidden="true" />Try again</button>} />;
  if (state.status === "missing" || !view || !card) return <EmptyState title="Activity not found" description="It may have been deleted, or it belongs to another account." action={<Link href="/activity" className="fitx-button fitx-button-secondary min-h-11">Back to activity</Link>} />;

  const pace = usesPace(view.sport);
  const detailed = Boolean(detail);
  const pruned = !view.local && view.chunkCount > 0 && !detailed;

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!view || !userId || view.local) return;
    const next = cleanTitle(title, view.title);
    const supabase = createClient();
    if (!supabase) return;
    setBusy("rename");
    const result = await updateActivity(supabase, userId, view.id as string, { title: next });
    setBusy("");
    if (result.status !== "ok") return setMessage("The new name couldn’t be saved. Try again.");
    setState({ status: "ready", view: { ...view, title: next }, uploadNote: null });
    setEditing(false);
    setMessage("");
  }

  async function remove() {
    if (!view || !userId) return;
    setBusy("delete");
    if (view.local) {
      const store = await recordingStore();
      await store.deleteRecording(view.clientId);
      router.replace("/activity");
      return;
    }
    const supabase = createClient();
    const result = supabase ? await deleteActivity(supabase, userId, view.id as string) : null;
    setBusy("");
    if (!result || result.status !== "ok") return setMessage("This activity couldn’t be deleted. Check your connection and try again.");
    router.replace("/activity");
  }

  async function upload() {
    if (!view || !userId) return;
    const store = await recordingStore();
    const stored = await store.getRecording(view.clientId);
    const supabase = createClient();
    if (!stored || !supabase) return;
    setBusy("upload");
    const outcome = await uploadRecording(store, supabase, userId, stored);
    setBusy("");
    if (outcome.result.status === "ok") {
      router.replace(`/activity/${outcome.result.data.id}`);
      return;
    }
    setMessage(outcome.result.status === "unavailable" ? "Activity history isn’t available yet. It stays on this device until it is." : outcome.result.offline ? "You’re offline. It will upload when you’re back online." : "The upload didn’t work. Try again in a moment.");
  }

  function exportGpx() {
    if (!view || !detail) return;
    const gpx = toGpx({ name: view.title, sport: view.sport, segments: detail.segments });
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), `fitx-${view.sport}-${new Date(view.startedAt).toISOString().slice(0, 10)}.gpx`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/activity" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Back to activity history"><ChevronLeft size={20} aria-hidden="true" /></Link>
        <p className="text-sm text-fitx-text-secondary">Activity</p>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium text-fitx-text-secondary"><SportIcon sport={view.sport} size={15} className="text-fitx-primary" />{SPORT_LABEL[view.sport]} · {formatActivityDate(view.startedAt)}</p>
          {editing ? (
            <form onSubmit={rename} className="mt-2 flex items-center gap-2">
              <label htmlFor="activity-title" className="sr-only">Activity name</label>
              <input id="activity-title" className="fitx-field h-11 min-w-0 flex-1 text-lg font-semibold" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
              <button type="submit" disabled={busy === "rename"} className="fitx-button min-h-11 px-3" aria-label="Save name"><Check size={17} aria-hidden="true" /></button>
              <button type="button" onClick={() => setEditing(false)} className="fitx-button fitx-button-quiet min-h-11 px-3" aria-label="Cancel renaming"><X size={17} aria-hidden="true" /></button>
            </form>
          ) : (
            <h1 className="mt-1 flex items-center gap-2 text-[26px] font-bold leading-tight tracking-[-.03em] text-fitx-text sm:text-[30px]">
              <span className="min-w-0 break-words">{view.title}</span>
              {!view.local && <button type="button" onClick={() => { setTitle(view.title); setEditing(true); }} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Rename activity"><Pencil size={16} aria-hidden="true" /></button>}
            </h1>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSharing(true)} className="fitx-button min-h-11"><Share2 size={16} aria-hidden="true" />Share</button>
          {detailed && <button type="button" onClick={exportGpx} className="fitx-button fitx-button-secondary min-h-11"><Download size={16} aria-hidden="true" />GPX</button>}
        </div>
      </header>

      {message && <p role="alert" className="fitx-alert fitx-alert-danger">{message}</p>}
      {view.local && (
        <section className="fitx-alert flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Saved on this device">
          <p className="flex gap-2"><CloudOff size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" /><span><span className="font-semibold">Saved on this device only.</span> {state.uploadNote === "Activity history is not available yet" ? "Activity history isn’t available yet; it uploads once it is." : "It uploads to your account when you’re online."}</span></p>
          <button type="button" onClick={() => void upload()} disabled={busy === "upload"} className="fitx-button fitx-button-secondary min-h-11 shrink-0"><RefreshCw size={15} aria-hidden="true" />{busy === "upload" ? "Uploading…" : "Upload now"}</button>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          {route.some((segment) => segment.length > 1) ? (
            <ActivityMap segments={route} version={detailed ? 2 : 1} showEnds className="h-[46vh] min-h-72 w-full lg:h-[560px]" label={`Map of the route of ${view.title}`} />
          ) : (
            <div className="grid h-48 place-items-center rounded-xl border border-dashed border-fitx-border bg-fitx-surface px-6 text-center text-sm text-fitx-text-secondary">No route was recorded for this activity.</div>
          )}
          <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">
            {detailed ? "Route from every GPS point." : pruned ? "Detailed GPS points are kept for 90 days; this shows the saved route." : "Saved route."}
            {view.gapCount > 0 && " Gaps are left open, never joined with straight lines."}
          </p>
        </div>

        <section aria-label="Activity statistics" className="space-y-3">
          <div className="fitx-panel p-4 sm:p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Distance</p>
            <p className="mt-1 text-[52px] font-semibold leading-none tabular-nums tracking-tight text-fitx-text">{kmValue(view.distanceM)}<span className="ml-1.5 text-xl font-medium text-fitx-text-secondary">km</span></p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Moving time" value={formatDuration(view.movingSeconds)} />
            <Metric label="Elapsed time" value={formatDuration(view.elapsedSeconds)} note={view.pausedSeconds > 0 ? `${formatDuration(view.pausedSeconds)} paused` : undefined} />
            {pace && <Metric label="Avg pace" value={paceValue(view.avgPaceSecondsPerKm)} note="per km, moving time" />}
            <Metric label="Avg speed" value={speedValue(view.avgSpeedMps)} note="km/h, moving time" />
            {!pace && <Metric label="Max speed" value={speedValue(view.maxSpeedMps)} note={view.maxSpeedMps === null ? "your phone didn’t report its speed" : "km/h"} />}
            <Metric label="Calories" value={view.kcal === null ? "–" : `≈ ${view.kcal}`} note={view.kcal === null ? "Add your weight in Profile to see an estimate" : "kcal, estimated"} />
            {view.elevationGainM !== null && <Metric label="Climb" value={`${Math.round(view.elevationGainM)} m`} note="from GPS altitude, approximate" />}
          </div>
          {view.kcal === null && <Link href="/profile" className="inline-flex min-h-11 items-center text-sm font-medium text-fitx-primary-text">Add your weight</Link>}
        </section>
      </div>

      {view.splits.length > 0 && (
        <section className="fitx-panel overflow-hidden" aria-labelledby="splits-title">
          <h2 id="splits-title" className="border-b border-fitx-divider px-4 py-3 text-sm font-semibold text-fitx-text sm:px-5">Splits</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-[.12em] text-fitx-text-secondary">
              <tr><th scope="col" className="px-4 py-2 font-semibold sm:px-5">Km</th><th scope="col" className="px-2 py-2 font-semibold">{pace ? "Pace" : "Speed"}</th><th scope="col" className="px-2 py-2 font-semibold">Moving</th><th scope="col" className="px-4 py-2 text-right font-semibold sm:px-5">Elapsed</th></tr>
            </thead>
            <tbody>
              {view.splits.map((split) => {
                const speed = split.movingSeconds > 0 ? split.distanceM / split.movingSeconds : null;
                return (
                  <tr key={split.index} className="border-t border-fitx-divider tabular-nums">
                    <td className="px-4 py-2.5 sm:px-5">{split.distanceM < 1000 ? `${split.index} (${formatDistance(split.distanceM)})` : split.index}</td>
                    <td className="px-2 py-2.5 font-medium">{pace ? formatPace(speed ? 1000 / speed : null) : formatSpeed(speed)}</td>
                    <td className="px-2 py-2.5 text-fitx-text-secondary">{formatDuration(split.movingSeconds)}</td>
                    <td className="px-4 py-2.5 text-right text-fitx-text-secondary sm:px-5">{formatDuration(split.elapsedSeconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {view.gaps.length > 0 && (
        <section className="fitx-panel p-4 sm:p-5" aria-labelledby="gaps-title">
          <h2 id="gaps-title" className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><Info size={16} aria-hidden="true" className="text-fitx-info" />Interruptions</h2>
          <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">Phones stop sharing location with websites while the screen is locked or another app is open, GPS can drop out, and a position can jump. FITX doesn’t guess these stretches: they add no distance or moving time.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {view.gaps.map((gap) => (
              <li key={gap.start} className="flex flex-wrap justify-between gap-2 rounded-lg bg-fitx-surface-variant px-3 py-2">
                <span>{GAP_LABEL[gap.kind]}</span>
                <span className="tabular-nums text-fitx-text-secondary">{formatDuration((gap.end - gap.start) / 1000)}{gap.straightLineM !== null && gap.straightLineM >= 20 ? ` · ${formatDistance(gap.straightLineM)} apart` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="fitx-panel space-y-3 p-4 text-xs leading-5 text-fitx-text-secondary sm:p-5" aria-label="About these numbers">
        {view.kcal !== null && <p><span className="font-semibold text-fitx-text">Calories</span> are an estimate: {view.kcalMethod ?? KCAL_METHOD}{view.weightKg ? ` Weight used: ${view.weightKg} kg.` : ""}</p>}
        <p><span className="font-semibold text-fitx-text">Moving time</span> leaves out pauses, stops and interruptions; <span className="font-semibold text-fitx-text">elapsed time</span> is start to finish.</p>
        <p><span className="font-semibold text-fitx-text">Privacy:</span> your routes are visible only to you. Share images leave out the area around the start and finish. Detailed GPS points are kept for 90 days; this summary and route stay until you delete them.</p>
      </section>

      <section className="flex flex-col gap-3 border-t border-fitx-divider pt-4 sm:flex-row sm:items-center sm:justify-between">
        {confirmDelete ? (
          <div className="flex flex-1 flex-col gap-3 rounded-lg border border-fitx-danger-border bg-fitx-danger-bg p-4 sm:flex-row sm:items-center sm:justify-between" role="group" aria-label="Delete this activity?">
            <p className="text-sm font-semibold text-fitx-danger">Delete this {SPORT_NOUN[view.sport]} and its route? This can’t be undone.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="fitx-button fitx-button-secondary min-h-11">Keep</button>
              <button type="button" onClick={() => void remove()} disabled={busy === "delete"} className="fitx-button fitx-button-danger min-h-11"><Trash2 size={15} aria-hidden="true" />{busy === "delete" ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className={cn("fitx-button fitx-button-quiet min-h-11 self-start")}><Trash2 size={15} aria-hidden="true" />Delete activity</button>
        )}
      </section>

      {card && <ShareCardDialog data={card} open={sharing} onClose={() => setSharing(false)} />}
    </div>
  );
}
