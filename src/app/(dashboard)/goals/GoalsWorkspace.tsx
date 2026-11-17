"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ListChecks, Target } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { useToday } from "@/components/widgets/useHomeData";
import { TodayTab } from "./TodayTab";
import { GoalsTab } from "./GoalsTab";
import { WeekTab } from "./WeekTab";
import type { GoalsTabId } from "./tabs";
import styles from "./Goals.module.css";

const GOALS_TABS: ReadonlyArray<{ id: GoalsTabId; label: string; icon: typeof Target }> = [
  { id: "today", label: "Today", icon: ListChecks },
  { id: "goals", label: "Goals", icon: Target },
  { id: "week", label: "Week", icon: CalendarDays },
];

/** The Goals section: today's To-Do list, goals, and the week's schedule (the former Planner). */
export function GoalsWorkspace({ initialTab }: { initialTab: GoalsTabId }) {
  const today = useToday();
  const [tab, setTab] = useState<GoalsTabId>(initialTab);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(next: GoalsTabId, focus = false) {
    setTab(next);
    // Updates the address without a server round trip; Next's router stays in sync.
    window.history.replaceState(null, "", `/goals?tab=${next}`);
    if (focus) tabs.current[GOALS_TABS.findIndex((entry) => entry.id === next)]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = GOALS_TABS.findIndex((entry) => entry.id === tab);
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: GOALS_TABS.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = GOALS_TABS[(keys[event.key] + GOALS_TABS.length) % GOALS_TABS.length];
    select(next.id, true);
  }

  return (
    <div className={styles.page}>
      <PageHeading title="Goals" description="Your To-Do list, the goals you're working toward and your week, in one place." />
      <div role="tablist" aria-label="Goals sections" className={styles.tabs} onKeyDown={onKeyDown}>
        {GOALS_TABS.map((entry, index) => {
          const Icon = entry.icon;
          const selected = entry.id === tab;
          return (
            <button
              key={entry.id}
              ref={(element) => { tabs.current[index] = element; }}
              type="button"
              role="tab"
              id={`goals-tab-${entry.id}`}
              aria-selected={selected}
              aria-controls={`goals-panel-${entry.id}`}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => select(entry.id)}
            >
              <Icon size={16} aria-hidden="true" /><span>{entry.label}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`goals-panel-${tab}`} aria-labelledby={`goals-tab-${tab}`} className={styles.panel}>
        {!today ? (
          <div className={styles.loading} aria-busy="true" aria-label="Loading" />
        ) : tab === "today" ? (
          <TodayTab today={today} />
        ) : tab === "goals" ? (
          <GoalsTab today={today} />
        ) : (
          <WeekTab today={today} />
        )}
      </div>
    </div>
  );
}
