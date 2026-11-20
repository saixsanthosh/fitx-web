import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** A Settings group: a short heading and its rows on one surface. */
export function SettingsGroup({ id, title, sectionId, children }: { id: string; title: string; sectionId?: string; children: ReactNode }) {
  return (
    <section id={sectionId} aria-labelledby={id} className="scroll-mt-24">
      <h2 id={id} className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">{title}</h2>
      <div className="divide-y divide-fitx-divider overflow-hidden rounded-2xl border border-fitx-border bg-fitx-surface px-4 sm:px-5">{children}</div>
    </section>
  );
}

/** A row that opens another page: icon, label, an optional short value, and a chevron. */
export function SettingsLink({ href, icon: Icon, label, value }: { href: string; icon: LucideIcon; label: string; value?: string }) {
  return (
    <Link href={href} className="group -mx-4 flex min-h-14 items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-fitx-hover motion-reduce:transition-none sm:-mx-5 sm:px-5">
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-fitx-surface-variant text-fitx-text"><Icon size={16} /></span>
      <span className="min-w-0 flex-1 font-medium text-fitx-text">{label}</span>
      {value && <span className="hidden truncate text-fitx-text-secondary sm:block">{value}</span>}
      <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-fitx-text-secondary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}

/** A row with a label on the left and a value or control on the right. */
export function SettingsRow({ label, children, hint }: { label: string; children?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-col justify-center gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="m-0 text-sm font-medium text-fitx-text">{label}</p>
        {hint && <p className="m-0 mt-0.5 text-xs leading-5 text-fitx-text-secondary">{hint}</p>}
      </div>
      {children && <div className="min-w-0 text-sm text-fitx-text-secondary sm:text-right">{children}</div>}
    </div>
  );
}
