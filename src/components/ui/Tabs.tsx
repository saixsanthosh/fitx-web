"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { nextTabIndex, resolveTab } from "./tabs-keys";

export type TabItem = {
  id: string;
  label: ReactNode;
  /** The panel body. It is rendered only once the tab has been opened. */
  content: ReactNode;
  /** A short count or flag after the label. */
  badge?: ReactNode;
  disabled?: boolean;
};

type TabsProps = {
  tabs: readonly TabItem[];
  /** Controlled selection (e.g. from ?tab=). Pair it with onChange. */
  value?: string;
  /** Initial selection when uncontrolled. */
  defaultValue?: string;
  /** Called with the new tab id on click and on arrow, Home and End keys. */
  onChange?: (id: string) => void;
  /** The accessible name of the tab list. */
  label: string;
  className?: string;
  panelClassName?: string;
};

/**
 * Accessible tabs: tablist / tab / tabpanel roles, roving tabindex, arrow, Home and End keys (selection
 * follows focus), aria-selected and aria-controls. The tab strip scrolls sideways on narrow screens.
 */
export function Tabs({ tabs, value, defaultValue, onChange, label, className = "", panelClassName = "" }: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState<string | null>(() => resolveTab(tabs, defaultValue));
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const controlled = value !== undefined;
  const selected = resolveTab(tabs, controlled ? value : inner);
  const seen = selected && !opened.has(selected) ? new Set([...opened, selected]) : opened;
  if (seen !== opened) setOpened(seen);

  const select = (id: string) => {
    if (id === selected) return;
    if (!controlled) setInner(id);
    onChange?.(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rtl = typeof document !== "undefined" && document.dir === "rtl";
    const next = nextTabIndex(event.key, index, tabs.length, { disabled: tabs.map((tab) => Boolean(tab.disabled)), rtl });
    if (next === null) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    select(tabs[next].id);
  };

  return (
    <div className={className}>
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div role="tablist" aria-label={label} aria-orientation="horizontal" className="flex min-w-max gap-1 border-b border-fitx-divider">
          {tabs.map((tab, index) => {
            const active = tab.id === selected;
            return (
              <button
                key={tab.id}
                ref={(node) => { buttons.current[index] = node; }}
                type="button"
                role="tab"
                id={`${base}-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`${base}-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                disabled={tab.disabled}
                onClick={() => select(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={`relative inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-t-lg px-4 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${active ? "text-fitx-text" : "text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text"}`}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge !== null ? <span className="rounded-full bg-fitx-surface-variant px-2 py-0.5 text-xs font-semibold text-fitx-text-secondary">{tab.badge}</span> : null}
                <span aria-hidden="true" className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full ${active ? "bg-fitx-primary" : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${base}-panel-${tab.id}`}
            aria-labelledby={`${base}-tab-${tab.id}`}
            hidden={!active}
            tabIndex={active ? 0 : undefined}
            className={`pt-4 focus-visible:outline-offset-2 ${panelClassName}`}
          >
            {active || seen.has(tab.id) ? tab.content : null}
          </div>
        );
      })}
    </div>
  );
}
