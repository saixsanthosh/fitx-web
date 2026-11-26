"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, Check, ChevronLeft, CloudOff, Download, Pencil, RefreshCw, Share2, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { kcalMethodFor } from "@/lib/activity/calories";
import { SPORT_LABEL, SPORT_NOUN } from "@/lib/activity/config";
import { cardDataFor, detailFromEngine, engineOptionsFor, lateKcal, type ActivityDetail } from "@/lib/activity/detail";
import { cleanTitle, formatActivityDate, localDateKey } from "@/lib/activity/format";
import { mayHandFocus } from "@/lib/activity/focus";
import { startsInFuture } from "@/lib/activity/future";
import { toGpx } from "@/lib/activity/gpx";
import { recordingStore } from "@/lib/activity/local-store";
import { decodeRoute } from "@/lib/activity/polyline";
import { replayStored } from "@/lib/activity/replay";
import type { ActivityRecord } from "@/lib/activity/record";
import { deleteActivity, deleteActivityByClientId, getActivity, getTrackChunks, saveBestEfforts, updateActivity, viewFromRecord, type ActivityView } from "@/lib/activity/repository";
import { downloadBlob, type CardData } from "@/lib/activity/share-card";
import { uploadRecording } from "@/lib/activity/sync";
import type { LatLng } from "@/lib/activity/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ActivitySourceBadge } from "./ActivitySourceBadge";
import { ActivityEffortsPanel } from "./BestEfforts";
import { useStoredEfforts } from "./useActivityV2";
import { AboutNumbers, ActivityStatsPanel, InterruptionsList, SplitsTable } from "./ActivitySummaryParts";
import { ElevationProfile } from "./ElevationProfile";
import { ShareCardDialog } from "./ShareCardDialog";
import { AccountError } from "./AccountError";
import { SportBadge, sportHref } from "./sports";
import { useActivityAccount } from "./useActivityAccount";

const ActivityMap = dynamic(() => import("./ActivityMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-fitx-surface-variant" aria-hidden="true" />,
});

type LoadState =
  | { status: "loading" }
  /** `loadedAt`: the clock when it loaded, to tell an activity dated after now. */
  | { status: "ready"; view: ActivityView; uploadNote: string | null; rejected: boolean; localRecord: ActivityRecord | null; loadedAt: number }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "error"; offline: boolean };

