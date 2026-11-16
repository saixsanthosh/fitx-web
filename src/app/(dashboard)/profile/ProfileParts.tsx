"use client";

import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { NutritionTargets } from "@/lib/domain/nutrition";

/** A Profile section: a summary of saved values, or its edit form. */
export function SectionCard({
  id,
  title,
  description,
  icon,
  editing,
  onEdit,
  canEdit,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  editing: boolean;
  onEdit: () => void;
  canEdit: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="fitx-panel scroll-mt-24 p-4 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-fitx-primary/10 text-fitx-primary">{icon}</span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-base font-semibold text-fitx-text">{title}</h2>
            <p className="mt-0.5 text-sm leading-6 text-fitx-text-secondary">{description}</p>
          </div>
        </div>
        {!editing && canEdit && (
          <button type="button" onClick={onEdit} className="fitx-button fitx-button-secondary min-h-11 shrink-0 px-3.5 text-sm" aria-label={`Edit ${title.toLowerCase()}`}>
            <Pencil size={15} aria-hidden="true" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{children}</dl>;
}

export function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium text-fitx-text-secondary">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-fitx-text">{children}</dd>
    </div>
  );
}

/** Read-only chips for a saved list, or a quiet "None". */
export function ChipList({ items, empty = "None" }: { items: readonly string[]; empty?: string }) {
  if (!items.length) return <span className="font-normal text-fitx-text-secondary">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => <span key={item} className="rounded-full border border-fitx-border bg-fitx-surface-variant px-2.5 py-1 text-xs font-medium text-fitx-text">{item}</span>)}
    </span>
  );
}

export function NotSet() {
  return <span className="font-normal text-fitx-text-secondary">Not set</span>;
}

/** Save and Cancel for a section's edit form. */
export function EditActions({ saving, onCancel, error }: { saving: boolean; onCancel: () => void; error: string }) {
  return (
    <div className="mt-6 border-t border-fitx-divider pt-5">
      {error && <p role="alert" className="fitx-alert fitx-alert-danger mb-4">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={saving} className="fitx-button fitx-button-secondary">Cancel</button>
        <button type="submit" disabled={saving} className="fitx-button">{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}

/** One sentence on how the calorie target was set. */
export function targetReason(targets: NutritionTargets) {
  if (targets.youthMaintenance) return "Under 18, FITX keeps you at maintenance rather than setting a calorie deficit.";
  if (targets.floorApplied) return `Kept at a safe minimum of ${targets.floorApplied.toLocaleString("en-IN")} kcal a day.`;
  if (targets.rule === "deficit") return `About ${Math.abs(targets.adjustment).toLocaleString("en-IN")} kcal under maintenance, roughly ${Math.abs(targets.weeklyChangeKg).toFixed(1)} kg a week.`;
  if (targets.rule === "surplus") return `About ${targets.adjustment.toLocaleString("en-IN")} kcal over maintenance, roughly ${targets.weeklyChangeKg.toFixed(1)} kg a week.`;
  return "Set at maintenance, to keep your weight steady.";
}
