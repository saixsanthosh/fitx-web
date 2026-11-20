"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, LoaderCircle, Video } from "lucide-react";
import { checkDeclaredFile, MEDIA_LIMITS, type MediaKind } from "@/lib/content/media-rules";
import styles from "./content.module.css";

export type PrepareResult = { ok: true; path: string; uploadUrl: string } | { ok: false; message: string };
export type FinishResult = { ok: true } | { ok: false; message: string };
export type FinishInput = { ownerId: string; kind: MediaKind; path: string; alt: string; attribution: string; license: string; width: number | null; height: number | null };

type Phase = { step: "idle" | "ready" | "uploading" | "checking"; progress: number; message: string | null };

/** Width and height of the chosen picture or video, read in the browser; null when it cannot be read. */
async function measure(file: File, url: string): Promise<{ width: number | null; height: number | null }> {
  if (file.type.startsWith("image/")) {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return { width: null, height: null };
    }
  }
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => resolve({ width: video.videoWidth || null, height: video.videoHeight || null });
    video.onerror = () => resolve({ width: null, height: null });
    video.src = url;
  });
}

/** Sends the file straight to Storage at the one-time address, reporting progress. */
function put(url: string, file: File, onProgress: (share: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type);
    request.setRequestHeader("cache-control", "max-age=31536000");
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.send(file);
  });
}

/**
 * Picks, previews and uploads one photo or video. The type and size are checked here and again on the
 * server, which also reads the file's first bytes before anything points at it.
 */
export function MediaUploader({ ownerId, kind, prepare, finish, defaultAlt = "", defaultCredit = "FITX", defaultLicence = "FITX own work, all rights reserved" }: {
  ownerId: string;
  kind: MediaKind;
  prepare: (input: { ownerId: string; kind: MediaKind; type: string; size: number }) => Promise<PrepareResult>;
  finish: (input: FinishInput) => Promise<FinishResult>;
  defaultAlt?: string;
  defaultCredit?: string;
  defaultLicence?: string;
}) {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle", progress: 0, message: null });
  const limit = MEDIA_LIMITS[kind];
  const isVideo = kind === "video_loop";

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const choose = (chosen: File | null | undefined) => {
    if (!chosen) return;
    const problem = checkDeclaredFile(kind, chosen.type, chosen.size);
    if (problem) {
      setPhase({ step: "idle", progress: 0, message: problem });
      return;
    }
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    setPhase({ step: "ready", progress: 0, message: null });
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = async (form: HTMLFormElement) => {
    if (!file || !preview) return;
    const data = new FormData(form);
    const alt = String(data.get("alt") ?? "").trim();
    const attribution = String(data.get("attribution") ?? "").trim();
    const license = String(data.get("license") ?? "").trim();
    if (!attribution || !license) {
      setPhase({ step: "ready", progress: 0, message: "Add a credit line and a licence." });
      return;
    }
    setPhase({ step: "uploading", progress: 0, message: null });
    const size = await measure(file, preview);
    const prepared = await prepare({ ownerId, kind, type: file.type, size: file.size });
    if (!prepared.ok) return setPhase({ step: "ready", progress: 0, message: prepared.message });
    const sent = await put(prepared.uploadUrl, file, (share) => setPhase({ step: "uploading", progress: share, message: null }));
    if (!sent) return setPhase({ step: "ready", progress: 0, message: "The upload did not finish. Check the connection and try again." });
    setPhase({ step: "checking", progress: 1, message: null });
    const finished = await finish({ ownerId, kind, path: prepared.path, alt, attribution, license, ...size });
    if (!finished.ok) return setPhase({ step: "ready", progress: 0, message: finished.message });
    reset();
    setPhase({ step: "idle", progress: 0, message: isVideo ? "Video added." : "Photo added." });
    router.refresh();
  };

  const busy = phase.step === "uploading" || phase.step === "checking";
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void upload(event.currentTarget);
      }}
    >
      <label
        htmlFor={`${id}-file`}
        className={`${styles.drop} ${over ? styles.dropActive : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          choose(event.dataTransfer.files[0]);
        }}
      >
        {isVideo ? <Video aria-hidden="true" size={22} /> : <ImageUp aria-hidden="true" size={22} />}
        <strong>{file ? file.name : isVideo ? "Choose a video loop" : "Choose a photo"}</strong>
        <span>{limit.label}</span>
        <input
          ref={inputRef}
          id={`${id}-file`}
          className={styles.fileInput}
          type="file"
          accept={limit.types.join(",")}
          disabled={busy}
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </label>

      {file && preview && (
        <div className={styles.grid2}>
          <div className={styles.mediaFrame}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob:) of the chosen file */}
            {isVideo ? <video src={preview} muted loop playsInline controls aria-label="Preview" /> : <img src={preview} alt="Preview of the chosen photo" />}
          </div>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-alt`}>Describe it</label>
              <input className={styles.input} id={`${id}-alt`} name="alt" defaultValue={defaultAlt} maxLength={300} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-credit`}>Credit line</label>
              <input className={styles.input} id={`${id}-credit`} name="attribution" defaultValue={defaultCredit} maxLength={200} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${id}-licence`}>Licence</label>
              <input className={styles.input} id={`${id}-licence`} name="license" defaultValue={defaultLicence} maxLength={120} />
            </div>
          </div>
        </div>
      )}

      {busy && (
        <progress className={styles.progress} max={1} value={phase.step === "checking" ? undefined : phase.progress} aria-label={phase.step === "checking" ? "Checking the file" : "Uploading"} />
      )}

      <div className={styles.actions}>
        <button className={styles.button} type="submit" disabled={!file || busy}>
          {busy && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
          {phase.step === "checking" ? "Checking" : phase.step === "uploading" ? "Uploading" : "Upload"}
        </button>
        {file && !busy && (
          <button className={styles.buttonQuiet} type="button" onClick={() => { reset(); setPhase({ step: "idle", progress: 0, message: null }); }}>
            Cancel
          </button>
        )}
      </div>
      <p className={styles.formStatus} role="status" aria-live="polite">{phase.message}</p>
    </form>
  );
}
