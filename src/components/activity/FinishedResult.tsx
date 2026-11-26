"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CloudOff, Download, RefreshCw, Share2 } from "lucide-react";
import { SPORT_LABEL, SPORT_NOUN } from "@/lib/activity/config";
import { cardDataFor, detailFromEngine, engineOptionsFor } from "@/lib/activity/detail";
import type { KeptReason } from "@/lib/activity/finish";
import { hasFocus, mayHandFocus } from "@/lib/activity/focus";
import { formatActivityDate, localDateKey } from "@/lib/activity/format";
import { toGpx } from "@/lib/activity/gpx";
import { recordingStore } from "@/lib/activity/local-store";
import { decodeRoute } from "@/lib/activity/polyline";
import type { ActivityRecord } from "@/lib/activity/record";
import { replayStored } from "@/lib/activity/replay";
import { viewFromRecord } from "@/lib/activity/repository";
import { downloadBlob } from "@/lib/activity/share-card";
import { uploadRecording } from "@/lib/activity/sync";
import { createClient } from "@/lib/supabase/client";
import { ActivitySourceBadge } from "./ActivitySourceBadge";
import { ActivityStatsPanel, InterruptionsList, SplitsTable } from "./ActivitySummaryParts";
import { ElevationProfile } from "./ElevationProfile";
import { RouteSvg } from "./RouteSvg";
import { ShareCardDialog } from "./ShareCardDialog";

const REASON_TEXT: Record<KeptReason, string> = {
  offline: "You’re offline, so it’s saved on this device. It uploads to your account when you’re back online.",
  timeout: "The connection is slow, so it’s saved on this device for now. It keeps trying to upload.",
  unavailable: "Activity history isn’t available yet, so it’s saved on this device and uploads once it is.",
  rejected: "It can’t be uploaded to your account: it’s outside what an activity can hold. It stays on this device: you can share it or download its GPX.",
  error: "It couldn’t be uploaded just now. It’s saved on this device and uploads later.",
};

/**
 * The result of a just-finished activity, drawn from the copy on this device, for when the upload
 * hasn't worked (no signal, a slow connection). Nothing here needs the network: the route is drawn
 * without map tiles, and sharing and GPX work from the device copy. When the browser is back online
 * it uploads and moves on to the saved activity's page.
 */
