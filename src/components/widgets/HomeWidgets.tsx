"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, Droplets, Minus, Plus, Scale, Utensils } from "lucide-react";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { getSession, messageFor } from "@/components/tasks/session";
import { logWater, saveWeighIn, type SummaryResult } from "@/lib/data/today";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import { appliesOn, formatGoalValue } from "@/lib/domain/goals";
import { missingNote, unknownDayTotal, type MacroKey, type MealTotals } from "@/lib/domain/meal-totals";
import { todayTargets, weekStrip, weightView, type DailyTarget } from "@/lib/domain/today";
import { notifyUserContextChanged } from "@/lib/domain/user-context";
import { homePanel } from "@/config/routes";
import { WEIGHT_RANGE_KG, weightRangeText, weightText, weightToKg, weightUnitName, weightUnitOf } from "@/lib/domain/weight-display";
import type { GoalsData, Resource } from "./useHomeData";
import { WidgetCard, WidgetError, WidgetNote, WidgetSkeleton, WidgetStale } from "./WidgetCard";
import styles from "./Widgets.module.css";

const shortDate = (key: string | null) => (key ? keyToLocalDate(key).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");

/** A total no logged food gives a value for (contract C11): a dash, read out as "Not known". */
export function Unknown() {
  return <><span aria-hidden="true">—</span><span className="sr-only">Not known</span></>;
}

export function SourceTag({ target }: { target: DailyTarget }) {
  if (!target.target || !target.source) return null;
  const label = target.source === "goal" ? (target.direction === "limit" ? "Your limit" : "Your goal")
    : target.source === "target" ? "Your target"
      : target.source === "preference" ? "Your setting" : "Estimate";
  return <span className={target.source === "estimate" ? styles.tagEstimate : styles.tag}>{label}</span>;
}

/**
 * Summary-backed widgets share one request; each still shows its own loading and error state. A failed
 * refresh of the same day keeps its numbers but says they could not be updated.
 */
export function SummaryGate({ summary, label, children, loading }: { summary: Resource<SummaryResult>; label: string; children: (data: SummaryResult) => React.ReactNode; loading?: React.ReactNode }) {
  if (summary.data) {
    return (
      <>
        {summary.status === "error" && <WidgetStale onRetry={summary.reload} />}
        {children(summary.data)}
      </>
    );
  }
  if (summary.status === "error") return <WidgetError message={summary.error} onRetry={summary.reload} />;
  return loading ?? <WidgetSkeleton label={label} />;
}

/**
 * What today's totals leave out or estimate (contract C11): foods without a value are not counted as 0, and
 * estimated entries are named, the way the Nutrition log says it.
 */
export function FoodNotes({ food, keys }: { food: MealTotals | null; keys: readonly MacroKey[] }) {
  if (!food || !food.entries) return null;
  const missing = keys.map((key) => missingNote(food[key], key)).filter(Boolean);
  if (!missing.length && !food.estimated) return null;
  return (
    <p className={styles.foodNote}>
      {missing.length ? `${missing.join("; ")}, so ${missing.length === 1 && keys.length > 1 ? "that total leaves it out" : "the totals leave them out"}.` : null}
      {missing.length && food.estimated ? " " : null}
      {food.estimated ? `Includes ${food.estimated} estimated ${food.estimated === 1 ? "item" : "items"} (a typical recipe or an average portion).` : null}
    </p>
  );
}

export function WeightWidget({ summary, goals, date, onLogged }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData>; date: string; onLogged: () => void }) {
  // Weigh-ins are saved for the browser's today (logWeighIn), which is the day Home shows. Shown and typed in the
  // member's unit; stored in kilograms.
  const unit = weightUnitOf(useOptionalUserContext()?.data?.preferences.weight_unit);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    const typed = Number(value.replace(",", "."));
    const kg = Number.isFinite(typed) ? weightToKg(typed, unit) : Number.NaN;
    if (!Number.isFinite(kg) || kg < WEIGHT_RANGE_KG.min || kg > WEIGHT_RANGE_KG.max) { setError(`Enter a weight ${weightRangeText(unit)}.`); return; }
    setSaving(true);
    setError("");
    try {
      const { db, userId } = await getSession();
      const synced = await saveWeighIn(db, userId, kg);
      setOpen(false);
      setValue("");
      toast.success(synced ? "Weigh-in saved." : "Weigh-in saved. Your profile weight will update next time.");
      // Targets, Nutrition and the header all read the newest weight.
      notifyUserContextChanged();
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
                  <p className={styles.bigValue}><strong>{weightText(view.current, unit)}</strong> {unit}</p>
                  <p className={styles.subtle}>
                    {view.date === date ? "Logged today" : view.date ? `Logged ${shortDate(view.date)}` : "Latest weigh-in"}
                    {view.change !== null && (
                      <span className={styles.change}><ChangeIcon size={14} aria-hidden="true" />{view.change === 0 ? "No change" : `${weightText(Math.abs(view.change), unit)} ${unit} ${view.change < 0 ? "down" : "up"}`}{view.changeSince ? ` since ${shortDate(view.changeSince)}` : ""}</span>
                    )}
                  </p>
                </>
              ) : (
                <p className={styles.subtle}>No weigh-in yet</p>
              )}
              {view.target !== null && view.current !== null && (
                <div className={styles.weightTarget}>
                  <p><span>Target {weightText(view.target, unit)} {unit}</span><strong>{view.toGo === 0 ? "Reached" : view.toGo === null ? "" : `${weightText(view.toGo, unit)} ${unit} to go`}</strong></p>
                  {view.percent !== null && (
                    <div className="fitx-progress-track h-1.5" role="progressbar" aria-label="Progress to your target weight" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
                      <div className="fitx-progress-fill" style={{ width: `${view.percent}%` }} />
                    </div>
                  )}
                </div>
              )}
              {view.target === null && <WidgetNote href={homePanel("goals", { new: "weight" })} action="Set a weight goal">No target yet.</WidgetNote>}
              {open ? (
                <form className={styles.inlineForm} onSubmit={(event) => void save(event)}>
                  <label className="sr-only" htmlFor="home-weight">Weight in {weightUnitName(unit)}</label>
                  <input id="home-weight" className="fitx-field" inputMode="decimal" autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={view.current !== null ? weightText(view.current, unit) : unit} />
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
              ) : <WidgetNote href={homePanel("goals", { new: "water_day" })} action="Set a water goal">No target yet.</WidgetNote>}
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

