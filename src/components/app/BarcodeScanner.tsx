"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import type { DecodeHintType as HintType } from "@zxing/library";
import { Flashlight, FlashlightOff, ImageUp, Keyboard, X } from "lucide-react";
import { checkBarcode } from "@/lib/food/barcode";
import { openCamera, stopCamera } from "@/lib/food/camera";
import {
  cameraProblem, cameraTuning, createReadConsensus, focusConstraints, focusPoint, pickRearCamera, readStateText, RETAIL_FORMATS, scanRegion,
  scannerConstraints, snapZoom, type ReadState, type ZoomRange,
} from "@/lib/food/scanner";
import styles from "./BarcodeScanner.module.css";

/** The parts of the Barcode Detection API FITX uses (Chrome on Android has it; Safari on iPhone does not). */
interface NativeDetector {
  detect(source: CanvasImageSource | ImageBitmap): Promise<Array<{ rawValue: string; format: string }>>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}
/** One way of reading a frame: the browser's own detector, or ZXing. Returns the raw code and its format, or null. */
type FrameReader = (canvas: HTMLCanvasElement) => Promise<{ raw: string; format: string } | null>;

/** The main rear camera found on an earlier scan in this visit, so the next scan opens it straight away. */
let rememberedCamera: string | null = null;

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

async function zxingReader(tryHarder: boolean) {
  const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map<HintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]]);
  if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true);
  return { reader: new BrowserMultiFormatReader(hints), BarcodeFormat };
}

/** A frame reader: the native detector where there is one (Android Chrome), ZXing otherwise (iPhone Safari). */
async function frameReader(): Promise<FrameReader> {
  const detector = await nativeDetector();
  if (detector) {
    return async (canvas) => {
      const found = (await detector.detect(canvas))[0];
      return found ? { raw: found.rawValue, format: found.format } : null;
    };
  }
  const { reader, BarcodeFormat } = await zxingReader(false);
  return async (canvas) => {
    try {
      const result = reader.decodeFromCanvas(canvas);
      return { raw: result.getText(), format: BarcodeFormat[result.getBarcodeFormat()] };
    } catch {
      return null; // no barcode in this frame
    }
  };
}

type Phase = "starting" | "live" | "failed";

/**
 * Full-screen barcode scanner (EAN-13, EAN-8, UPC-A, UPC-E). It asks for the main rear camera at high resolution,
 * turns on continuous autofocus and starts slightly zoomed where the camera allows, so the barcode can be held where
 * the lens focuses. Only the band inside the frame is read, a code counts after two matching reads, and the frame
 * turns steady then confirmed as it reads. Tap the picture to focus there; zoom and torch appear when the camera
 * has them. A photo and typing the number are always there as other ways. The camera is off whenever the scanner
 * is closed, also while it is still starting.
 */
export function BarcodeScanner({ open, onClose, onDetected, onManual }: {
  open: boolean;
  onClose: () => void;
  onDetected: (value: string) => void;
  /** "Type the number": closes the scanner and puts the member in the barcode field. */
  onManual: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const cancel = (event: Event) => { event.preventDefault(); onCloseRef.current(); };
    element.addEventListener("cancel", cancel);
    return () => element.removeEventListener("cancel", cancel);
  }, []);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="barcode-title">
      {open && <ScannerBody onClose={onClose} onDetected={onDetected} onManual={onManual}/>}
    </dialog>
  );
}

