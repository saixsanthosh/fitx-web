"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { returnFocusTarget } from "./sheet-focus";
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
  /**
   * The control focus returns to when the sheet closes, when that is not simply the element that had focus as it
   * opened (for example a button that was busy, and so lost focus, while the sheet got ready). Optional.
   */
  returnFocus?: RefObject<HTMLElement | null>;
};

/**
 * A modal sheet on the native <dialog>: focus moves in and stays in, the page behind is inert, Escape
 * and a tap on the backdrop close it, and focus returns to whatever opened it (or to `returnFocus`).
 * The content mounts only while open.
 */
export function Sheet({ open, onClose, title, description, children, footer, side = "auto", className = "", returnFocus }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const named = useRef(returnFocus);
  useEffect(() => { named.current = returnFocus; });
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
      returnFocusTarget(named.current?.current, opener.current, document.body)?.focus();
    }
  }, [open]);

  // Unmounting an open sheet behaves like close(): focus goes back to the opener.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
      returnFocusTarget(named.current?.current, opener.current, document.body)?.focus();
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
