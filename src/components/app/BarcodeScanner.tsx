"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Barcode, Camera, X } from "lucide-react";

export function BarcodeScanner({ onDetected }: { onDetected: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("Center a product barcode in the camera view.");
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open || !video.current) return;
    let controls: IScannerControls | null = null;
    let cancelled = false;
    const messageTimer = window.setTimeout(() => setMessage(window.isSecureContext ? "Allow camera access to scan a barcode." : "Camera scanning requires a secure connection. Enter the barcode above instead."), 0);
    if (!window.isSecureContext) return;
    void (async () => {
      try {
        const [{ BrowserMultiFormatReader, BarcodeFormat }, { ChecksumException, DecodeHintType, FormatException, NotFoundException }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
        // Product barcodes only (EAN and UPC, whose check digits ZXing verifies), so a QR code on the pack is not read as a product.
        const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]]]);
        const reader = new BrowserMultiFormatReader(hints);
        const started = await reader.decodeFromVideoDevice(undefined, video.current || undefined, (result, error) => {
          if (cancelled) return;
          if (result) {
            cancelled = true;
            controls?.stop();
            setOpen(false);
            onDetected(result.getText());
            return;
          }
          // These mean "no barcode in this frame yet"; anything else ends ZXing's scan loop.
          if (error && !(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
            setMessage("The camera stopped scanning. Close this and try again, or type the barcode number above.");
          }
        });
        if (cancelled) started.stop();
        else {
          controls = started;
          setMessage("Hold the barcode steady inside the frame. It scans automatically.");
        }
      } catch {
        if (!cancelled) setMessage("Camera access is unavailable. Check browser permissions or enter the barcode above.");
      }
    })();
    return () => { cancelled = true; window.clearTimeout(messageTimer); controls?.stop(); };
  }, [onDetected, open]);

  return <>
    <button type="button" onClick={() => setOpen(true)} className="fitx-button fitx-button-secondary mt-2 w-full"><Camera size={15}/>Scan with camera</button>
    {open && <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="barcode-title"><section className="w-full max-w-md overflow-hidden rounded-2xl border border-fitx-border bg-fitx-card text-fitx-text shadow-2xl"><div className="flex items-center justify-between border-b border-fitx-divider px-4 py-3"><h2 id="barcode-title" className="flex items-center gap-2 text-sm font-medium"><Barcode size={17} className="text-fitx-primary"/>Scan a product</h2><button onClick={() => setOpen(false)} aria-label="Close barcode scanner" className="grid h-9 w-9 place-items-center rounded-lg text-fitx-text-secondary hover:bg-fitx-surface-variant"><X size={17}/></button></div><div className="p-4"><div className="overflow-hidden rounded-xl bg-black"><video ref={video} autoPlay muted playsInline className="aspect-video w-full object-cover"/></div><p role="status" className="mt-3 text-sm text-fitx-text-secondary">{message}</p><p className="mt-2 text-xs text-fitx-text-disabled">Camera permission is used only to read the barcode.</p></div></section></div>}
  </>;
}
