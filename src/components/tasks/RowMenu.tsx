"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import styles from "./Todo.module.css";

export type RowAction = { label: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean };

/** A small actions menu: arrow keys move between items, Escape or a click outside closes it. */
export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  }

  return (
    <div className={styles.menuWrap}>
      <button ref={button} type="button" className={styles.iconButton} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} className={styles.menu} onKeyDown={onKeyDown}>
          {actions.map((action) => (
            <button key={action.label} type="button" role="menuitem" disabled={action.disabled} className={action.danger ? styles.menuDanger : undefined}
              onClick={() => { setOpen(false); button.current?.focus(); action.onSelect(); }}>
              {action.icon}<span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
