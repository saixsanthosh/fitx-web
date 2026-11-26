"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { backdropTaps } from "./sheet-backdrop";
import { returnFocusTarget, revealBy } from "./sheet-focus";
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
  /**
   * A message about what the member just did in this sheet (an error, a confirmation), shown between the content and
   * the actions, in a live region inside the dialog: a toast raised while a modal is open is drawn under it and is
   * neither seen nor heard (D6). Pass it, even as null, to have the region ready; leave it out and nothing is drawn.
   */
  notice?: SheetNotice | null;
};

/** What `notice` takes: a new `id` makes the same words, said again, be announced again. */
export type SheetNotice = { id?: number; tone: "error" | "success" | "info"; text: string };

/**
 * A modal sheet on the native <dialog>: focus moves in and stays in, the page behind is inert, Escape
 * and a tap on the backdrop close it, and focus returns to whatever opened it (or to `returnFocus`).
 * The content mounts only while open.
 */
export function Sheet({ open, onClose, title, description, children, footer, side = "auto", className = "", returnFocus, notice }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Where the press now ending began: only a tap on the backdrop closes the sheet, not a drag that ends there.
  const [taps] = useState(backdropTaps);
  const named = useRef(returnFocus);
  useEffect(() => { named.current = returnFocus; });
  const titleId = `${useId()}-sheet-title`;
  const content = useRef<HTMLDivElement>(null);
  const noticeKey = notice ? `${notice.tone}:${notice.id ?? ""}:${notice.text}` : null;

  // A notice takes its room from the content, from below, and the content does not scroll by itself: the control the
  // member just used, often at the end of the content, stays in full view, with its focus ring (reg-explore-1). Only
  // sheets that pass `notice` ever get here.
  useLayoutEffect(() => {
    const box = content.current;
    const focused = document.activeElement;
    if (!noticeKey || !box || !(focused instanceof HTMLElement) || !box.contains(focused)) return;
    const by = revealBy(box.getBoundingClientRect(), focused.getBoundingClientRect());
    if (by) box.scrollTop += by;
  }, [noticeKey]);

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
      // In the capture phase, so every press inside the sheet is seen, also one a control stops from bubbling.
      onPointerDownCapture={(event) => taps.press(event.target === event.currentTarget)}
      onClick={(event) => { if (taps.click(event.target === event.currentTarget)) onClose(); }}
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
          <div ref={content} className={styles.content}>{children}</div>
          {notice !== undefined && (
            <div className={styles.notices}>
              {/* Confirmations go to a polite region that is always there; errors are a new alert each time. */}
              <p role="status" className={notice && notice.tone !== "error" ? `${styles.notice} ${notice.tone === "success" ? styles.noticeOk : styles.noticeInfo}` : styles.noticeIdle}>
                {notice && notice.tone !== "error" ? notice.text : null}
              </p>
              {notice?.tone === "error" && <p key={notice.id ?? notice.text} role="alert" className={`${styles.notice} ${styles.noticeError}`}>{notice.text}</p>}
            </div>
          )}
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