export function WeekWidget({ summary, goals }: { summary: Resource<SummaryResult>; goals: Resource<GoalsData> }) {
  return (
    <WidgetCard title="This week" icon={<CalendarDays size={16} />} href={homePanel("week")} hrefLabel="Open your week">
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
        {({ summary: today, food }) => {
          const targets = todayTargets(today, goals.data?.goals);
          const rows: Array<[string, DailyTarget, string, MacroKey]> = [["Protein", targets.protein, "var(--fitx-gold)", "protein"], ["Carbs", targets.carbs, "var(--fitx-info)", "carbs"], ["Fat", targets.fat, "var(--fitx-primary)", "fat"]];
          return (
            <div className={styles.macros}>
              {rows.map(([name, target, color, key]) => {
                // Food logged but none of it gives this value: unknown, not 0 (the note below says why).
                const unknown = unknownDayTotal(food, key);
                return (
                  <div key={name} className={styles.macroRow}>
                    <p><span>{name} <SourceTag target={target} /></span><strong>{unknown ? <Unknown /> : Math.round(target.value)}{target.target ? ` / ${Math.round(target.target)}` : ""} g</strong></p>
                    <div className="fitx-progress-track h-1.5" role="progressbar" aria-label={`${name} today`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={unknown ? undefined : target.percent} aria-valuetext={unknown ? "Not known" : undefined}>
                      <div className="fitx-progress-fill" style={{ width: `${target.target && !unknown ? target.percent : 0}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
              <FoodNotes food={food} keys={["protein", "carbs", "fat"]} />
              {!targets.protein.target && !targets.carbs.target && !targets.fat.target && (
                <WidgetNote href="/nutrition" action="Set targets">No targets yet.</WidgetNote>
              )}
            </div>
          );
        }}
      </SummaryGate>
    </WidgetCard>
  );
}
