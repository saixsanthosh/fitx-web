"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * A modal sheet: bottom sheet on phones, centred dialog from `sm`. Traps focus, closes on Escape or
 * a tap on the backdrop, and returns focus to whatever opened it.
 */
export function Sheet({ title, description, onClose, children, footer, size = "md" }: { title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-fitx-scrim/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl border border-fitx-border bg-fitx-elevated shadow-2xl sm:max-h-[88dvh] sm:rounded-xl ${size === "lg" ? "max-w-3xl" : "max-w-lg"}`}>
        <div className="flex items-start justify-between gap-3 border-b border-fitx-divider p-4 sm:p-5">
          <div className="min-w-0"><h2 id={titleId} className="text-lg font-semibold">{title}</h2>{description && <p className="mt-1 text-sm text-fitx-text-secondary">{description}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-fitx-border text-fitx-text-secondary hover:text-fitx-text"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer && <div className="flex flex-col-reverse justify-end gap-2 border-t border-fitx-divider p-4 sm:flex-row sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}
