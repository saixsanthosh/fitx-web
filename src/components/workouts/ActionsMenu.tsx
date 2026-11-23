"use client";

/**
 * ActionsMenu: a "more" button that opens a short menu of actions (the compact Gym tab keeps one visible action per
 * row and puts the rest here). A menu button (aria-haspopup="menu", aria-expanded) and a role="menu" list of
 * role="menuitem" buttons. Opening focuses the first item; Up and Down (wrapping), Home and End move; Escape closes
 * and returns focus to the button; Tab, a tap outside or choosing an item closes it. Opens with a short fade and
 * scale from its corner (transform and opacity; none under reduced motion).
 *
 *   <ActionsMenu label="More actions for Leg day" items={[{ label: "Edit", name: "Edit Leg day", onSelect: edit }]} />
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { menuKeyIndex } from "./gym-compact";
import styles from "./ActionsMenu.module.css";

export type ActionsMenuItem = {
  /** The visible words. */
  label: string;
  /** The accessible name when it should say more than the label (it starts with the label). */
  name?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** "danger" for a removal (Delete, Leave). */
  tone?: "danger";
};

export function ActionsMenu({ label, items, className }: { label: string; items: readonly ActionsMenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const base = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const entries = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    entries.current.find((entry) => entry && !entry.disabled)?.focus();
    const away = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    const enabled = entries.current.filter((entry): entry is HTMLButtonElement => Boolean(entry && !entry.disabled));
    const next = menuKeyIndex(event.key, enabled.indexOf(document.activeElement as HTMLButtonElement), enabled.length);
    if (next === null) return;
    event.preventDefault();
    enabled[next]?.focus();
  };

  if (!items.length) return null;
  return (
    <div ref={wrap} className={cn(styles.wrap, className)}>
      <button ref={button} type="button" id={`${base}-button`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${base}-menu` : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}
        className={cn(styles.trigger, open && styles.triggerOpen)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" id={`${base}-menu`} aria-labelledby={`${base}-button`} className={styles.menu} onKeyDown={onMenuKey}>
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button key={item.label} ref={(node) => { entries.current[index] = node; }} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
                aria-label={item.name} className={cn(styles.item, item.tone === "danger" && styles.danger)}
                onClick={() => { setOpen(false); button.current?.focus(); item.onSelect(); }}>
                {Icon && <Icon size={16} aria-hidden="true" />}{item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
