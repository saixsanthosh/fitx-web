import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-fitx-border bg-fitx-surface/50 px-5 py-8 text-center">
      <h3 className="text-sm font-medium text-fitx-text">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-fitx-text-secondary">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