function ScannerBody({ onClose, onDetected, onManual }: { onClose: () => void; onDetected: (value: string) => void; onManual: () => void }) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [problem, setProblem] = useState("");
  const [readState, setReadState] = useState<ReadState>("searching");
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [zoom, setZoom] = useState<{ range: ZoomRange; value: number } | null>(null);
  const [focusAt, setFocusAt] = useState<{ x: number; y: number; key: number } | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const focusModes = useRef<string[]>([]);
  const tapToFocus = useRef(false);
  const photo = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onDetectedRef.current = onDetected; onCloseRef.current = onClose; }, [onDetected, onClose]);

  /** A confirmed code: a short buzz where phones allow it, a moment of green, then the lookup. */
  const finish = useCallback((code: string) => {
    if (done.current) return;
    done.current = true;
    setReadState("confirmed");
    try { navigator.vibrate?.(35); } catch { /* not supported */ }
    window.setTimeout(() => { onDetectedRef.current(code); onCloseRef.current(); }, 260);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const reads = createReadConsensus(2, 1500);

    const start = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("insecure"), { name: "SecurityError" });
      const read = await frameReader();
      if (cancelled) return;
      const getUserMedia = (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints);
      let media = await openCamera(getUserMedia, scannerConstraints(rememberedCamera), () => cancelled).catch((error: unknown) => {
        // A remembered camera that has gone (another phone, a removed webcam): ask by facing instead.
        if (rememberedCamera && error instanceof Error && error.name === "OverconstrainedError") { rememberedCamera = null; return openCamera(getUserMedia, scannerConstraints(), () => cancelled); }
        throw error;
      });
      if (!media) return;
      stream = media;
      // Labels are readable now: if the browser opened a side lens, switch to the main rear camera once.
      if (!rememberedCamera) {
        const main = pickRearCamera(await navigator.mediaDevices.enumerateDevices().catch(() => []));
        const current = media.getVideoTracks()[0]?.getSettings?.().deviceId;
        if (main) rememberedCamera = main;
        if (main && current && main !== current && !cancelled) {
          stopCamera(media);
          stream = null;
          media = await openCamera(getUserMedia, scannerConstraints(main), () => cancelled);
          if (!media) return;
          stream = media;
        }
      }
      if (cancelled) { stopCamera(stream); return; }
      element.srcObject = media;
      await element.play();
      const videoTrack = media.getVideoTracks()[0] ?? null;
      track.current = videoTrack;
      const capabilities = (videoTrack?.getCapabilities?.() ?? {}) as Parameters<typeof cameraTuning>[0];
      const tuning = cameraTuning(capabilities, (navigator.mediaDevices.getSupportedConstraints?.() ?? {}) as Record<string, boolean>);
      focusModes.current = [...(capabilities?.focusMode ?? [])];
      tapToFocus.current = tuning.tapToFocus;
      if (videoTrack && tuning.apply.length) await videoTrack.applyConstraints({ advanced: tuning.apply }).catch(() => undefined);
      setTorch({ available: tuning.torch, on: false });
      setZoom(tuning.zoom ? { range: tuning.zoom, value: tuning.startZoom ?? tuning.zoom.min } : null);
      setPhase("live");

      let busy = false;
      const tick = async () => {
        if (cancelled || done.current) return;
        if (!busy && !document.hidden && element.readyState >= 2 && context) {
          busy = true;
          try {
            const view = stage.current?.getBoundingClientRect();
            const frame = { width: element.videoWidth, height: element.videoHeight };
            const region = view ? scanRegion(frame, { width: view.width, height: view.height }) : null;
            const area = region ?? { x: 0, y: 0, ...frame };
            // At most 1280 px wide: enough for the bars, and quick to read.
            const scale = Math.min(1, 1280 / Math.max(1, area.width));
            canvas.width = Math.max(1, Math.round(area.width * scale));
            canvas.height = Math.max(1, Math.round(area.height * scale));
            context.drawImage(element, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
            const found = await read(canvas);
            const now = performance.now();
            const checked = found ? checkBarcode(found.raw, found.format) : null;
            if (checked?.ok) {
              const result = reads.push(checked.code, now);
              if (result.state === "confirmed") finish(result.code);
              else setReadState("steady");
            } else {
              setReadState(reads.state(now));
            }
          } catch {
            // A frame that could not be read; keep going.
          } finally {
            busy = false;
          }
        }
        timer = window.setTimeout(() => { void tick(); }, 120);
      };
      void tick();
    };

    void start().catch((error: unknown) => {
      // The camera may already be on (the preview would not play): turn it off before saying what went wrong.
      stopCamera(stream);
      stream = null;
      element.srcObject = null;
      if (cancelled) return;
      setProblem(cameraProblem(error instanceof Error ? error.name : ""));
      setPhase("failed");
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopCamera(stream);
      track.current = null;
      element.srcObject = null;
    };
  }, [finish]);

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

  async function changeZoom(value: number) {
    if (!zoom) return;
    const next = snapZoom(value, zoom.range);
    setZoom({ ...zoom, value: next });
    await track.current?.applyConstraints({ advanced: [{ zoom: next } as MediaTrackConstraintSet] }).catch(() => undefined);
  }

  /** Tap to focus: the point on the camera frame under the finger, through the preview's crop. */
  function tapFocus(event: PointerEvent<HTMLDivElement>) {
    const element = video.current;
    const box = stage.current?.getBoundingClientRect();
    if (!element || !box || !tapToFocus.current || !track.current) return;
    const point = focusPoint({ x: event.clientX, y: event.clientY }, box, { width: element.videoWidth, height: element.videoHeight });
    if (!point) return;
    setFocusAt({ x: event.clientX - box.left, y: event.clientY - box.top, key: Date.now() });
    void track.current.applyConstraints({ advanced: [focusConstraints(point, focusModes.current)] }).catch(() => undefined);
  }

  async function readPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoNote("Reading the photo…");
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
        const { reader, BarcodeFormat } = await zxingReader(true);
        const url = URL.createObjectURL(file);
        try {
          const result = await reader.decodeFromImageUrl(url);
          raw = result.getText();
          format = BarcodeFormat[result.getBarcodeFormat()];
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const checked = checkBarcode(raw, format);
      if (!checked.ok) { setPhotoNote("No barcode found in that photo. Fill the picture with it, or type the number."); return; }
      finish(checked.code);
    } catch {
      setPhotoNote("No barcode found in that photo. Fill the picture with it, or type the number.");
    }
  }

  const status = phase === "failed" ? problem : phase === "starting" ? "Starting the camera…" : photoNote || readStateText(readState);
  return (
    <div className={styles.body}>
      <header className={styles.top}>
        <h2 id="barcode-title" className={styles.title}>Scan barcode</h2>
        <button type="button" onClick={onClose} aria-label="Close barcode scanner" className={styles.round}><X size={20} aria-hidden="true"/></button>
      </header>
      <div ref={stage} className={styles.stage} data-state={readState} onPointerDown={tapFocus}>
        <video ref={video} autoPlay muted playsInline className={styles.video} aria-label="Camera preview"/>
        <div className={styles.mask} aria-hidden="true">
          <div className={styles.window}>
            <span className={`${styles.corner} ${styles.tl}`}/><span className={`${styles.corner} ${styles.tr}`}/>
            <span className={`${styles.corner} ${styles.bl}`}/><span className={`${styles.corner} ${styles.br}`}/>
            {phase === "live" && readState === "searching" && <span className={styles.sweep}><span/></span>}
          </div>
        </div>
        {focusAt && <span key={focusAt.key} className={styles.focus} style={{ left: focusAt.x, top: focusAt.y }} aria-hidden="true"/>}
      </div>
      <div className={styles.panel}>
        <p role="status" aria-live="polite" className={styles.status} data-state={phase === "failed" ? "failed" : readState}>{status}</p>
        {zoom && <label className={styles.zoom}>
          <span>Zoom</span>
          <input type="range" min={zoom.range.min} max={Math.min(zoom.range.max, 5)} step={zoom.range.step} value={zoom.value}
            onChange={(event) => void changeZoom(Number(event.target.value))} aria-valuetext={`${zoom.value} times`}/>
          <output>{zoom.value.toFixed(1)}×</output>
        </label>}
        <div className={styles.actions}>
          {torch.available && <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch.on} className={styles.action}>
            {torch.on ? <FlashlightOff size={18} aria-hidden="true"/> : <Flashlight size={18} aria-hidden="true"/>}{torch.on ? "Torch off" : "Torch"}
          </button>}
          <button type="button" onClick={() => photo.current?.click()} className={styles.action}><ImageUp size={18} aria-hidden="true"/>Photo</button>
          <button type="button" onClick={onManual} className={styles.action}><Keyboard size={18} aria-hidden="true"/>Type the number</button>
          {/* No capture attribute: phones then offer the camera and the photo library (a screenshot of a barcode works too). */}
          <input ref={photo} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void readPhoto(event)}/>
        </div>
        <p className={styles.note}>Read on this device only. Product barcodes (EAN and UPC).</p>
      </div>
    </div>
  );
}
