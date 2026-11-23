"use client";

import { useEffect, useId, useRef, useState } from "react";
import { COVER_MAX_BYTES } from "@/lib/explore-rules";
import styles from "./explore.module.css";

const WIDTH = 1600;
const HEIGHT = 900;

/** Crops a picture to 16:9 around its centre, scales it to at most 1600×900 and encodes WebP in the browser. */
async function toCoverWebp(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = WIDTH / HEIGHT;
    const sourceWidth = Math.min(bitmap.width, bitmap.height * ratio);
    const sourceHeight = sourceWidth / ratio;
    const scale = Math.min(1, WIDTH / sourceWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.82, 0.7, 0.58]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.type === "image/webp" && blob.size <= COVER_MAX_BYTES) return blob;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The community cover: the chosen picture is made into a 16:9 WebP here and sent with the form as "cover" (the
 * server checks the bytes again and uploads it to communities/<id>/cover.webp).
 */
export function CoverPicker({ currentUrl }: { currentUrl: string | null }) {
  const id = useId();
  const sendRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  async function choose(file: File | undefined) {
    setMessage(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose a picture.");
      return;
    }
    setMessage("Preparing the cover…");
    const blob = await toCoverWebp(file);
    const send = sendRef.current;
    if (!blob || !send) {
      setMessage("This browser could not make a WebP cover from that picture. Try another picture or browser.");
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "cover.webp", { type: "image/webp" }));
    send.files = transfer.files;
    setPreview(URL.createObjectURL(blob));
    setMessage(`Ready: ${Math.round(blob.size / 1024)} KB. It is saved with the community.`);
  }

  const shown = preview ?? currentUrl;
  return (
    <div className={styles.picker}>
      {shown && (
        <div className={styles.cover}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed Storage link or a local preview */}
          <img src={shown} alt="Community cover" />
        </div>
      )}
      <label htmlFor={id}>Cover picture (optional)</label>
      <input id={id} className={styles.pickerInput} type="file" accept="image/*" onChange={(event) => void choose(event.target.files?.[0])} />
      <input ref={sendRef} type="file" name="cover" accept="image/webp" hidden tabIndex={-1} aria-hidden="true" />
      {message && <p className={styles.note} role="status">{message}</p>}
    </div>
  );
}
