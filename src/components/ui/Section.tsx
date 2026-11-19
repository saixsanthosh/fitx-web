import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = {
  /** One to three words (an h2). Leave it out for an untitled block with the same spacing. */
  title?: ReactNode;
  /** A link or button on the title's right. */
  action?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
};

/** A page section: an h2 and its content, with the standard rhythm between sections and inside them. */
export function Section({ title, action, id, className, children }: SectionProps) {
  const fallback = useId();
  const headingId = `${id ?? fallback}-title`;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={cn("mt-[var(--fitx-space-block)] flex flex-col gap-4 first:mt-0", className)}>
      {(title || action) && (
        <div className="flex min-h-11 items-center justify-between gap-3">
          {title && <h2 id={headingId} className="font-heading text-lg font-semibold tracking-[-.02em] text-fitx-text">{title}</h2>}
          {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
