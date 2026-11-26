import type { ReactNode } from "react";

/**
 * A quiet box for a list or page with nothing in it. `headingLevel` (default 3) is 2 when the box sits right under a
 * page's own h1 (PageHeader), so the page's headings run 1, 2 without a gap. `headingId` names the heading, for a
 * screen that moves focus to it once an action has replaced the page (D5).
 */
export function EmptyState({ title, description, action, headingLevel = 3, headingId }: { title: string; description: string; action?: ReactNode; headingLevel?: 2 | 3; headingId?: string }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="rounded-xl border border-dashed border-fitx-border bg-fitx-surface/50 px-5 py-8 text-center">
      <Heading id={headingId} className="text-sm font-medium text-fitx-text">{title}</Heading>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-fitx-text-secondary">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
