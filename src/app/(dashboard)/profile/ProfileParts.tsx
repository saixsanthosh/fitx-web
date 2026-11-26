"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { m } from "framer-motion";
import { Check, Info, Pencil } from "lucide-react";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { listAnswer } from "./profile-answers";

/** The edit form's first field. In a radio group that is the chosen option, where Tab would land too. */
function firstField(section: HTMLElement | null): HTMLElement | null {
  const first = section?.querySelector<HTMLElement>("form input:not([disabled]), form select:not([disabled]), form textarea:not([disabled]), form button:not([disabled])") ?? null;
  if (first instanceof HTMLInputElement && first.type === "radio" && first.name) {
    const chosen = first.form?.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(first.name)}"]:checked:not([disabled])`);
    if (chosen) return chosen;
  }
  return first;
}

/** What a save left to say: "Saved" with a tick, or a note (something waits for an update). */
export type SectionNotice = { tone: "saved" | "note"; text: string };

/**
 * A Profile section, edited in place: its saved values, or its form. The header keeps a live saving status
 * ("Saved", or a note when part of it waits for an update), so the result is shown where the change was made.
 */
export function SectionCard({
  id,
  title,
  icon,
  editing,
  onEdit,
  canEdit,
  notice,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  editing: boolean;
  onEdit: () => void;
  canEdit: boolean;
  notice?: SectionNotice | null;
  children: ReactNode;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  const reduced = useReducedMotionSafe();
  // Keyboard and screen-reader users keep their place: into the form when it opens, back to Edit when it closes.
  useEffect(() => {
    if (editing && !wasEditing.current) {
      firstField(sectionRef.current)?.focus();
    } else if (!editing && wasEditing.current) {
      editButton.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);
  return (
    <section
      ref={sectionRef}
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-28 rounded-2xl border bg-fitx-surface transition-colors motion-reduce:transition-none ${editing ? "border-fitx-primary/45" : "border-fitx-border"}`}
    >
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 pt-3 sm:px-6 sm:pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fitx-surface-variant text-fitx-text">{icon}</span>
          <h2 id={`${id}-title`} className="font-heading text-lg font-semibold tracking-[-.02em] text-fitx-text">{title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!editing && canEdit && (
            <button ref={editButton} type="button" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-fitx-primary-text transition-colors hover:bg-fitx-primary/10 motion-reduce:transition-none">
              <Pencil size={14} aria-hidden="true" />Edit
            </button>
          )}
        </div>
      </div>
      <p role="status" aria-live="polite" className={`mx-4 flex items-start gap-1.5 text-xs font-medium leading-5 sm:mx-6 ${notice && !editing ? "mt-1" : "sr-only"} ${notice?.tone === "saved" ? "text-fitx-success" : "text-fitx-text-secondary"}`}>
        {notice && !editing && (notice.tone === "saved" ? <Check size={14} strokeWidth={2.5} aria-hidden="true" className="mt-0.5 shrink-0" /> : <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />)}
        {notice && !editing ? notice.text : ""}
      </p>
      <m.div
        key={editing ? "edit" : "view"}
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.base, ease: EASE.out }}
        className="px-4 pb-5 pt-3 sm:px-6 sm:pb-6"
      >
        {children}
      </m.div>
    </section>
  );
}

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:gap-x-8">{children}</dl>;
}

export function Detail({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-xs text-fitx-text-secondary">{label}</dt>
      <dd className="mt-1 text-[15px] font-medium text-fitx-text">{children}</dd>
    </div>
  );
}

/**
 * Read-only chips for a saved list. An empty list reads a quiet "None" (or `empty`) only when `known`, that is once
 * the member has been asked; before that it reads "Not set" (profile-answers.ts listAnswer).
 */
export function ChipList({ items, empty = "None", known = true }: { items: readonly string[]; empty?: string; known?: boolean }) {
  const answer = listAnswer(items, known);
  if (answer.kind === "not_set") return <NotSet />;
  if (answer.kind === "none") return <span className="font-normal text-fitx-text-secondary">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {answer.items.map((item) => <span key={item} className="rounded-full border border-fitx-border bg-fitx-surface-variant px-2.5 py-1 text-xs font-medium text-fitx-text">{item}</span>)}
    </span>
  );
}

export function NotSet() {
  return <span className="font-normal text-fitx-text-secondary">Not set</span>;
}

/**
 * Save and Cancel for a section's edit form. While it saves, both stay focusable (aria-disabled, not disabled: a
 * disabled button drops keyboard focus to the page in Chrome, D5), so a failed save's message is read with focus still
 * on Save. Cancel does nothing meanwhile, and the section's save() returns at once while `saving`, so a second press of
 * Save, or Enter in a field, saves nothing twice.
 */
export function EditActions({ saving, onCancel, error }: { saving: boolean; onCancel: () => void; error: string }) {
  return (
    <div className="mt-6 border-t border-fitx-divider pt-5">
      {error && <p role="alert" className="fitx-alert fitx-alert-danger mb-4">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => { if (!saving) onCancel(); }} aria-disabled={saving || undefined} className="fitx-button fitx-button-secondary aria-disabled:opacity-60">Cancel</button>
        <button type="submit" aria-disabled={saving || undefined} aria-busy={saving} className="fitx-button min-w-32 aria-disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
