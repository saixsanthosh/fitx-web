"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, CircleCheck, Droplets, Dumbbell, ListChecks, Minus, PieChart, Plus, Scale, Target, Utensils } from "lucide-react";
import { ProgressRings } from "@/components/app/ProgressRing";
import { TodoList } from "@/components/tasks/TodoList";
import { clockTime } from "@/components/tasks/format";
import { getSession, messageFor } from "@/components/tasks/session";
import { logWater, logWeight, type SummaryResult } from "@/lib/data/today";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import { appliesOn, dailyGoalsMet, evaluateView, formatGoalValue, progressSummary, remainingLabel, sortGoals } from "@/lib/domain/goals";
import { todayTargets, weekStrip, weightView, type DailyTarget } from "@/lib/domain/today";
import type { GoalsData, Resource } from "./useHomeData";
import { WidgetCard, WidgetError, WidgetNote, WidgetSkeleton } from "./WidgetCard";
import styles from "./Widgets.module.css";

const shortDate = (key: string | null) => (key ? keyToLocalDate(key).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const kcal = (value: number) => Math.round(value).toLocaleString();

function SourceTag({ target }: { target: DailyTarget }) {
  if (!target.target || !target.source) return null;
  const label = target.source === "goal" ? (target.direction === "limit" ? "Your limit" : "Your goal") : target.source === "preference" ? "Your setting" : "Estimate";
  return <span className={target.source === "estimate" ? styles.tagEstimate : styles.tag}>{label}</span>;
}

/** Summary-backed widgets share one request; each still shows its own loading and error state. */
function SummaryGate({ summary, label, children }: { summary: Resource<SummaryResult>; label: string; children: (data: SummaryResult) => React.ReactNode }) {
  if (summary.data) return <>{children(summary.data)}</>;
  if (summary.status === "error") return <WidgetError message={summary.error} onRetry={summary.reload} />;
  return <WidgetSkeleton label={label} />;
}

export function TodayWidget({ summary, goals }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData> }) {
  return (
    <WidgetCard title="Today" icon={<PieChart size={16} />} href="/nutrition" hrefLabel="Open nutrition">
      <SummaryGate summary={summary} label="Loading today's numbers">
        {({ summary: today }) => {
          const targets = todayTargets(today, goals.data?.goals);
          const met = goals.data ? dailyGoalsMet(goals.data.goals, today.localDate) : null;
          const calories = targets.calories;
          const protein = targets.protein;
          const caloriesOver = calories.target !== null && calories.over > 0;
          const estimated = calories.source === "estimate" || protein.source === "estimate";
          const ringLabel = [
            `${kcal(calories.value)} kcal${calories.target ? ` of ${calories.source === "estimate" ? "an estimated " : ""}${kcal(calories.target)} kcal` : " logged"}`,
            `${Math.round(protein.value)} g protein${protein.target ? ` of ${protein.source === "estimate" ? "an estimated " : ""}${Math.round(protein.target)} g` : ""}`,
          ].join("; ");
          return (
            <div className={styles.today}>
              <ProgressRings
                size={156}
                thickness={13}
                gap={6}
                label={ringLabel}
                rings={[
                  { value: calories.value, target: calories.target, color: caloriesOver ? "var(--fitx-warning)" : "var(--fitx-primary)" },
                  { value: protein.value, target: protein.target, color: "var(--fitx-gold)" },
                ]}
              >
                <span className={styles.ringValue}>{kcal(calories.value)}</span>
                <span className={styles.ringUnit}>kcal today</span>
              </ProgressRings>
              <div className={styles.legend}>
                <TodayRow name="Calories" color="var(--fitx-primary)" target={calories} format={(value) => `${kcal(value)}`} unit="kcal" over={caloriesOver} />
                <TodayRow name="Protein" color="var(--fitx-gold)" target={protein} format={(value) => `${Math.round(value)}`} unit="g" />
                {met && met.total > 0 && (
                  <p className={styles.met}><CircleCheck size={15} aria-hidden="true" />{met.met} of {met.total} daily {met.total === 1 ? "goal" : "goals"} done</p>
                )}
              </div>
              {!calories.target && !protein.target ? (
                <WidgetNote href="/profile" action="Add them in Profile">Targets need your age, height and weight.</WidgetNote>
              ) : estimated ? (
                <WidgetNote href="/goals?tab=goals&new=protein_day" action="Set your own">Estimates use your profile and latest weigh-in.</WidgetNote>
              ) : null}
            </div>
          );
        }}
      </SummaryGate>
    </WidgetCard>
  );
}

