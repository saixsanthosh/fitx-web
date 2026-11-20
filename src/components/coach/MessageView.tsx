"use client";

import { HeartHandshake, Info } from "lucide-react";
import type { CoachMessageView } from "@/lib/ai/types";
import type { ActionState } from "./ActionButton";
import { MealPlanCard, type PlanActions } from "./MealPlanCard";
import { RichText } from "./RichText";
import { WorkoutPlanCard } from "./WorkoutPlanCard";
import styles from "./Coach.module.css";

/** One message: the member's words, a coach reply (text or a checked plan), or FITX's own safety note. */
export function MessageView({ message, actions }: { message: CoachMessageView; actions: PlanActions & { stateOf: (id: string | null) => ActionState } }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className={styles.user}>{message.content}</p>
      </div>
    );
  }

  if (message.role === "safety") {
    return (
      <div className="rounded-xl border border-fitx-border bg-fitx-surface p-4" role="note" aria-label="FITX safety note">
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.1em] text-fitx-primary-text">
          <HeartHandshake size={16} aria-hidden="true" /> A note from FITX
        </p>
        <RichText text={message.content} />
      </div>
    );
  }

  const plan = message.data?.plan;
  const notes = message.data?.notes ?? [];
  return (
    <div className={styles.reply}>
      <p className={styles.replyMeta}>
        <span aria-hidden="true" className={styles.mark}>FX</span>
        FITX Coach{message.provider ? <span className="font-normal"> · answered by {message.provider}</span> : null}
      </p>
      {plan?.kind === "meal_plan" ? (
        <MealPlanCard plan={plan} actions={actions} />
      ) : plan?.kind === "workout_plan" ? (
        <WorkoutPlanCard plan={plan} state={actions.stateOf(plan.actionId)} onSave={() => plan.actionId && actions.apply(plan.actionId)} />
      ) : (
        <RichText text={message.content} />
      )}
      {notes.map((note) => (
        <p key={note} className="flex gap-2 rounded-lg border border-fitx-border bg-fitx-surface px-3 py-2.5 text-sm leading-6 text-fitx-text-secondary">
          <Info size={16} aria-hidden="true" className="mt-1 shrink-0 text-fitx-info" />
          <span><span className="font-semibold text-fitx-text">FITX note:</span> {note}</span>
        </p>
      ))}
    </div>
  );
}
