"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { m } from "framer-motion";
import { toast } from "sonner";
import { Check, CheckCircle2, History, Pause, Pencil, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { RowMenu } from "@/components/tasks/RowMenu";
import { getSession, messageFor } from "@/components/tasks/session";
import { Sheet } from "@/components/ui/Sheet";
import type { GoalsData, Resource } from "@/components/widgets/useHomeData";
import { WidgetError } from "@/components/widgets/WidgetCard";
import { addGoalEntry, deleteGoal, goalEntryDeleter, listGoalEntries, setGoalStatus, type GoalEntry, type GoalsSchema } from "@/lib/data/goals";
import type { SummaryResult } from "@/lib/data/today";
import { inOtherYear } from "@/lib/activity/format";
import {
  afterEntryRemoved, checkProgressAmount, evaluateView, foodValueNote, formatGoalValue, periodLabel, progressSummary, progressText, remainingLabel, sortGoals,
  type GoalContext, type GoalPeriod, type GoalTemplateKey, type GoalView,
} from "@/lib/domain/goals";
import { dailyTargets } from "@/lib/domain/today";
import { GoalEditor } from "./GoalEditor";
import styles from "./Goals.module.css";

type Editor = { mode: "add"; template: GoalTemplateKey | null } | { mode: "edit"; goal: GoalView };
/** A request from the address (`?panel=goals&new=<template>`) to open the editor; `key` changes per request. */
export type GoalRequest = { template: GoalTemplateKey; key: number };

const GROUPS: ReadonlyArray<{ period: GoalPeriod; title: string }> = [
  { period: "daily", title: "Today" },
  { period: "weekly", title: "This week" },
  { period: "long_term", title: "Long-term" },
];
const STARTERS: ReadonlyArray<{ key: GoalTemplateKey; label: string }> = [
  { key: "protein_day", label: "Daily protein" },
  { key: "workouts_week", label: "Workouts a week" },
  { key: "water_day", label: "Daily water" },
];

/**
 * Goals on Home: daily, weekly and long-term goals with their progress, and everything the Goals page did
 * (create from templates, edit, log manual progress and its history, pause, complete, reopen, delete).
 */
export function GoalsPanel({ date, goals, summary, request }: {
  date: string;
  goals: Resource<GoalsData>;
  summary: Resource<SummaryResult>;
  request: GoalRequest | null;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [handled, setHandled] = useState<number | null>(null);
  const [removing, setRemoving] = useState<GoalView | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [deletingGoal, setDeletingGoal] = useState(false);
  const goalDeletion = useRef(false);
  const [history, setHistory] = useState<GoalView | null>(null);
  const [logging, setLogging] = useState<GoalView | null>(null);
  // Each request from the address opens the editor once.
  if (request && request.key !== handled) {
    setHandled(request.key);
    setEditor({ mode: "add", template: request.template });
  }

  const schema = goals.data?.schema ?? "v2";
  const list = sortGoals(goals.data?.goals ?? []);
  const active = list.filter((goal) => goal.status === "active");
  const paused = list.filter((goal) => goal.status === "paused");
  const completed = list.filter((goal) => goal.status === "completed");

  const today = summary.data?.summary ?? null;
  const context: GoalContext = {
    today: date,
    estimate: today ? dailyTargets(today) : null,
    workoutsPerWeek: today?.preferences?.workoutsPerWeek ?? null,
    waterGoalMl: today?.preferences?.dailyWaterGoalMl ?? null,
    latestWeight: today?.weight?.kg ?? today?.profile.weight ?? null,
    targetWeight: today?.profile.targetWeight ?? null,
  };

  async function changeStatus(goal: GoalView, status: "active" | "paused" | "completed") {
    try {
      const { db, userId } = await getSession();
      await setGoalStatus(db, userId, goal.id, status, schema);
      goals.reload();
      const previous = goal.status === "paused" ? "paused" : goal.status === "completed" ? "completed" : "active";
      const undo = { label: "Undo", onClick: () => void changeStatus({ ...goal, status }, previous) };
      toast(status === "completed" ? `“${goal.title}” complete.` : status === "paused" ? `“${goal.title}” paused.` : `“${goal.title}” active again.`, { action: undo, duration: 7000 });
    } catch (failure) {
      toast.error(messageFor(failure, "That goal could not be updated."));
    }
  }

  async function remove(goal: GoalView) {
    // Deleted once per press: a double click does nothing more while it is being deleted (the button says
    // aria-disabled meanwhile, which keeps keyboard focus on it where disabled would drop it; D5).
    if (goalDeletion.current) return;
    goalDeletion.current = true;
    setDeletingGoal(true);
    setRemoveError("");
    try {
      const { db, userId } = await getSession();
      await deleteGoal(db, userId, goal.id);
      setRemoving(null);
      goals.reload();
      toast(`Deleted “${goal.title}”.`);
    } catch (failure) {
      // Inside the open sheet: a toast would sit under the modal dialog.
      setRemoveError(messageFor(failure, "That goal could not be deleted."));
    } finally {
      goalDeletion.current = false;
      setDeletingGoal(false);
    }
  }

  const row = (goal: GoalView) => (
    <GoalRow
      key={goal.id}
      goal={goal}
      today={date}
      onEdit={() => setEditor({ mode: "edit", goal })}
      onStatus={(status) => void changeStatus(goal, status)}
      onDelete={() => { setRemoveError(""); setRemoving(goal); }}
      onHistory={() => setHistory(goal)}
      onLog={() => setLogging(goal)}
    />
  );

  return (
    <section id="home-goals" className={styles.panel} aria-labelledby="home-goals-title">
      <header className={styles.head}>
        <h2 id="home-goals-title" className={styles.heading} tabIndex={-1}>Goals</h2>
        {goals.data && list.length > 0 && <p className={styles.count}>{active.length} active</p>}
        <button type="button" className={styles.headButton} onClick={() => setEditor({ mode: "add", template: null })} disabled={!goals.data}>
          <Plus size={16} aria-hidden="true" />New goal
        </button>
      </header>
      {schema === "v1" && goals.data && <p className={styles.note}>Daily and automatic goals arrive with the next FITX update.</p>}
      <div className={styles.card}>

      {!goals.data ? (
        goals.status === "error" ? <WidgetError message={goals.error} onRetry={goals.reload} /> : <div className={styles.skeleton} aria-busy="true" aria-label="Loading your goals"><span /><span /><span /></div>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No goals yet</p>
          <div className={styles.starters}>
            {STARTERS.map((starter) => (
              <button key={starter.key} type="button" className={styles.starter} onClick={() => setEditor({ mode: "add", template: starter.key })} disabled={schema === "v1"}>
                <Plus size={14} aria-hidden="true" />{starter.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.groups}>
          {GROUPS.map((group) => {
            const goalsInGroup = active.filter((goal) => goal.period === group.period);
            if (!goalsInGroup.length) return null;
            return (
              <div key={group.period} className={styles.group}>
                <h3 className={styles.groupTitle}>{group.title}</h3>
                <ul className={styles.rows}>{goalsInGroup.map(row)}</ul>
              </div>
            );
          })}
          {active.length === 0 && <p className={styles.note}>No active goals.</p>}
          {paused.length > 0 && (
            <details className={styles.more}>
              <summary>Paused · {paused.length}</summary>
              <ul className={styles.rows}>{paused.map(row)}</ul>
            </details>
          )}
          {completed.length > 0 && (
            <details className={styles.more}>
              <summary>Completed · {completed.length}</summary>
              <ul className={styles.rows}>{completed.map(row)}</ul>
            </details>
          )}
        </div>
      )}
      </div>

      {/* The form prefills from the member's numbers and the database's goal support, so it waits for both. */}
      {editor && goals.data && (summary.data || summary.status === "error") && (
        <GoalEditor
          mode={editor.mode}
          schema={schema}
          context={context}
          initialTemplate={editor.mode === "add" ? editor.template : null}
          goal={editor.mode === "edit" ? editor.goal : undefined}
          onClose={() => setEditor(null)}
          onSaved={(message) => { setEditor(null); goals.reload(); toast.success(message); }}
        />
      )}

      {removing && (
        <Sheet
          open
          side="center"
          onClose={() => setRemoving(null)}
          title={`Delete “${removing.title}”?`}
          description="Its progress history goes too. This can't be undone."
          footer={<>
            <button type="button" className="fitx-button fitx-button-secondary" onClick={() => setRemoving(null)}>Cancel</button>
            <button type="button" className={`fitx-button fitx-button-danger${deletingGoal ? ` ${styles.busyButton}` : ""}`} aria-disabled={deletingGoal || undefined} onClick={() => void remove(removing)}><Trash2 size={15} aria-hidden="true" />{deletingGoal ? "Deleting…" : "Delete goal"}</button>
          </>}
        >
          <p className={styles.confirm}>Pause or complete it instead to keep the history.</p>
          {removeError && <p role="alert" className="fitx-alert fitx-alert-danger mt-3">{removeError}</p>}
        </Sheet>
      )}

      {logging && <LogSheet goal={logging} schema={schema} onClose={() => setLogging(null)} onHistory={() => { setLogging(null); setHistory(logging); }} onLogged={() => { setLogging(null); goals.reload(); }} />}
      {history && <HistorySheet goal={history} schema={schema} onClose={() => setHistory(null)} onChanged={goals.reload} />}
    </section>
  );
}

/** One goal: its name, this period's progress and what is left, and its actions. */
function GoalRow({ goal, today, onEdit, onStatus, onDelete, onHistory, onLog }: {
  goal: GoalView;
  today: string;
  onEdit: () => void;
  onStatus: (status: "active" | "paused" | "completed") => void;
  onDelete: () => void;
  onHistory: () => void;
  onLog: () => void;
}) {
  const reduced = useReducedMotionSafe();
  const evaluation = evaluateView(goal);
  const over = evaluation.state === "over_limit";
  const manual = goal.metric === "manual";
  const active = goal.status === "active";
  const completed = goal.status === "completed";
  const reached = active && goal.period === "long_term" && evaluation.achieved;
  const fill = over ? "var(--fitx-warning)" : evaluation.achieved ? "var(--fitx-success)" : "var(--fitx-primary)";
  const left = remainingLabel(goal, evaluation);
  const food = foodValueNote(goal);
  const when = completed && goal.completedAt
    ? `Done ${new Date(goal.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(Number(today.slice(0, 4)) !== new Date(goal.completedAt).getFullYear() ? { year: "numeric" } : {}) })}`
    : goal.period === "long_term" ? periodLabel(goal, today) : null;

  return (
    <li className={`${styles.row} ${active ? "" : styles.inactive}`}>
      <div className={styles.rowTop}>
        <p className={styles.title}>
          {evaluation.achieved && <Check size={15} strokeWidth={2.6} className={styles.done} aria-label="Done" />}
          <span>{goal.title}</span>
        </p>
        {manual && active && !reached && (
          <button type="button" className={styles.logButton} onClick={onLog} aria-label={`Log progress for ${goal.title}`}><Plus size={15} aria-hidden="true" />Log</button>
        )}
        {reached && (
          <button type="button" className={styles.logButton} onClick={() => onStatus("completed")}><CheckCircle2 size={15} aria-hidden="true" />Complete</button>
        )}
        <RowMenu
          label={`Actions for ${goal.title}`}
          actions={[
            { label: "Edit", icon: <Pencil size={15} aria-hidden="true" />, onSelect: onEdit },
            ...(manual ? [{ label: "Progress history", icon: <History size={15} aria-hidden="true" />, onSelect: onHistory }] : []),
            ...(completed
              ? [{ label: "Reopen", icon: <RotateCcw size={15} aria-hidden="true" />, onSelect: () => onStatus("active") }]
              : [
                goal.status === "paused"
                  ? { label: "Resume", icon: <Play size={15} aria-hidden="true" />, onSelect: () => onStatus("active") }
                  : { label: "Pause", icon: <Pause size={15} aria-hidden="true" />, onSelect: () => onStatus("paused") },
                { label: "Mark complete", icon: <CheckCircle2 size={15} aria-hidden="true" />, onSelect: () => onStatus("completed") },
              ]),
            { label: "Delete", icon: <Trash2 size={15} aria-hidden="true" />, onSelect: onDelete, danger: true },
          ]}
        />
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={`Progress for ${goal.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={evaluation.percent}
        aria-valuetext={progressText(goal, evaluation, left)}
      >
        <m.span
          className={styles.fill}
          style={{ background: fill, originX: 0 }}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: evaluation.percent / 100 }}
          transition={{ duration: DURATION.slow, ease: EASE.out }}
        />
      </div>
      <p className={styles.meta}>
        <span>{progressSummary(goal)}</span>
        <span className={over ? styles.overText : evaluation.achieved ? styles.doneText : undefined}>{[left, when].filter(Boolean).join(" · ")}</span>
      </p>
      {/* Food without the goal's value: an unknown total says so (never "0 of 120 g"), a partial one how many are left out. */}
      {food ? <p className={styles.missing}>{food}</p> : null}
      {goal.negativeTotal !== undefined ? <p className={styles.missing}>Minus entries add up to less than zero, so this shows 0. Delete them in Progress history.</p> : null}
    </li>
  );
}

/** Adds progress to a goal the member tracks by hand. */
function LogSheet({ goal, schema, onClose, onHistory, onLogged }: { goal: GoalView; schema: GoalsSchema; onClose: () => void; onHistory: () => void; onLogged: () => void }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Logged once per press: Enter pressed twice, or a double click, does nothing more while it saves (the
    // button says aria-disabled meanwhile, which keeps keyboard focus on it where disabled would drop it; D5).
    if (savingNow.current) return;
    const checked = checkProgressAmount(amount, goal, schema);
    if (!checked.ok) { setError(checked.error); return; }
    const value = checked.amount;
    setError("");
    savingNow.current = true;
    setSaving(true);
    try {
      const { db, userId } = await getSession();
      await addGoalEntry(db, userId, goal, value, null, schema);
      toast.success(`Logged ${formatGoalValue(value, goal.metric, goal.unit)} for “${goal.title}”.`);
      onLogged();
    } catch (failure) {
      setError(messageFor(failure, "That progress could not be saved."));
      savingNow.current = false;
      setSaving(false);
    }
  }

  return (
    <Sheet
      open
      side="center"
      onClose={onClose}
      title="Log progress"
      description={goal.title}
      footer={<>
        <button type="button" className={`fitx-button fitx-button-quiet ${styles.footerStart}`} onClick={onHistory}>History</button>
        <button type="button" className="fitx-button fitx-button-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="goal-log-form" className={`fitx-button${saving ? ` ${styles.busyButton}` : ""}`} disabled={!amount.trim()} aria-disabled={saving || undefined}>{saving ? "Saving…" : "Log"}</button>
      </>}
    >
      <form id="goal-log-form" className={styles.logForm} onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor={`log-${goal.id}`}>Amount{goal.unit ? <em> {goal.unit}</em> : null}</label>
        <input id={`log-${goal.id}`} className="fitx-field" inputMode="decimal" autoFocus value={amount} onChange={(event) => { setAmount(event.target.value); setError(""); }} placeholder="1" aria-invalid={error ? true : undefined} aria-describedby={error ? `log-error-${goal.id}` : undefined} />
        {error && <p id={`log-error-${goal.id}`} role="alert" className={styles.logError}>{error}</p>}
      </form>
    </Sheet>
  );
}

/**
 * The entries logged for a goal, newest first, each deletable. A deletion that would take the total below zero
 * is refused with the reason, inside the sheet (a toast would sit under it). Deletions go one at a time, each
 * checked against the total the last one left (goalEntryDeleter): while one is being saved the Delete buttons
 * say aria-disabled (not disabled, which would drop keyboard focus; D5) and another press does nothing. After a
 * deletion, focus moves to the next entry's button (or the empty message) and the result is announced.
 */
function HistorySheet({ goal, schema, onClose, onChanged }: { goal: GoalView; schema: GoalsSchema; onClose: () => void; onChanged: () => void }) {
  const [entries, setEntries] = useState<GoalEntry[] | null>(null);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleter] = useState(() => goalEntryDeleter(goal, schema, getSession));
  // The list as the last change left it. remove() reads this, not `entries`: a press can come before React
  // has drawn the previous deletion, and that render's `entries` would bring a deleted entry back.
  const listed = useRef<GoalEntry[]>([]);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLParagraphElement | null>(null);
  // The entry whose Delete button takes focus once the list has re-rendered ("empty": the empty message).
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { db, userId } = await getSession();
        const list = await listGoalEntries(db, userId, goal.id);
        if (!active) return;
        listed.current = list;
        setEntries(list);
      } catch (failure) {
        if (active) setError(messageFor(failure, "Progress history could not be loaded."));
      }
    })();
    return () => { active = false; };
  }, [goal.id]);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "empty") emptyRef.current?.focus();
    else buttons.current.get(target)?.focus();
  }, [entries]);

  async function remove(entry: GoalEntry) {
    if (deleter.saving) return;
    setProblem("");
    setSaving(true);
    try {
      const outcome = await deleter.remove(entry);
      if (outcome.status === "refused") setProblem(outcome.message);
      if (outcome.status !== "deleted") return;
      const { rest, focus } = afterEntryRemoved(listed.current, entry.id);
      listed.current = rest;
      focusNext.current = focus;
      setEntries(rest);
      setAnnouncement(`Deleted the entry of ${entry.amount > 0 ? "" : "minus "}${formatGoalValue(Math.abs(entry.amount), goal.metric, goal.unit)}.`);
      onChanged();
    } catch (failure) {
      setProblem(messageFor(failure, "That entry could not be deleted."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Progress history" description={goal.title}>
      <p role="status" className="sr-only">{announcement}</p>
      {problem && <p role="alert" className="fitx-alert fitx-alert-danger mb-3">{problem}</p>}
      {error ? <p role="alert" className="fitx-alert fitx-alert-danger">{error}</p>
        : entries === null ? <div className={styles.skeleton} aria-busy="true" aria-label="Loading history"><span /></div>
          : entries.length === 0 ? <p ref={emptyRef} tabIndex={-1} className={styles.confirm}>Nothing logged yet.</p>
            : (
              <ul className={styles.history}>
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>{entry.amount > 0 ? "+" : "−"}{formatGoalValue(Math.abs(entry.amount), goal.metric, goal.unit)}</strong>
                      <span>{new Date(entry.loggedAt).toLocaleString(undefined, { day: "numeric", month: "short", ...(inOtherYear(Date.parse(entry.loggedAt)) ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit" })}{entry.note ? ` · ${entry.note}` : ""}</span>
                    </div>
                    <button
                      type="button"
                      ref={(element) => { if (element) buttons.current.set(entry.id, element); else buttons.current.delete(entry.id); }}
                      className={styles.iconButton}
                      onClick={() => void remove(entry)}
                      aria-disabled={saving || undefined}
                      aria-label={`Delete the entry of ${formatGoalValue(entry.amount, goal.metric, goal.unit)}`}
                    ><Trash2 size={16} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
    </Sheet>
  );
}
