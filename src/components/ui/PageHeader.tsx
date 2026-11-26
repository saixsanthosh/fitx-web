import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  /** One to three words. The page's only h1. */
  title: ReactNode;
  /** One optional short label above the title. */
  eyebrow?: ReactNode;
  /** Buttons on the right; they move under the title on phones. */
  actions?: ReactNode;
  /** One short line under the title (a date, a count). Not a paragraph. */
  meta?: ReactNode;
  className?: string;
  /** The h1's id, for a screen that moves focus to its title once an action has replaced the page (D5). */
  titleId?: string;
};

/** The top of every app page: title, optional eyebrow and meta line, actions. */
export function PageHeader({ title, eyebrow, actions, meta, className, titleId }: PageHeaderProps) {
  return (
    <header className={cn("mb-7 flex flex-col gap-4 sm:mb-9 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-primary-text">{eyebrow}</p>}
        <h1 id={titleId} className="font-heading text-[28px] font-bold leading-[1.08] tracking-[-.035em] text-fitx-text sm:text-[34px]">{title}</h1>
        {meta && <p className="mt-2 max-w-2xl text-sm leading-6 text-fitx-text-secondary">{meta}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
