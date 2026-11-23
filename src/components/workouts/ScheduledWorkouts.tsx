"use client";

import type { MouseEvent } from "react";
import { ArrowRight, Clock } from "lucide-react";
import type { ScheduledItem } from "@/app/(dashboard)/workouts/_lib/scheduled";
import { readableDate } from "@/lib/domain/dates";
import styles from "./ScheduledWorkouts.module.css";

type ScheduledWorkoutsProps = {
  items: readonly ScheduledItem[];
  /** "Today", "Tomorrow" or a short date for a local day key. */
  dayLabel: (day: string) => string;
  /** Opens today's plan, keeping the planner item on the session it starts. */
  onStart: (planId: string, eventId: string) => void;
  headingLevel?: 2 | 3;
  starting?: boolean;
};

/**
 * The member's upcoming scheduled workouts, soonest first: day, time and title, and Start on today's (which opens the
 * plan, as the old week planner did). Renders nothing when there are none.
 */
export function ScheduledWorkouts({ items, dayLabel, onStart, headingLevel = 3, starting = false }: ScheduledWorkoutsProps) {
  if (!items.length) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="scheduled-workouts-title" className={styles.wrap}>
      <Heading id="scheduled-workouts-title" className={styles.heading}>Scheduled</Heading>
      <ul className={styles.list}>
        {items.map((item) => {
          const time = item.startsAt ? readableDate(new Date(item.startsAt), { hour: "numeric", minute: "2-digit" }) : null;
          const start = item.startHref && item.planId ? { href: item.startHref, planId: item.planId } : null;
          return (
            <li key={item.id} className={styles.row}>
              <span className={styles.when}>
                <span className={styles.day}>{dayLabel(item.day)}</span>
                {time && <span className={styles.time}><Clock size={12} aria-hidden="true" />{time}</span>}
              </span>
              <span className={styles.title}>{item.title}</span>
              {start && (
                <a
                  href={start.href}
                  aria-haspopup="dialog"
                  aria-label={`Start ${item.title}`}
                  aria-disabled={starting || undefined}
                  className={`fitx-button ${styles.start}`}
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    event.preventDefault();
                    if (!starting) onStart(start.planId, item.id);
                  }}
                >
                  Start<ArrowRight size={15} aria-hidden="true" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
