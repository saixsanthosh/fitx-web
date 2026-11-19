"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./Sheet.module.css";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One short line under the title, only where it helps a decision. */
  description?: ReactNode;
  children: ReactNode;
  /** Sticky actions at the bottom. */
  footer?: ReactNode;
  /** Phones always get a bottom sheet. From 768 px: a side panel ("auto", default) or a centred dialog. */
  side?: "auto" | "center";
  className?: string;
};

/**
 * A modal sheet on the native <dialog>: focus moves in and stays in, the page behind is inert, Escape
 * and a tap on the backdrop close it, and focus returns to whatever opened it. The content mounts only
 * while open.
 */
export function Sheet({ open, onClose, title, description, children, footer, side = "auto", className = "" }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = `${useId()}-sheet-title`;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open]);

  // Unmounting an open sheet behaves like close(): focus goes back to the opener.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`${styles.sheet} ${side === "center" ? styles.center : styles.auto} ${className}`}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {open && (
        <div className={styles.body}>
          <span aria-hidden="true" className={styles.grip} />
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
