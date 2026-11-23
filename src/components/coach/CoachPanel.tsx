"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Maximize2, X } from "lucide-react";
import type { CoachStatus } from "@/lib/ai/status";
import { FitxMark } from "@/components/ui/FitxMark";
import { CoachApp } from "./CoachApp";
import { CoachRequestError, fetchStatus } from "./coach-client";
import { CoachUnavailable } from "./CoachUnavailable";
import styles from "./CoachPanel.module.css";

/** Time the closing slide takes; the dialog closes after it (at once with reduced motion). */
const CLOSE_MS = 220;

type Load = { kind: "loading" } | { kind: "ready"; status: CoachStatus } | { kind: "signed_out" } | { kind: "failed" };

/**
 * The AI Coach as a panel over any page (BRIEF 3.2): a modal dialog named "AI Coach", a bottom sheet below 768 px and a
 * side panel from 768 px. The native modal dialog keeps focus inside and makes the page behind it inert; Escape, the
 * backdrop and "Close AI Coach" close it. It holds the full coach: consent, unavailable and paused states included.
 */
export function CoachPanel({ open, onClose, initialPrompt, promptKey = 0 }: { open: boolean; onClose: () => void; initialPrompt?: string; promptKey?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const closeTimer = useRef<number | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(() => {
    fetchStatus()
      .then((status) => {
        loaded.current = true;
        setLoad({ kind: "ready", status });
      })
      .catch((error) => setLoad(error instanceof CoachRequestError && error.code === "unauthorized" ? { kind: "signed_out" } : { kind: "failed" }));
  }, []);

  // Opening again mid-close drops the closing state at once.
  if (open && closing) setClosing(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
      if (!element.open) element.showModal();
      // The coach keeps its own state once loaded; only a first or failed load is fetched again.
      if (!loaded.current) refresh();
      return;
    }
    if (!element.open) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      element.close();
      return;
    }
    // The closing class goes on in the next frame (state is not set inside the effect itself).
    const frame = window.requestAnimationFrame(() => setClosing(true));
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      element.close();
    }, CLOSE_MS);
    return () => window.cancelAnimationFrame(frame);
  }, [open, refresh]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="coach-panel-title"
      className={styles.panel}
      data-closing={closing ? "" : undefined}
      // Escape: close through the parent, so the slide-out runs and the launcher takes focus back.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A press on the backdrop lands on the dialog element itself, outside the sheet.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet}>
        <span className={styles.grabber} aria-hidden="true" />
        <header className={styles.head}>
          <span className={styles.mark} aria-hidden="true"><FitxMark size={18} /></span>
          <h2 id="coach-panel-title" className={styles.title}>AI Coach</h2>
          <Link href="/ai-coach" onClick={onClose} className={styles.icon} aria-label="Open the full AI Coach page">
            <Maximize2 size={17} aria-hidden="true" />
          </Link>
          <button type="button" onClick={onClose} className={styles.icon} aria-label="Close AI Coach">
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.body}>
          {load.kind === "loading" && (
            <p className={styles.loading}><Loader2 size={16} aria-hidden="true" className="animate-spin" /> Opening your coach…</p>
          )}
          {load.kind === "failed" && <CoachUnavailable state="failed" />}
          {load.kind === "signed_out" && (
            <div className="fitx-panel px-5 py-8 text-center">
              <p className="text-sm text-fitx-text-secondary">Your session has ended. Sign in again to talk to your coach.</p>
              <Link href="/signin" className="fitx-button mt-4 inline-flex">Sign in</Link>
            </div>
          )}
          {load.kind === "ready" && (
            <CoachApp initialStatus={load.status} variant="panel" prompt={initialPrompt ? { text: initialPrompt, key: promptKey } : undefined} />
          )}
        </div>
      </div>
    </dialog>
  );
}