export function ActivityDetailScreen({ id }: { id: string }) {
  const account = useActivityAccount();
  const router = useRouter();
  const localClientId = id.startsWith("local-") ? id.slice("local-".length) : null;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  // What is being saved. Its button says aria-disabled meanwhile (disabled would drop keyboard focus; D5) and another
  // press does nothing.
  const [busy, setBusy] = useState<"" | "rename" | "delete" | "upload">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A rename or upload that failed, said under the header (beside both); a failed delete is said in its confirmation.
  const [message, setMessage] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [reload, setReload] = useState(0);
  const focusOnMount = useCallback((element: HTMLElement | null) => element?.focus(), []);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const renameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deviceNoteRef = useRef<HTMLParagraphElement | null>(null);
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null);

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
        else setState({ status: "ready", view: viewFromRecord(stored.record), uploadNote: stored.lastUploadError ?? null, rejected: Boolean(stored.uploadRejected), localRecord: stored.record, loadedAt: Date.now() });
        return;
      }
      const supabase = createClient();
      if (!supabase) return;
      const result = await getActivity(supabase, userId, id);
      if (!active) return;
      if (result.status === "unavailable") setState({ status: "unavailable" });
      else if (result.status !== "ok") setState({ status: "error", offline: result.status === "error" && result.offline });
      else if (!result.data) setState({ status: "missing" });
      else setState({ status: "ready", view: result.data, uploadNote: null, rejected: false, localRecord: null, loadedAt: Date.now() });
    })();
    return () => {
      active = false;
    };
  }, [userId, id, localClientId, reload]);

  const view = state.status === "ready" ? state.view : null;
  const localRecord = state.status === "ready" ? state.localRecord : null;
  const weightKg = account.status === "ready" ? account.weightKg : null;

  // Detailed GPS points: replayed for a precise route and the GPX export, while all of them are
  // kept (a partial set, mid-upload or mid-clean-up, would draw only part of the route).
  useEffect(() => {
    if (!userId || !view) return;
    let active = true;
    const options = engineOptionsFor(view.source);
    const show = (engine: ReturnType<typeof replayStored>) => {
      if (active) setDetail(detailFromEngine(engine));
    };
    if (localRecord) {
      void Promise.resolve().then(() => show(replayStored(localRecord.sport, localRecord.startedAt, localRecord.timeline, localRecord.chunks, options)));
      return () => { active = false; };
    }
    if (view.local || !view.id || !view.chunkCount) return;
    const supabase = createClient();
    if (!supabase) return;
    void (async () => {
      const chunks = await getTrackChunks(supabase, userId, view.id as string);
      if (!active || chunks.status !== "ok") return;
      const complete = chunks.data.length === view.chunkCount && chunks.data.every((chunk, i) => chunk.seq === i);
      if (complete) show(replayStored(view.sport, view.startedAt, view.timeline, chunks.data, options));
    })();
    return () => {
      active = false;
    };
  }, [userId, view, localRecord]);

  // Recorded before a body weight was known: estimate now, and keep it on the activity.
  const fillKcal = lateKcal(view, weightKg);
  useEffect(() => {
    if (!userId || !view || view.local || !view.id || fillKcal === null || weightKg === null) return;
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void updateActivity(supabase, userId, view.id, { kcal: fillKcal, kcalMethod: kcalMethodFor(view.sport), weightKg }).then((result) => {
      if (active && result.status === "ok") setState((previous) => (previous.status === "ready" ? { ...previous, view: { ...previous.view, kcal: fillKcal, kcalMethod: kcalMethodFor(view.sport), weightKg } } : previous));
    });
    return () => {
      active = false;
    };
  }, [userId, view, fillKcal, weightKg]);

  // Best efforts worked out from the points: stored on an activity that has none yet (older ones), once only.
  const [effortsKey, setEffortsKey] = useState(0);
  const storedEfforts = useStoredEfforts(userId && view && !view.local ? userId : null, effortsKey);
  const efforts = detail?.efforts;
  useEffect(() => {
    if (!userId || !view || view.local || !view.id || !efforts?.length) return;
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void saveBestEfforts(supabase, userId, view.id, efforts).then((result) => {
      if (active && result.status === "ok") setEffortsKey((key) => key + 1);
    });
    return () => {
      active = false;
    };
  }, [userId, view, efforts]);

  const kcal = view ? view.kcal ?? fillKcal : null;
  const kcalWeight = view ? view.weightKg ?? (fillKcal !== null ? weightKg : null) : null;
  const route = useMemo<LatLng[][]>(() => detail?.route ?? (view ? decodeRoute(view.routePolyline) : []), [detail, view]);
  const card = useMemo<CardData | null>(() => (view ? cardDataFor(view, kcal) : null), [view, kcal]);

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading activity…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Activities aren’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "signed-out") return <EmptyState title="Sign in to see this activity" description="Activities are private to your account." action={<Link href={`/signin?next=${encodeURIComponent(`/activity/${id}`)}`} className="fitx-button min-h-11">Sign in</Link>} />;
  if (account.status === "error") return <AccountError />;
  if (state.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading activity…</div>;
  if (state.status === "unavailable") return <EmptyState title="Activity history isn’t available yet" description="FITX is finishing an update. Activities you record stay on this device until history is ready." action={<Link href="/activity" className="fitx-button fitx-button-secondary min-h-11">Back to activity</Link>} />;
  if (state.status === "error") return <EmptyState title="This activity couldn’t be loaded" description={state.offline ? "You seem to be offline. Check your connection and try again." : "Something went wrong. Try again in a moment."} action={<button type="button" onClick={() => setReload((n) => n + 1)} className="fitx-button fitx-button-secondary min-h-11"><RefreshCw size={15} aria-hidden="true" />Try again</button>} />;
  if (state.status === "missing" || !view || !card) return <EmptyState title="Activity not found" description="It may have been deleted, or it belongs to another account." action={<Link href="/activity" className="fitx-button fitx-button-secondary min-h-11">Back to activity</Link>} />;

  const detailed = Boolean(detail);
  const pruned = !view.local && view.chunkCount > 0 && !detailed;
  const datedAhead = state.status === "ready" && startsInFuture(view.startedAt, state.loadedAt);

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!view || !userId || view.local || busy === "rename") return;
    const next = cleanTitle(title, view.title);
    const supabase = createClient();
    if (!supabase) return;
    setBusy("rename");
    const result = await updateActivity(supabase, userId, view.id as string, { title: next });
    setBusy("");
    if (result.status !== "ok") return setMessage("The new name couldn’t be saved. Try again.");
    setState((previous) => (previous.status === "ready" ? { ...previous, view: { ...previous.view, title: next } } : previous));
    closeRename();
    setMessage("");
  }

  /** Deletes both copies: the one on this device and any already uploaded to the account. */
  async function remove() {
    if (!view || !userId || busy === "delete") return;
    setBusy("delete");
    setDeleteError("");
    const supabase = createClient();
    const store = await recordingStore();
    if (view.local) {
      // An upload that stopped half way may already have saved it to the account: delete that too.
      // Without any upload attempt there is no such copy, so being offline doesn't block the delete.
      const stored = await store.getRecording(view.clientId).catch(() => null);
      const server = supabase ? await deleteActivityByClientId(supabase, userId, view.clientId) : null;
      if (stored?.uploadAttempts && server && server.status !== "ok" && server.status !== "unavailable") {
        setBusy("");
        return setDeleteError("This activity couldn’t be deleted from your account. Check your connection and try again.");
      }
      await store.deleteRecording(view.clientId).catch(() => undefined);
      router.replace("/activity");
      return;
    }
    const result = supabase ? await deleteActivity(supabase, userId, view.id as string) : null;
    setBusy("");
    if (!result || result.status !== "ok") return setDeleteError("This activity couldn’t be deleted. Check your connection and try again.");
    // Otherwise the device copy would upload it again.
    await store.deleteRecording(view.clientId).catch(() => undefined);
    router.replace("/activity");
  }

  function keep() {
    if (busy === "delete") return;
    setConfirmDelete(false);
    setDeleteError("");
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  }

  async function upload() {
    // Marked as uploading at once, so a second press while the device copy is read does nothing either.
    if (!view || !userId || busy === "upload") return;
    setBusy("upload");
    const store = await recordingStore();
    const stored = await store.getRecording(view.clientId).catch(() => null);
    const supabase = createClient();
    if (!stored || !supabase) {
      setBusy("");
      return;
    }
    const outcome = await uploadRecording(store, supabase, userId, stored);
    setBusy("");
    if (outcome.result.status === "ok") {
      router.replace(`/activity/${outcome.result.data.id}`);
      return;
    }
    if (outcome.result.status === "rejected") {
      setState((previous) => (previous.status === "ready" ? { ...previous, rejected: true } : previous));
      setMessage("");
      // Upload now goes: focus moves to the note, which now says why it can't be uploaded (D5).
      window.setTimeout(() => { if (mayHandFocus(document, uploadButtonRef.current)) deviceNoteRef.current?.focus(); }, 0);
      return;
    }
    setMessage(outcome.result.status === "unavailable" ? "Activity history isn’t available yet. It stays on this device until it is." : outcome.result.status === "error" && outcome.result.offline ? "You’re offline. It will upload when you’re back online." : "The upload didn’t work. Try again in a moment.");
  }

  function closeRename() {
    setEditing(false);
    window.setTimeout(() => renameTriggerRef.current?.focus(), 0);
  }

  function exportGpx() {
    if (!view || !detail) return;
    const gpx = toGpx({ name: view.title, sport: view.sport, segments: detail.segments });
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), `fitx-${view.sport}-${localDateKey(view.startedAt)}.gpx`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-2">
        <Link href="/activity" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Back to activity history"><ChevronLeft size={20} aria-hidden="true" /></Link>
        <p className="text-sm text-fitx-text-secondary">Activity</p>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2.5 text-xs font-medium text-fitx-text-secondary"><SportBadge sport={view.sport} size={32} /><span><Link href={sportHref(view.sport)} className="font-semibold text-fitx-text hover:text-fitx-primary-text">{SPORT_LABEL[view.sport]}</Link> · {formatActivityDate(view.startedAt)}</span></p>
          <ActivitySourceBadge info={view} variant="pill" className="mt-2" />
          {editing ? (
            <form onSubmit={rename} className="mt-2 flex items-center gap-2">
              <label htmlFor="activity-title" className="sr-only">Activity name</label>
              <input id="activity-title" className="fitx-field h-11 min-w-0 flex-1 text-lg font-semibold" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
              <button type="submit" aria-disabled={busy === "rename" || undefined} className="fitx-button min-h-11 px-3 aria-disabled:cursor-progress aria-disabled:opacity-60" aria-label="Save name"><Check size={17} aria-hidden="true" /></button>
              <button type="button" onClick={closeRename} className="fitx-button fitx-button-quiet min-h-11 px-3" aria-label="Cancel renaming"><X size={17} aria-hidden="true" /></button>
            </form>
          ) : (
            <h1 className="mt-2 flex items-center gap-2 font-heading text-[28px] font-bold leading-tight tracking-[-.035em] text-fitx-text sm:text-[34px]">
              <span className="min-w-0 break-words">{view.title}</span>
              {!view.local && <button type="button" ref={renameTriggerRef} onClick={() => { setTitle(view.title); setEditing(true); }} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Rename activity"><Pencil size={16} aria-hidden="true" /></button>}
            </h1>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSharing(true)} className="fitx-button min-h-11"><Share2 size={16} aria-hidden="true" />Share</button>
          {detailed && <button type="button" onClick={exportGpx} className="fitx-button fitx-button-secondary min-h-11"><Download size={16} aria-hidden="true" />GPX</button>}
        </div>
      </header>

      {message && <p role="alert" className="fitx-alert fitx-alert-danger">{message}</p>}
      {datedAhead && (
        <p className="fitx-alert flex gap-2"><CalendarClock size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" /><span><span className="font-semibold">This activity is dated in the future,</span> so your weekly, monthly and yearly totals leave it out until then. If the date is wrong, the device that recorded it had the wrong date or time. FITX can’t move it, but you can delete it below.</span></p>
      )}
      {view.local && (
        <section className="fitx-alert flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Saved on this device">
          <p ref={deviceNoteRef} tabIndex={-1} className="flex gap-2"><CloudOff size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" /><span><span className="font-semibold">Saved on this device only.</span>{" "}
            {state.rejected
              ? "It can’t be uploaded to your account: it’s outside what an activity can hold (for example, longer than 48 hours). It stays here: you can share it or download its GPX."
              : state.uploadNote === "Activity history is not available yet" ? "Activity history isn’t available yet; it uploads once it is." : "It uploads to your account when you’re online."}</span></p>
          {!state.rejected && <button type="button" ref={uploadButtonRef} onClick={() => void upload()} aria-disabled={busy === "upload" || undefined} className="fitx-button fitx-button-secondary min-h-11 shrink-0 aria-disabled:cursor-progress aria-disabled:opacity-60"><RefreshCw size={15} aria-hidden="true" />{busy === "upload" ? "Uploading…" : "Upload now"}</button>}
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

        <ActivityStatsPanel view={view} kcal={kcal} />
      </div>

      {detail?.profile && <ElevationProfile profile={detail.profile} source={view.source} climbM={view.elevationGainM} />}
      {detail && <ActivityEffortsPanel activityId={view.local ? null : view.id} sport={view.sport} startedAt={view.startedAt} efforts={detail.efforts} stored={storedEfforts} />}
      <SplitsTable view={view} />
      <InterruptionsList view={view} />
      <AboutNumbers view={view} kcal={kcal} kcalWeight={kcalWeight} />

      <section className="flex flex-col gap-3 border-t border-fitx-divider pt-4 sm:flex-row sm:items-center sm:justify-between">
        {confirmDelete ? (
          <div className="flex flex-1 flex-col gap-3 rounded-lg border border-fitx-danger-border bg-fitx-danger-bg p-4 sm:flex-row sm:items-center sm:justify-between" role="alertdialog" aria-labelledby="delete-question">
            <div className="min-w-0 space-y-1">
              <p id="delete-question" className="text-sm font-semibold text-fitx-danger">Delete this {SPORT_NOUN[view.sport]} and its route? This can’t be undone.</p>
              {/* Beside the Delete button that was pressed, where it keeps focus (D6). */}
              {deleteError && <p role="alert" className="text-sm text-fitx-danger">{deleteError}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" ref={focusOnMount} onClick={keep} aria-disabled={busy === "delete" || undefined} className="fitx-button fitx-button-secondary min-h-11 aria-disabled:cursor-progress aria-disabled:opacity-60">Keep</button>
              <button type="button" onClick={() => void remove()} aria-disabled={busy === "delete" || undefined} className="fitx-button fitx-button-danger min-h-11 aria-disabled:cursor-progress aria-disabled:opacity-60"><Trash2 size={15} aria-hidden="true" />{busy === "delete" ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        ) : (
          <button type="button" ref={deleteTriggerRef} onClick={() => setConfirmDelete(true)} className={cn("fitx-button fitx-button-quiet min-h-11 self-start")}><Trash2 size={15} aria-hidden="true" />Delete activity</button>
        )}
      </section>

      {card && <ShareCardDialog data={card} open={sharing} onClose={() => setSharing(false)} />}
    </div>
  );
}
