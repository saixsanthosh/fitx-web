"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./Sheet.module.css";

/**
 * A modal sheet on the native <dialog> element: focus moves in and is trapped, Escape and the
 * backdrop close it, and the page behind is inert. A bottom sheet on phones, a centred panel on
 * larger screens (or a side panel with `side`).
 */
export function Sheet({ open, onClose, title, description, children, footer, side = false, labelledBy }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const fallbackId = useId();
  const titleId = labelledBy ?? `${fallbackId}-title`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cancel = (event: Event) => { event.preventDefault(); onClose(); };
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`${styles.sheet} ${side ? styles.side : ""}`}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {open && (
        <div className={styles.body}>
          <header className={styles.header}>
            <div className="min-w-0">
              <h2 id={titleId} className={styles.title}>{title}</h2>
              {description && <p className={styles.description}>{description}</p>}
            </div>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
          </header>
          <div className={styles.content}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
