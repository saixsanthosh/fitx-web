"use client";

import { useState } from "react";
import { CalendarDays, ListChecks, Target } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { Tabs } from "@/components/ui/Tabs";
import { useToday } from "@/components/widgets/useHomeData";
import { TodayTab } from "./TodayTab";
import { GoalsTab } from "./GoalsTab";
import { WeekTab } from "./WeekTab";
import { isGoalsTab, type GoalsTabId } from "./tabs";
import styles from "./Goals.module.css";

const GOALS_TABS: ReadonlyArray<{ id: GoalsTabId; label: string; icon: typeof Target }> = [
  { id: "today", label: "Today", icon: ListChecks },
  { id: "goals", label: "Goals", icon: Target },
  { id: "week", label: "Week", icon: CalendarDays },
];

/** The Goals section: today's To-Do list, goals, and the week's schedule (the former Planner), on the shared tabs. */
export function GoalsWorkspace({ initialTab }: { initialTab: GoalsTabId }) {
  const today = useToday();
  const [tab, setTab] = useState<GoalsTabId>(initialTab);

  function select(next: string) {
    if (!isGoalsTab(next)) return;
    setTab(next);
    // Updates the address without a server round trip; Next's router stays in sync.
    window.history.replaceState(null, "", `/goals?tab=${next}`);
  }

  const content = (id: GoalsTabId) => {
    if (!today) return <div className={styles.loading} aria-busy="true" aria-label="Loading" />;
    if (id === "today") return <TodayTab today={today} />;
    if (id === "goals") return <GoalsTab today={today} />;
    return <WeekTab today={today} />;
  };

  return (
    <div className={styles.page}>
      <PageHeading title="Goals" description="Your To-Do list, the goals you're working toward and your week, in one place." />
      <Tabs
        label="Goals sections"
        value={tab}
        onChange={select}
        panelClassName={styles.panel}
        tabs={GOALS_TABS.map((entry) => {
          const Icon = entry.icon;
          return { id: entry.id, label: <><Icon size={16} aria-hidden="true" />{entry.label}</>, content: content(entry.id) };
        })}
      />
    </div>
  );
}
