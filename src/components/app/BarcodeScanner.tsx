"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import type { DecodeHintType as HintType } from "@zxing/library";
import { Barcode, Camera, Flashlight, ImageUp, X } from "lucide-react";
import { checkBarcode } from "@/lib/food/barcode";
import { openCamera, stopCamera } from "@/lib/food/camera";
import styles from "./BarcodeScanner.module.css";

/** The parts of the Barcode Detection API FITX uses (Chrome on Android has it; Safari on iPhone does not). */
interface NativeDetector {
  detect(source: CanvasImageSource | ImageBitmap): Promise<Array<{ rawValue: string; format: string }>>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

const RETAIL_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const CAMERA: MediaStreamConstraints = { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } };

async function nativeDetector(): Promise<NativeDetector | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const supported = await Detector.getSupportedFormats();
    const formats = RETAIL_FORMATS.filter((format) => supported.includes(format));
    return formats.includes("ean_13") ? new Detector({ formats }) : null;
  } catch {
    return null;
  }
}

function cameraProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was blocked. Allow the camera for this site in your browser settings, take a photo instead, or type the barcode above.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found. Take a photo of the barcode instead, or type the number above.";
  if (name === "NotReadableError") return "The camera is busy in another app. Close it and try again, or type the barcode above.";
  return "The camera could not start. Take a photo of the barcode instead, or type the number above.";
}

/**
 * Scans retail barcodes (EAN-13, EAN-8, UPC-A, UPC-E) with the rear camera: the browser's own detector where it
 * exists (Android Chrome), ZXing otherwise (iPhone Safari). A code counts only after two matching reads with a
 * valid check digit, read in the format the scanner saw (an 8-digit UPC-E is looked up as its UPC-A number). A photo
 * of the barcode works as a fallback, and the torch can be switched on when the camera has one. The camera is
 * turned off whenever the scanner closes, also while it is still starting.
 */
