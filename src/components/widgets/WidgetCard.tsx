"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { ArrowRight, RotateCw } from "lucide-react";
import styles from "./Widgets.module.css";

/** The frame every Home widget shares: a titled card with an optional link in the corner. */
export function WidgetCard({ title, icon, href, hrefLabel, badge, children, className }: {
  title: string;
  icon: ReactNode;
  href?: string;
  hrefLabel?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={`${styles.card} ${className ?? ""}`} aria-labelledby={id}>
      <header className={styles.cardHeader}>
        <h2 id={id} className={styles.cardTitle}><span className={styles.cardIcon} aria-hidden="true">{icon}</span>{title}</h2>
        <div className={styles.cardCorner}>
          {badge}
          {href && <Link href={href} className={styles.cardLink} aria-label={hrefLabel ?? `Open ${title}`}><ArrowRight size={17} aria-hidden="true" /></Link>}
        </div>
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

/** Placeholder bars while a widget's data loads. */
export function WidgetSkeleton({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => <span key={index} />)}
    </div>
  );
}

/** A widget whose data failed: the reason and a retry, without touching the other widgets. */
export function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <p>{message}</p>
      <button type="button" className={styles.retry} onClick={onRetry}><RotateCw size={14} aria-hidden="true" />Try again</button>
    </div>
  );
}

/** A quiet note inside a widget, e.g. "Add your age in Profile to estimate a target". */
export function WidgetNote({ children, href, action }: { children: ReactNode; href?: string; action?: string }) {
  return (
    <p className={styles.note}>
      {children}
      {href && action && <> <Link href={href} className={styles.noteLink}>{action}</Link></>}
    </p>
  );
}
