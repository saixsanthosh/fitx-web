"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Download, Share2, X } from "lucide-react";
import { CARD_SIZE, cardFileName, downloadBlob, renderShareCard, shareImageFile, type CardData, type CardFormat } from "@/lib/activity/share-card";
import { cn } from "@/lib/utils";

const FORMATS: Array<{ id: CardFormat; label: string; hint: string }> = [
  { id: "story", label: "Story", hint: "9:16 · WhatsApp Status, Stories" },
  { id: "feed", label: "Post", hint: "4:5 · feeds and chats" },
];

type Rendered = { blob: Blob; url: string };

/**
 * Preview, share and download the activity image. Images are drawn when the dialog opens, so the
 * Share tap can hand a ready file to the phone's share sheet straight away (browsers only allow
 * sharing right after a tap).
 */
export function ShareCardDialog({ data, open, onClose }: { data: CardData; open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [format, setFormat] = useState<CardFormat>("story");
  const [images, setImages] = useState<Partial<Record<CardFormat, Rendered>>>({});
  const [renderError, setRenderError] = useState("");
  const [status, setStatus] = useState("");
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const made: Rendered[] = [];
    void (async () => {
      try {
        const host = window.location.host;
        const next: Partial<Record<CardFormat, Rendered>> = {};
        for (const option of FORMATS) {
          const blob = await renderShareCard(data, option.id, host);
          const rendered = { blob, url: URL.createObjectURL(blob) };
          made.push(rendered);
          next[option.id] = rendered;
        }
        if (cancelled) return;
        const probe = new File([next.story!.blob], "fitx.png", { type: "image/png" });
        setCanShareFiles(typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }));
        setImages(next);
        setRenderError("");
      } catch {
        if (!cancelled) setRenderError("The image couldn’t be created on this device.");
      }
    })();
    return () => {
      cancelled = true;
      for (const rendered of made) URL.revokeObjectURL(rendered.url);
      setImages({});
      setStatus("");
    };
  }, [open, data]);

  const current = images[format];
  const size = CARD_SIZE[format];

  async function share() {
    if (!current) return;
    const file = new File([current.blob], cardFileName(data, format), { type: "image/png" });
    const outcome = await shareImageFile(file);
    if (outcome === "shared") setStatus("Shared.");
    else if (outcome === "cancelled") setStatus("");
    else if (outcome === "unsupported") setStatus("This browser can’t share images. Download it and post it from your gallery.");
    else setStatus("Sharing didn’t work. Download the image and post it from your gallery.");
  }

  function download() {
    if (!current) return;
    downloadBlob(current.blob, cardFileName(data, format));
    setStatus("Image downloaded.");
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="share-card-title"
      className="m-auto w-[min(100vw-24px,920px)] max-w-none rounded-2xl border border-fitx-border bg-fitx-elevated p-0 text-fitx-text shadow-2xl backdrop:bg-fitx-scrim/70"
    >
      <div className="grid max-h-[calc(100dvh-24px)] gap-0 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex items-center justify-center bg-fitx-surface-variant p-4 sm:p-6">
          {current ? (
            <Image src={current.url} alt={`Share image for ${data.title}`} width={size.width} height={size.height} unoptimized className={cn("h-auto w-auto rounded-xl shadow-lg", format === "story" ? "max-h-[62dvh]" : "max-h-[56dvh]")} />
          ) : (
            <div className={cn("w-full max-w-xs animate-pulse rounded-xl bg-fitx-track", format === "story" ? "aspect-[9/16]" : "aspect-[4/5]")} aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="share-card-title" className="text-lg font-semibold">Share your activity</h2>
              <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">The area around your start and finish is left out of the route.</p>
            </div>
            <button type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Close"><X size={18} aria-hidden="true" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Image shape">
            {FORMATS.map((option) => (
              <button key={option.id} type="button" aria-pressed={format === option.id} onClick={() => { setFormat(option.id); setStatus(""); }}
                className={cn("min-h-14 rounded-lg border px-3 text-left transition-colors", format === option.id ? "border-fitx-primary bg-fitx-primary/10" : "border-fitx-border hover:border-fitx-primary/40")}>
                <span className={cn("block text-sm font-semibold", format === option.id ? "text-fitx-primary-text" : "text-fitx-text")}>{option.label}</span>
                <span className="block text-[11px] text-fitx-text-secondary">{option.hint}</span>
              </button>
            ))}
          </div>
          {renderError && <p role="alert" className="fitx-alert fitx-alert-danger">{renderError}</p>}
          <div className="grid gap-2">
            {canShareFiles && <button type="button" onClick={() => void share()} disabled={!current} className="fitx-button min-h-12"><Share2 size={16} aria-hidden="true" />Share image</button>}
            <button type="button" onClick={download} disabled={!current} className={cn("fitx-button min-h-12", canShareFiles && "fitx-button-secondary")}><Download size={16} aria-hidden="true" />Download image</button>
          </div>
          {status && <p role="status" className="text-sm text-fitx-text-secondary">{status}</p>}
          <p className="text-xs leading-5 text-fitx-text-secondary">
            {canShareFiles
              ? "Share opens your phone’s share menu. For WhatsApp Status pick WhatsApp, then My status; for Instagram pick Instagram, then Story, where your phone offers them. FITX can’t post for you."
              : "Download the image, then post it from your gallery in WhatsApp (Status), Instagram (Story) or any other app."}
          </p>
        </div>
      </div>
    </dialog>
  );
}