export function FinishedResult({ record, userId, reason, onUploaded }: { record: ActivityRecord; userId: string; reason: KeptReason; onUploaded: (id: string) => void }) {
  const view = useMemo(() => viewFromRecord(record), [record]);
  const detail = useMemo(() => detailFromEngine(replayStored(record.sport, record.startedAt, record.timeline, record.chunks, engineOptionsFor(view.source))), [record, view.source]);
  const card = useMemo(() => cardDataFor(view, record.kcal), [view, record.kcal]);
  const route = detail.route.some((segment) => segment.length > 1) ? detail.route : decodeRoute(record.routePolyline);
  const [state, setState] = useState<{ reason: KeptReason; busy: boolean; note: string }>({ reason, busy: false, note: "" });
  const [sharing, setSharing] = useState(false);
  const uploading = useRef(false);
  const retry = useRef<() => void>(() => undefined);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const noteRef = useRef<HTMLParagraphElement | null>(null);
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.reason === "rejected") return;
    const attempt = async (manual: boolean) => {
      if (uploading.current) return;
      const supabase = createClient();
      if (!supabase) return;
      uploading.current = true;
      if (manual) setState((previous) => ({ ...previous, busy: true, note: "" }));
      try {
        const store = await recordingStore();
        const stored = await store.getRecording(record.clientId).catch(() => null);
        const row = stored?.record ? stored : { clientId: record.clientId, userId, sport: record.sport, startedAt: record.startedAt, state: "finished" as const, updatedAt: Date.now(), record };
        const outcome = await uploadRecording(store, supabase, userId, row);
        if (outcome.result.status === "ok") {
          onUploaded(outcome.result.data.id);
          return;
        }
        const next: KeptReason = outcome.result.status === "error" ? (outcome.result.offline ? "offline" : "error") : outcome.result.status;
        // Refused: Upload now goes, and focus moves to the note, which now says why (D5): after a press, and after a try
        // that came by itself (back online) only if Upload now has focus as it goes. Asked before the swap is drawn.
        const handOn = next === "rejected" && (manual || hasFocus(document, uploadButtonRef.current));
        setState({ reason: next, busy: false, note: manual ? "Not uploaded yet." : "" });
        if (handOn) window.setTimeout(() => { if (mayHandFocus(document, uploadButtonRef.current)) noteRef.current?.focus(); }, 0);
      } finally {
        uploading.current = false;
      }
    };
    const online = () => void attempt(false);
    window.addEventListener("online", online);
    retry.current = () => void attempt(true);
    return () => window.removeEventListener("online", online);
  }, [record, userId, onUploaded, state.reason]);

  function exportGpx() {
    const gpx = toGpx({ name: record.title, sport: record.sport, segments: detail.segments });
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), `fitx-${record.sport}-${localDateKey(record.startedAt)}.gpx`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium text-fitx-text-secondary"><CheckCircle2 size={15} aria-hidden="true" className="text-fitx-success" />{SPORT_LABEL[record.sport]} finished · {formatActivityDate(record.startedAt)}</p>
        <h1 ref={headingRef} tabIndex={-1} className="text-[26px] font-bold leading-tight tracking-[-.03em] text-fitx-text outline-none sm:text-[30px]">{record.title}</h1>
        <ActivitySourceBadge info={view} variant="pill" />
      </header>

      <section className="fitx-alert flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Saved on this device">
        {/* A live region: a try that didn't upload is read out while focus stays on Upload now. */}
        <p ref={noteRef} tabIndex={-1} role="status" className="flex gap-2"><CloudOff size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" /><span><span className="font-semibold">Your {SPORT_NOUN[record.sport]} is saved.</span> {REASON_TEXT[state.reason]}{state.note ? ` ${state.note}` : ""}</span></p>
        {state.reason !== "rejected" && (
          <button type="button" ref={uploadButtonRef} onClick={() => retry.current()} aria-disabled={state.busy || undefined} className="fitx-button fitx-button-secondary min-h-11 shrink-0 aria-disabled:cursor-progress aria-disabled:opacity-60"><RefreshCw size={15} aria-hidden="true" />{state.busy ? "Uploading…" : "Upload now"}</button>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSharing(true)} className="fitx-button min-h-11"><Share2 size={16} aria-hidden="true" />Share</button>
        {detail.segments.length > 0 && <button type="button" onClick={exportGpx} className="fitx-button fitx-button-secondary min-h-11"><Download size={16} aria-hidden="true" />GPX</button>}
        <Link href="/activity" className="fitx-button fitx-button-quiet min-h-11">Activity history</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          {route.some((segment) => segment.length > 1) ? (
            <div className="grid h-[38vh] min-h-64 place-items-center rounded-xl border border-fitx-border bg-fitx-surface-variant p-4 lg:h-[520px]">
              <RouteSvg segments={route} className="h-full w-full" strokeWidth={3} />
            </div>
          ) : (
            <div className="grid h-40 place-items-center rounded-xl border border-dashed border-fitx-border bg-fitx-surface px-6 text-center text-sm text-fitx-text-secondary">No route was recorded.</div>
          )}
          <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">Route drawn without a map while it’s only on this device.{view.gapCount > 0 && " Gaps are left open, never joined with straight lines."}</p>
        </div>
        <ActivityStatsPanel view={view} kcal={record.kcal} showWeightLink={false} />
      </div>

      {detail.profile && <ElevationProfile profile={detail.profile} source={view.source} climbM={view.elevationGainM} />}
      <SplitsTable view={view} />
      <InterruptionsList view={view} />

      <ShareCardDialog data={card} open={sharing} onClose={() => setSharing(false)} />
    </div>
  );
}
