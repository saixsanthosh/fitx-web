"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
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

  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Remember what opened the sheet, so focus can go back to it.
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open]);

  // Most sheets close by being removed. Close the dialog first, so it behaves like close() and focus
  // returns to the button that opened it instead of dropping to the top of the page.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
      const target = opener.current;
      if (target?.isConnected) target.focus();
    };
  }, []);

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
