import Link from "next/link";
import { ArrowLeft, CircleAlert, CircleCheck } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { ModuleState } from "@/components/module-state";
import styles from "./content.module.css";

/** Page title block: an eyebrow with the section number, a large title, one meta line and actions. */
export function ContentHeader({ eyebrow, title, meta, actions, back }: { eyebrow: string; title: string; meta?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className={styles.header}>
      {back && (
        <Link className={styles.back} href={back.href}>
          <ArrowLeft aria-hidden="true" size={16} />
          {back.label}
        </Link>
      )}
      <div className={styles.headerTop}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {meta && <p className={styles.meta}>{meta}</p>}
    </header>
  );
}

export type TabItem = { href: string; label: string; count?: number | null; current: boolean };

export function ContentTabs({ label, items }: { label: string; items: TabItem[] }) {
  return (
    <nav aria-label={label} className={styles.tabs}>
      {items.map((item) => (
        <Link key={item.href} className={styles.tab} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.label}
          {typeof item.count === "number" && <b>{item.count.toLocaleString("en-IN")}</b>}
        </Link>
      ))}
    </nav>
  );
}

/** A result line from a Server Action redirect (?state=…), or nothing for an unknown state. */
export function StateNotice({ state, messages }: { state: string; messages: Record<string, { text: string; good: boolean }> }) {
  if (!state || !Object.hasOwn(messages, state)) return null;
  const { text, good } = messages[state];
  return <Notice good={good}>{text}</Notice>;
}

export function Notice({ good, children }: { good: boolean; children: React.ReactNode }) {
  return (
    <p className={`${styles.notice} ${good ? styles.noticeGood : styles.noticeBad}`} role={good ? "status" : "alert"}>
      {good ? <CircleCheck aria-hidden="true" size={17} /> : <CircleAlert aria-hidden="true" size={17} />}
      <span>{children}</span>
    </p>
  );
}

/** A number tile. null shows an en dash ("Not known"), never 0. */
export function Stat({ label, value, unit, hint, estimate, display }: { label: string; value: number | null; unit?: string; hint?: string; estimate?: boolean; display?: string }) {
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>
        {label}
        {estimate && <span className={styles.estimate}>Estimate</span>}
      </p>
      <div>
        <p className={styles.statValue}>
          {display !== undefined && value !== null ? display : <CountUp value={value} />}
          {unit && value !== null && <span className={styles.statUnit}>{unit}</span>}
        </p>
        {hint && <p className={styles.statHint}>{hint}</p>}
      </div>
    </div>
  );
}

export function Stats({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className={styles.stats}>
      {children}
    </section>
  );
}

export function Section({ title, note, action, children, id }: { title: string; note?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={styles.section} aria-labelledby={headingId} id={id}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle} id={headingId}>{title}</h2>
        {note && <p className={styles.sectionNote}>{note}</p>}
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Pill({ tone = "neutral", plain, children }: { tone?: "neutral" | "good" | "bad" | "accent"; plain?: boolean; children: React.ReactNode }) {
  const toneClass = tone === "good" ? styles.pillGood : tone === "bad" ? styles.pillBad : tone === "accent" ? styles.pillAccent : "";
  return <span className={`${styles.pill} ${toneClass} ${plain ? styles.pillPlain : ""}`}>{children}</span>;
}

export function Pager({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={styles.listFoot}>
      <span>
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </span>
      {pages > 1 && (
        <nav aria-label="Pages" className={styles.pager}>
          {page > 1 && <Link className={`${styles.buttonQuiet} ${styles.small}`} href={href(page - 1)}>Previous</Link>}
          {page < pages && <Link className={`${styles.buttonQuiet} ${styles.small}`} href={href(page + 1)}>Next</Link>}
        </nav>
      )}
    </div>
  );
}

/** The data states every content screen can be in, with the migration that is missing when it is one of ours. */
export function DataState({ state, migration }: { state: "service_key_missing" | "migration_pending" | "query_failed"; migration?: string }) {
  return <ModuleState state={state} migration={migration} />;
}

/** "1,234" or an en dash for an unknown value. */
export function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN") : "–";
}

export { styles as contentStyles };
