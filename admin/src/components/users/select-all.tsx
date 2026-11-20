"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A header checkbox that selects every row of one form, and a live "N selected" line beside the bulk
 * actions. Rows stay plain checkboxes, so the form also works before this script loads.
 */
export function SelectAll({ form, label = "Select all on this page" }: { form: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const owner = document.getElementById(form);
    const box = ref.current;
    if (!(owner instanceof HTMLFormElement) || !box) return;
    const rows = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=ids][form="${form}"]`));
    const sync = () => {
      const all = rows();
      const checked = all.filter((row) => row.checked).length;
      box.checked = all.length > 0 && checked === all.length;
      box.indeterminate = checked > 0 && checked < all.length;
      owner.dispatchEvent(new CustomEvent("selection", { detail: checked }));
    };
    const onChange = (event: Event) => {
      if ((event.target as HTMLElement).matches?.(`input[name=ids][form="${form}"]`)) sync();
    };
    document.addEventListener("change", onChange);
    sync();
    return () => document.removeEventListener("change", onChange);
  }, [form]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      onChange={(event) => {
        const on = event.currentTarget.checked;
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=ids][form="${form}"]`).forEach((row) => { row.checked = on; });
        document.getElementById(form)?.dispatchEvent(new CustomEvent("selection", { detail: on ? document.querySelectorAll(`input[name=ids][form="${form}"]`).length : 0 }));
      }}
    />
  );
}

/** "3 selected", announced politely as the selection changes. */
export function SelectionCount({ form, max }: { form: string; max: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const owner = document.getElementById(form);
    if (!owner) return;
    const update = (event: Event) => setCount(Number((event as CustomEvent<number>).detail) || 0);
    owner.addEventListener("selection", update);
    return () => owner.removeEventListener("selection", update);
  }, [form]);
  return <span aria-live="polite">{count ? `${count} selected${count > max ? ` · at most ${max} at a time` : ""}` : "None selected"}</span>;
}