export function BarcodeScanner({ onDetected, autoOpen = false, onAutoOpened }: {
  onDetected: (value: string) => void;
  autoOpen?: boolean;
  /** Called once the scanner has opened by itself, so the parent can clear `autoOpen` and a remount does not reopen it. */
  onAutoOpened?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("Starting the camera…");
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const onAutoOpenedRef = useRef(onAutoOpened);
  useEffect(() => { onAutoOpenedRef.current = onAutoOpened; }, [onAutoOpened]);
  // Home's "Scan a barcode" link (/nutrition?scan=1) opens the scanner straight away, once.
  useEffect(() => {
    if (!autoOpen) return;
    void Promise.resolve().then(() => { setMessage("Starting the camera…"); setOpen(true); onAutoOpenedRef.current?.(); });
  }, [autoOpen]);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const photo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !video.current) return;
    const element = video.current;
    let cancelled = false;
    let controls: IScannerControls | null = null;
    let stream: MediaStream | null = null;
    let frame = 0;
    let last = "";
    let lastAt = 0;

    /** Two matching valid reads within 1.5 s, so one misread frame never looks a product up. */
    const accept = (raw: string, format: string | undefined) => {
      const checked = checkBarcode(raw, format);
      if (!checked.ok) return;
      const now = performance.now();
      if (checked.code === last && now - lastAt < 1500) {
        cancelled = true;
        setOpen(false);
        onDetected(checked.code);
        return;
      }
      last = checked.code;
      lastAt = now;
    };

    const findTorch = (media: MediaStream | null) => {
      const videoTrack = media?.getVideoTracks()[0] ?? null;
      track.current = videoTrack;
      const capabilities = (videoTrack?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ available: Boolean(capabilities.torch), on: false });
    };

    const start = window.setTimeout(() => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setMessage("Camera scanning needs a secure (https) page. Take a photo of the barcode, or type the number above.");
        return;
      }
      setMessage("Starting the camera…");
      void (async () => {
        try {
          const detector = await nativeDetector();
          // Closed while the detector was checked: never turn the camera on.
          if (cancelled) return;
          if (detector) {
            const media = await openCamera((constraints) => navigator.mediaDevices.getUserMedia(constraints), CAMERA, () => cancelled);
            if (!media) return;
            // Only now can the cleanup see it, so a close from here on turns this stream off.
            stream = media;
            element.srcObject = media;
            await element.play();
            findTorch(stream);
            setMessage("Hold the barcode steady inside the frame. It scans automatically.");
            let busy = false;
            const tick = async () => {
              if (cancelled) return;
              if (!busy && element.readyState >= 2) {
                busy = true;
                try {
                  for (const code of await detector.detect(element)) accept(code.rawValue, code.format);
                } catch {
                  // A frame the detector could not read; keep going.
                } finally {
                  busy = false;
                }
              }
              frame = window.setTimeout(() => { void tick(); }, 180);
            };
            void tick();
            return;
          }
          const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
          if (cancelled) return;
          const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]]);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 300 });
          const started = await reader.decodeFromConstraints(CAMERA, element, (result) => {
            if (!cancelled && result) accept(result.getText(), BarcodeFormat[result.getBarcodeFormat()]);
          });
          if (cancelled) { started.stop(); return; }
          controls = started;
          findTorch(element.srcObject instanceof MediaStream ? element.srcObject : null);
          setMessage("Hold the barcode steady inside the frame. It scans automatically.");
        } catch (error) {
          // The camera may already be on (the preview would not play): turn it off before saying what went wrong.
          stopCamera(stream);
          stream = null;
          if (element.srcObject instanceof MediaStream) stopCamera(element.srcObject);
          element.srcObject = null;
          if (!cancelled) setMessage(cameraProblem(error));
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearTimeout(frame);
      controls?.stop();
      stopCamera(stream);
      track.current = null;
      element.srcObject = null;
    };
  }, [onDetected, open]);

  async function toggleTorch() {
    const videoTrack = track.current;
    if (!videoTrack) return;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch((current) => ({ ...current, on: !current.on }));
    } catch {
      setTorch({ available: false, on: false });
    }
  }

  async function readPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("Reading the photo…");
    try {
      let raw: string | null = null;
      let format: string | undefined;
      const detector = await nativeDetector();
      if (detector) {
        const bitmap = await createImageBitmap(file);
        const found = (await detector.detect(bitmap))[0];
        raw = found?.rawValue ?? null;
        format = found?.format;
        bitmap.close();
      } else {
        const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        const hints = new Map<HintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]], [DecodeHintType.TRY_HARDER, true]]);
        const url = URL.createObjectURL(file);
        try {
          const result = await new BrowserMultiFormatReader(hints).decodeFromImageUrl(url);
          raw = result.getText();
          format = BarcodeFormat[result.getBarcodeFormat()];
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const checked = checkBarcode(raw, format);
      if (!checked.ok) { setMessage("No product barcode was found in that photo. Fill the frame with the barcode and keep it sharp, or type the number above."); return; }
      setOpen(false);
      onDetected(checked.code);
    } catch {
      setMessage("No product barcode was found in that photo. Fill the frame with the barcode and keep it sharp, or type the number above.");
    }
  }

  return <>
    <button type="button" onClick={() => { setMessage("Starting the camera…"); setOpen(true); }} className="fitx-button fitx-button-secondary mt-2 w-full"><Camera size={15}/>Scan with camera</button>
    {open && <div className="fixed inset-0 z-[60] grid place-items-center bg-fitx-scrim/80 p-4" role="dialog" aria-modal="true" aria-labelledby="barcode-title">
      <section className="w-full max-w-md overflow-hidden rounded-2xl border border-fitx-border bg-fitx-elevated text-fitx-text shadow-2xl">
        <div className="flex items-center justify-between border-b border-fitx-divider px-4 py-3">
          <h2 id="barcode-title" className="flex items-center gap-2 text-sm font-medium"><Barcode size={17} className="text-fitx-primary"/>Scan a product</h2>
          <button onClick={() => setOpen(false)} aria-label="Close barcode scanner" className="grid h-11 w-11 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-hover"><X size={17}/></button>
        </div>
        <div className="p-4">
          <div className="relative overflow-hidden rounded-xl bg-fitx-scrim">
            <video ref={video} autoPlay muted playsInline className="aspect-video w-full object-cover"/>
            {/* Where to hold the barcode. Reading uses the whole picture, so the frame is only a guide. */}
            <div className={styles.frame} aria-hidden="true">
              <div className={styles.window}>
                <span className={`${styles.corner} ${styles.tl}`}/><span className={`${styles.corner} ${styles.tr}`}/>
                <span className={`${styles.corner} ${styles.bl}`}/><span className={`${styles.corner} ${styles.br}`}/>
              </div>
              <span className={styles.line}/>
            </div>
            {torch.available && <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} className="absolute right-2 top-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-fitx-elevated px-3 text-xs font-medium text-fitx-text">
              <Flashlight size={15}/>{torch.on ? "Torch off" : "Torch on"}
            </button>}
          </div>
          <p role="status" className="mt-3 text-sm text-fitx-text-secondary">{message}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => photo.current?.click()} className="fitx-button fitx-button-secondary min-h-10 px-3 text-xs"><ImageUp size={14}/>Take or choose a photo</button>
            {/* No capture attribute: phones then offer the camera and the photo library (a screenshot of a barcode works too). */}
            <input ref={photo} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void readPhoto(event)}/>
          </div>
          <p className="mt-3 text-xs text-fitx-text-disabled">The camera is used only to read the barcode, on this device. Product barcodes only (EAN and UPC).</p>
        </div>
      </section>
    </div>}
  </>;
}
