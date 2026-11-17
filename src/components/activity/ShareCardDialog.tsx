"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, ImagePlus, Share2, Trash2, X } from "lucide-react";
import { CARD_FORMATS, CARD_SIZE, cardFileName, downloadBlob, renderShareCard, shareImageFile, type CardData, type CardFormat, type SharePhoto } from "@/lib/activity/share-card";
import { cn } from "@/lib/utils";

const FORMAT_TEXT: Record<CardFormat, { label: string; hint: string }> = {
  story: { label: "Story", hint: "9:16 · Stories, Status" },
  feed: { label: "Post", hint: "4:5 · feeds" },
  square: { label: "Square", hint: "1:1 · chats, feeds" },
};
const ASPECT: Record<CardFormat, string> = { story: "aspect-[9/16]", feed: "aspect-[4/5]", square: "aspect-square" };
const FOCUS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Top" },
  { value: 0.5, label: "Centre" },
  { value: 1, label: "Bottom" },
];
/** Photos larger than this are refused before decoding (a phone's full-size photo is far smaller). */
const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

type Rendered = { blob: Blob; url: string };
type Photo = { image: HTMLImageElement; url: string; width: number; height: number };

async function loadPhoto(file: File): Promise<Photo> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error("too-large");
  const url = URL.createObjectURL(file);
  const image = new window.Image();
  image.decoding = "async";
  image.src = url;
  try {
    // Browsers apply the photo's EXIF orientation when decoding and drawing it.
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("unreadable");
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error("unreadable");
  }
  return { image, url, width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * Preview, share and download the activity image, optionally on the person's own photo. Images are
 * drawn as soon as the dialog opens (and again after a photo change), so the Share tap can hand a
 * ready file to the phone's share sheet straight away: browsers only allow sharing right after a tap.
 * The photo stays in this tab: it is never uploaded or saved by FITX.
 */
export function ShareCardDialog({ data, open, onClose }: { data: CardData; open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [format, setFormat] = useState<CardFormat>("story");
  const [images, setImages] = useState<Partial<Record<CardFormat, Rendered>>>({});
  const [renderError, setRenderError] = useState("");
  const [status, setStatus] = useState("");
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [focusY, setFocusY] = useState(0.5);
  const [photoError, setPhotoError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // The photo is released when the dialog closes or another one replaces it.
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => {
    if (open) return;
    const id = window.setTimeout(() => { setPhoto(null); setPhotoError(""); setFocusY(0.5); }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const made: Rendered[] = [];
    const sharePhoto: SharePhoto | null = photo ? { image: photo.image, width: photo.width, height: photo.height, focusY } : null;
    void (async () => {
      try {
        const host = window.location.host;
        const next: Partial<Record<CardFormat, Rendered>> = {};
        for (const option of CARD_FORMATS) {
          const blob = await renderShareCard(data, option, host, sharePhoto);
          if (cancelled) return;
          const rendered = { blob, url: URL.createObjectURL(blob) };
          made.push(rendered);
          next[option] = rendered;
        }
        if (cancelled) return;
        const probe = new File([next.story!.blob], cardFileName(data, "story", Boolean(sharePhoto)), { type: next.story!.blob.type });
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
  }, [open, data, photo, focusY]);

  const current = images[format];
  const size = CARD_SIZE[format];
  const withPhoto = Boolean(photo);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoError("");
    try {
      const loaded = await loadPhoto(file);
      setPhoto(loaded);
      setFocusY(0.5);
      setStatus("");
    } catch (error) {
      setPhotoError((error as Error).message === "too-large" ? "That photo is too large. Choose a smaller one." : "That photo couldn’t be opened here. Choose a JPEG or PNG photo.");
    }
  }

  async function share() {
    if (!current) return;
    const file = new File([current.blob], cardFileName(data, format, withPhoto), { type: current.blob.type });
    const outcome = await shareImageFile(file);
    if (outcome === "shared") setStatus("Shared.");
    else if (outcome === "cancelled") setStatus("");
    else if (outcome === "unsupported") setStatus("This browser can’t share images. Download it and post it from your gallery.");
    else setStatus("Sharing didn’t work. Download the image and post it from your gallery.");
  }

  function download() {
    if (!current) return;
    downloadBlob(current.blob, cardFileName(data, format, withPhoto));
    setStatus("Image downloaded.");
  }

  const photoInput = (
    <input type="file" accept="image/*" className="sr-only" onChange={(event) => void choosePhoto(event)} aria-describedby="share-photo-note" />
  );

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="share-card-title"
      className="m-auto w-[min(100vw-24px,960px)] max-w-none rounded-2xl border border-fitx-border bg-fitx-elevated p-0 text-fitx-text shadow-2xl backdrop:bg-fitx-scrim/70"
    >
      <div className="grid max-h-[calc(100dvh-24px)] gap-0 overflow-y-auto md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex items-center justify-center bg-fitx-surface-variant p-4 sm:p-6">
          {current ? (
            <Image src={current.url} alt={`Share image for ${data.title}${withPhoto ? ", on your photo" : ""}`} width={size.width} height={size.height} unoptimized className={cn("h-auto w-auto rounded-xl shadow-lg", format === "story" ? "max-h-[62dvh]" : "max-h-[56dvh]")} />
          ) : (
            <div className={cn("w-full max-w-xs animate-pulse rounded-xl bg-fitx-track", ASPECT[format])} aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="share-card-title" className="text-lg font-semibold">Share your activity</h2>
              <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">Only numbers that were recorded appear. The area around your start and finish is left out of the route.</p>
            </div>
            <button type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text" aria-label="Close"><X size={18} aria-hidden="true" /></button>
          </div>

          <section aria-labelledby="share-photo-title" className="space-y-2">
            <h3 id="share-photo-title" className="text-sm font-semibold text-fitx-text">Background</h3>
            {photo ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <label className="fitx-button fitx-button-secondary min-h-11 cursor-pointer px-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-fitx-primary">
                    <ImagePlus size={16} aria-hidden="true" />Change photo{photoInput}
                  </label>
                  <button type="button" onClick={() => { setPhoto(null); setStatus(""); }} className="fitx-button fitx-button-quiet min-h-11 px-3 text-sm"><Trash2 size={15} aria-hidden="true" />Remove photo</button>
                </div>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Part of the photo to show">
                  {FOCUS.map((option) => (
                    <button key={option.label} type="button" aria-pressed={focusY === option.value} onClick={() => setFocusY(option.value)}
                      className={cn("min-h-11 rounded-lg border text-sm font-medium transition-colors", focusY === option.value ? "border-fitx-primary bg-fitx-primary/10 text-fitx-primary-text" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40 hover:text-fitx-text")}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <label className="fitx-button fitx-button-secondary min-h-12 w-full cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-fitx-primary">
                <ImagePlus size={17} aria-hidden="true" />Add your photo{photoInput}
              </label>
            )}
            <p id="share-photo-note" className="text-xs leading-5 text-fitx-text-secondary">
              {photo ? "Your numbers sit on the calmer part of the photo." : "Optional: put your numbers on a photo from your phone."} The photo stays on this device: FITX draws the image here and never uploads it.
            </p>
            {photoError && <p role="alert" className="text-xs font-medium text-fitx-danger">{photoError}</p>}
          </section>

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Image shape">
            {CARD_FORMATS.map((option) => (
              <button key={option} type="button" aria-pressed={format === option} onClick={() => { setFormat(option); setStatus(""); }}
                className={cn("min-h-14 rounded-lg border px-2.5 text-left transition-colors", format === option ? "border-fitx-primary bg-fitx-primary/10" : "border-fitx-border hover:border-fitx-primary/40")}>
                <span className={cn("block text-sm font-semibold", format === option ? "text-fitx-primary-text" : "text-fitx-text")}>{FORMAT_TEXT[option].label}</span>
                <span className="block text-[11px] leading-4 text-fitx-text-secondary">{FORMAT_TEXT[option].hint}</span>
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