function TodayRow({ name, color, target, format, unit, over = false }: { name: string; color: string; target: DailyTarget; format: (value: number) => string; unit: string; over?: boolean }) {
  return (
    <div className={styles.legendRow}>
      <span className={styles.dot} style={{ background: over ? "var(--fitx-warning)" : color }} aria-hidden="true" />
      <div className={styles.legendText}>
        <p className={styles.legendName}>{name} <SourceTag target={target} /></p>
        <p className={styles.legendValue}>
          <strong>{format(target.value)}</strong>
          {target.target ? <> / {format(target.target)} {unit}</> : <> {unit}</>}
        </p>
        {over && <p className={styles.over}>{format(target.over)} {unit} over</p>}
      </div>
      {target.target ? <span className={styles.legendPercent}>{target.percent}%</span> : null}
    </div>
  );
}

export function GoalsWidget({ goals, date }: { goals: Resource<GoalsData>; date: string }) {
  return (
    <WidgetCard title="Goals" icon={<Target size={16} />} href="/goals?tab=goals" hrefLabel="Manage goals">
      {!goals.data ? (
        goals.status === "error" ? <WidgetError message={goals.error} onRetry={goals.reload} /> : <WidgetSkeleton label="Loading your goals" />
      ) : (() => {
        const current = sortGoals(goals.data.goals.filter((goal) => goal.status === "active" && (goal.period === "long_term" ? !goal.dueOn || goal.dueOn >= date : appliesOn(goal, date))));
        if (!current.length) {
          return (
            <div className={styles.emptyGoals}>
              <p>No goals yet. Pick one to start; progress fills in from what you already log.</p>
              <div className={styles.templateLinks}>
                <Link href="/goals?tab=goals&new=protein_day">Daily protein</Link>
                <Link href="/goals?tab=goals&new=workouts_week">Workouts a week</Link>
                <Link href="/goals?tab=goals&new=water_day">Daily water</Link>
              </div>
              {goals.data.schema === "v1" && <WidgetNote>Daily and automatic goals arrive with the next FITX update.</WidgetNote>}
            </div>
          );
        }
        const shown = current.slice(0, 4);
        return (
          <>
            <ul className={styles.goalRows}>
              {shown.map((goal) => {
                const evaluation = evaluateView(goal);
                const over = evaluation.state === "over_limit";
                return (
                  <li key={goal.id} className={styles.goalRow}>
                    <div className={styles.goalTop}>
                      <p className={styles.goalTitle}>{evaluation.achieved && <Check size={14} className={styles.goalDone} aria-label="Done" />}{goal.title}</p>
                      <span className={styles.goalPeriod}>{goal.period === "daily" ? "Today" : goal.period === "weekly" ? "This week" : "Long-term"}</span>
                    </div>
                    <div className="fitx-progress-track h-1.5" role="progressbar" aria-label={`${goal.title}: ${progressSummary(goal)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={evaluation.percent}>
                      <div className="fitx-progress-fill" style={{ width: `${evaluation.percent}%`, background: over ? "var(--fitx-warning)" : evaluation.achieved ? "var(--fitx-success)" : undefined }} />
                    </div>
                    <p className={styles.goalMeta}><span>{progressSummary(goal)}</span><span className={over ? styles.overText : undefined}>{remainingLabel(goal, evaluation)}</span></p>
                  </li>
                );
              })}
            </ul>
            {current.length > shown.length && <Link href="/goals?tab=goals" className={styles.more}>{current.length - shown.length} more</Link>}
          </>
        );
      })()}
    </WidgetCard>
  );
}

export function WeightWidget({ summary, goals, date, onLogged }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData>; date: string; onLogged: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    const kg = Number(value.replace(",", "."));
    if (!Number.isFinite(kg) || kg < 30 || kg > 500) { setError("Enter a weight between 30 and 500 kg."); return; }
    setSaving(true);
    setError("");
    try {
      const { db, userId } = await getSession();
      await logWeight(db, userId, date, kg);
      setOpen(false);
      setValue("");
      toast.success("Weigh-in saved.");
      onLogged();
    } catch (failure) {
      setError(messageFor(failure, "That weigh-in could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <WidgetCard title="Weight" icon={<Scale size={16} />} href="/progress" hrefLabel="Open progress">
      <SummaryGate summary={summary} label="Loading your weight">
        {({ summary: today }) => {
          const view = weightView(today, goals.data?.goals);
          const ChangeIcon = view.change === null || view.change === 0 ? Minus : view.change < 0 ? ArrowDownRight : ArrowUpRight;
          return (
            <div className={styles.weight}>
              {view.current !== null ? (
                <>
                  <p className={styles.bigValue}><strong>{view.current.toFixed(1)}</strong> kg</p>
                  <p className={styles.subtle}>
                    {view.date === date ? "Logged today" : view.date ? `Logged ${shortDate(view.date)}` : "Latest weigh-in"}
                    {view.change !== null && (
                      <span className={styles.change}><ChangeIcon size={14} aria-hidden="true" />{view.change === 0 ? "No change" : `${Math.abs(view.change).toFixed(1)} kg ${view.change < 0 ? "down" : "up"}`}{view.changeSince ? ` since ${shortDate(view.changeSince)}` : ""}</span>
                    )}
                  </p>
                </>
              ) : (
                <p className={styles.subtle}>No weigh-in yet. Log one to track your progress.</p>
              )}
              {view.target !== null && view.current !== null && (
                <div className={styles.weightTarget}>
                  <p><span>Target {view.target.toFixed(1)} kg{view.targetSource === "profile" ? " (from your profile)" : ""}</span><strong>{view.toGo === 0 ? "Reached" : `${view.toGo?.toFixed(1)} kg to go`}</strong></p>
                  {view.percent !== null && (
                    <div className="fitx-progress-track h-1.5" role="progressbar" aria-label="Progress to your target weight" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
                      <div className="fitx-progress-fill" style={{ width: `${view.percent}%` }} />
                    </div>
                  )}
                </div>
              )}
              {view.target === null && <WidgetNote href="/goals?tab=goals&new=weight" action="Set a weight goal">No target weight yet.</WidgetNote>}
              {open ? (
                <form className={styles.inlineForm} onSubmit={(event) => void save(event)}>
                  <label className="sr-only" htmlFor="home-weight">Weight in kilograms</label>
                  <input id="home-weight" className="fitx-field" inputMode="decimal" autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={view.current !== null ? view.current.toFixed(1) : "kg"} />
                  <button type="submit" className="fitx-button" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                  <button type="button" className="fitx-button fitx-button-quiet" onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
                  {error && <p role="alert" className={styles.formError}>{error}</p>}
                </form>
              ) : (
                <button type="button" className={styles.secondaryAction} onClick={() => setOpen(true)}><Plus size={15} aria-hidden="true" />Log weight</button>
              )}
            </div>
          );
        }}
      </SummaryGate>
    </WidgetCard>
  );
}

export function WaterWidget({ summary, goals, date, onLogged }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData>; date: string; onLogged: () => void }) {
  const [saving, setSaving] = useState<number | null>(null);
  async function add(amount: number) {
    setSaving(amount);
    try {
      const { db, userId } = await getSession();
      await logWater(db, userId, date, amount);
      onLogged();
    } catch (failure) {
      toast.error(messageFor(failure, "That water could not be saved."));
    } finally {
      setSaving(null);
    }
  }
  return (
    <WidgetCard title="Water" icon={<Droplets size={16} />} href="/nutrition" hrefLabel="Open nutrition">
      <SummaryGate summary={summary} label="Loading today's water">
        {({ summary: today }) => {
          const water = todayTargets(today, goals.data?.goals).water;
          return (
            <div className={styles.water}>
              <p className={styles.bigValue}><strong>{formatGoalValue(water.value, "water_ml").replace(/ (L|ml)$/, "")}</strong> {water.value >= 1000 ? "L" : "ml"}{water.target ? <span className={styles.ofTarget}> of {formatGoalValue(water.target, "water_ml")} <SourceTag target={water} /></span> : null}</p>
              {water.target ? (
                <div className="fitx-progress-track h-2" role="progressbar" aria-label="Water today" aria-valuemin={0} aria-valuemax={100} aria-valuenow={water.percent}>
                  <div className="fitx-progress-fill" style={{ width: `${water.percent}%`, background: "var(--fitx-info)" }} />
                </div>
              ) : <WidgetNote href="/goals?tab=goals&new=water_day" action="Set a daily water goal">No water target yet.</WidgetNote>}
              <div className={styles.quickButtons}>
                {[250, 500].map((amount) => (
                  <button key={amount} type="button" className={styles.secondaryAction} disabled={saving !== null} onClick={() => void add(amount)}>
                    <Plus size={15} aria-hidden="true" />{saving === amount ? "Adding…" : `${amount} ml`}
                  </button>
                ))}
              </div>
            </div>
          );
        }}
      </SummaryGate>
    </WidgetCard>
  );
}

export function WorkoutWidget({ summary }: { summary: Resource<SummaryResult> }) {
  return (
    <WidgetCard title="Today's workout" icon={<Dumbbell size={16} />} href="/workouts" hrefLabel="Open workouts">
      <SummaryGate summary={summary} label="Loading today's workout">
        {({ summary: today }) => {
          const planned = today.plannedWorkouts;
          return (
            <div className={styles.workout}>
              {today.workouts.today > 0 && (
                <p className={styles.success}><CircleCheck size={16} aria-hidden="true" />{today.workouts.today === 1 ? "1 workout" : `${today.workouts.today} workouts`} finished today</p>
              )}
              {planned.length ? (
                <ul className={styles.plannedList}>
                  {planned.map((item) => (
                    <li key={item.id}>
                      <div>
                        <p className={styles.plannedTitle}>{item.title}</p>
                        <p className={styles.subtle}>{item.status === "completed" ? "Done" : clockTime(item.startsAt) ?? "Any time today"}</p>
                      </div>
                      {item.status !== "completed" && item.workoutPlanId && <Link href={`/workouts?plan=${item.workoutPlanId}`} className={styles.secondaryAction}>Open</Link>}
                    </li>
                  ))}
                </ul>
              ) : today.workouts.today === 0 ? (
                <div className={styles.nothing}>
                  <p className={styles.subtle}>Nothing planned for today.</p>
                  <Link href="/workouts" className={styles.secondaryAction}><Dumbbell size={15} aria-hidden="true" />Plan a workout</Link>
                </div>
              ) : null}
            </div>
          );
        }}
      </SummaryGate>
    </WidgetCard>
  );
}

export function WeekWidget({ summary, goals }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData> }) {
  return (
    <WidgetCard title="This week" icon={<CalendarDays size={16} />} href="/goals?tab=week" hrefLabel="Open your week">
      <SummaryGate summary={summary} label="Loading this week">
        {({ summary: today }) => {
          const goal = goals.data?.goals.find((item) => item.metric === "workouts_completed" && item.period === "weekly" && appliesOn(item, today.localDate));
          const target = goal?.targetValue ?? today.preferences?.workoutsPerWeek ?? null;
          const days = weekStrip(today);
          return (
            <div className={styles.week}>
              <p className={styles.bigValue}><strong>{today.workouts.week}</strong>{target ? <span className={styles.ofTarget}> of {target} workouts {goal ? <span className={styles.tag}>Your goal</span> : <span className={styles.tag}>Your plan</span>}</span> : <span className={styles.ofTarget}> {today.workouts.week === 1 ? "workout" : "workouts"}</span>}</p>
              <ol className={styles.days} aria-label="Workouts by day this week">
                {days.map((day) => {
                  const name = keyToLocalDate(day.date).toLocaleDateString(undefined, { weekday: "short" });
                  return (
                    <li key={day.date} className={`${styles.day} ${day.count ? styles.dayDone : ""} ${day.isToday ? styles.dayToday : ""}`} aria-label={`${keyToLocalDate(day.date).toLocaleDateString(undefined, { weekday: "long" })}: ${day.count ? `${day.count} ${day.count === 1 ? "workout" : "workouts"}` : day.isFuture ? "ahead" : "no workout"}`}>
                      <span className={styles.dayDot} aria-hidden="true">{day.count ? <Check size={13} strokeWidth={3} /> : null}</span>
                      <span className={styles.dayName} aria-hidden="true">{name.slice(0, 2)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        }}
      </SummaryGate>
    </WidgetCard>
  );
}

export function MacrosWidget({ summary, goals }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData> }) {
  return (
    <WidgetCard title="Macros" icon={<Utensils size={16} />} href="/nutrition" hrefLabel="Open nutrition">
      <SummaryGate summary={summary} label="Loading today's macros">
        {({ summary: today }) => {
          const targets = todayTargets(today, goals.data?.goals);
          const rows: Array<[string, DailyTarget, string]> = [["Protein", targets.protein, "var(--fitx-gold)"], ["Carbs", targets.carbs, "var(--fitx-info)"], ["Fat", targets.fat, "var(--fitx-primary)"]];
          return (
            <div className={styles.macros}>
              {rows.map(([name, target, color]) => (
                <div key={name} className={styles.macroRow}>
                  <p><span>{name} <SourceTag target={target} /></span><strong>{Math.round(target.value)}{target.target ? ` / ${Math.round(target.target)}` : ""} g</strong></p>
                  <div className="fitx-progress-track h-1.5" role="progressbar" aria-label={`${name} today`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={target.percent}>
                    <div className="fitx-progress-fill" style={{ width: `${target.target ? target.percent : 0}%`, background: color }} />
                  </div>
                </div>
              ))}
              {!targets.estimate && <WidgetNote href="/profile" action="Add them in Profile">Targets need your age, height and weight.</WidgetNote>}
            </div>
          );
        }}
      </SummaryGate>
    </WidgetCard>
  );
}

export function TodoWidget({ date, goals, onChanged }: { date: string; goals: Resource<GoalsData>; onChanged: () => void }) {
  const goalTitles = Object.fromEntries((goals.data?.goals ?? []).map((goal) => [goal.id, goal.title]));
  return (
    <WidgetCard title="To-Do" icon={<ListChecks size={16} />} href="/goals?tab=today" hrefLabel="Open your To-Do list">
      <TodoList date={date} variant="widget" limit={6} onChanged={onChanged} goalTitles={goalTitles} />
    </WidgetCard>
  );
}
