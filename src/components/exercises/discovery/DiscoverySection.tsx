import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A titled panel of the exercise library that the member can fold away ("What do you want to train?", "What do
 * you have?"). The summary line keeps the choice visible while it is folded.
 */
export function DiscoverySection({ id, title, summary, open, onToggle, actions, children }: {
  id: string;
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  const contentId = `${id}-content`;
  return (
    <section aria-labelledby={titleId} className="fitx-panel min-w-0 p-3.5 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={titleId} className="m-0 min-w-0 flex-1 text-lg font-semibold tracking-tight text-fitx-text">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <button type="button" aria-expanded={open} aria-controls={contentId} onClick={onToggle}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-fitx-text-secondary hover:text-fitx-text">
            {open ? "Hide" : "Show"}<span className="sr-only"> {title}</span>
            <ChevronDown size={16} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {summary && <p className="m-0 mt-1 text-sm leading-6 text-fitx-text-secondary">{summary}</p>}
      <div id={contentId} hidden={!open} className="mt-4">{children}</div>
    </section>
  );
}
