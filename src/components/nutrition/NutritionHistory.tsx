"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/app/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { buildHistory, dateKeyOf, lastDays, type HistoryDay, type HistoryEntry, type HistoryTargets } from "@/lib/domain/nutrition-history";
import { isEstimateSnapshot } from "@/lib/food/client-data";
import styles from "./History.module.css";

type Range = 7 | 30;

interface Row {
  date: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  nutrition_snapshot: Parameters<typeof isEstimateSnapshot>[0];
  source: string;
}

const dayName = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, options).format(new Date(`${key}T12:00:00`));
const number = (value: number) => value.toLocaleString();

/**
 * The History tab: the last 7 or 30 days of what was logged. Days with nothing logged are gaps (never 0 kcal), the
 * averages count logged days only, adherence is stated against the member's own targets (and says where they came
 * from), and any protein, carbs or fat that entries did not have is disclosed rather than counted as 0.
 */
export function NutritionHistory({ targets, targetSource, onOpenDay }: { targets: HistoryTargets | null; targetSource: string; onOpenDay: (dateKey: string) => void }) {
  const [range, setRange] = useState<Range>(7);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problem, setProblem] = useState("");
  // Today is read once after mount so the server-rendered page never disagrees with the browser's clock.
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setToday(new Date()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!today) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setProblem("History needs a connection to your account."); setRows([]); return; }
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setProblem("Sign in to see your history."); setRows([]); return; }
      const since = lastDays(today, 30)[0];
      const { data, error } = await supabase.from("meals").select("date,calories,protein,carbs,fat,source,nutrition_snapshot")
        .eq("user_id", auth.user.id).gte("date", since).lte("date", dateKeyOf(today)).order("date", { ascending: true }).limit(3000);
      if (cancelled) return;
      if (error) { setProblem("Your history could not be loaded. Please try again."); setRows([]); return; }
      setProblem("");
      setRows((data ?? []) as unknown as Row[]);
    })();
    return () => { cancelled = true; };
  }, [today]);

  const history = useMemo(() => {
    if (!today || !rows) return null;
    const entries: HistoryEntry[] = rows.map((row) => ({
      date: row.date,
      calories: row.calories === null ? null : Number(row.calories),
      protein: row.protein === null ? null : Number(row.protein),
      carbs: row.carbs === null ? null : Number(row.carbs),
      fat: row.fat === null ? null : Number(row.fat),
      estimated: isEstimateSnapshot(row),
    }));
    return buildHistory(entries, lastDays(today, range), targets);
  }, [today, rows, range, targets]);

  if (!history) return <section className="fitx-panel p-4 sm:p-5"><p className="text-sm text-fitx-text-secondary" role="status">Loading your history…</p></section>;

  const top = Math.max(1, targets?.calories ?? 0, ...history.days.map((day) => day.calories));
  const lead = history.days.length ? (new Date(`${history.days[0].date}T12:00:00`).getDay() + 6) % 7 : 0;
  const unknownNote = (["protein", "carbs", "fat"] as const).filter((key) => history.daysWithUnknown[key] > 0)
    .map((key) => `${key} on ${history.daysWithUnknown[key]} ${history.daysWithUnknown[key] === 1 ? "day" : "days"}`);

  return (
    <section className="fitx-panel p-4 sm:p-5" aria-labelledby="history-title">
      <div className={styles.head}>
        <div>
          <h2 id="history-title" className="font-medium">History</h2>
          <p className="mt-1 text-sm text-fitx-text-secondary">Averages count only the days you logged. A day with nothing logged is a gap, not 0 kcal.</p>
        </div>
        <div className={styles.range} role="group" aria-label="Period">
          {([7, 30] as const).map((value) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value} days</button>)}
        </div>
      </div>
      {problem && <p role="alert" className={styles.alert}>{problem}</p>}
      {history.loggedDays === 0 ? (
        <EmptyState title="Nothing logged in this period" description="Log a meal and your days, averages and trends show up here."/>
      ) : <>
        <div className={styles.tiles}>
          <div><span>Days logged</span><strong>{history.loggedDays} <small>of {range}</small></strong></div>
          <div><span>Average calories</span><strong>{number(history.averages?.calories ?? 0)} <small>kcal a logged day</small></strong></div>
          <div><span>Average protein</span><strong>{history.averages?.protein} <small>g</small></strong></div>
          <div><span>Average carbs · fat</span><strong>{history.averages?.carbs} <small>g</small> · {history.averages?.fat} <small>g</small></strong></div>
        </div>
        {unknownNote.length > 0 && <p className={styles.note} role="note">Some entries have no value for {unknownNote.join(", ")}. Those values are left out of the totals, so the averages for them are a little low.</p>}
        {history.estimatedEntries > 0 && <p className={styles.note}>{history.estimatedEntries} of {history.totalEntries} entries are estimates (a typical recipe or an average portion weight).</p>}
        {history.adherence && targets
          ? <p className={styles.adherence}>
            Within 10% of your {number(targets.calories)} kcal target on <strong>{history.adherence.calorieDays} of {history.loggedDays}</strong> logged days
            {" "}and protein target met on <strong>{history.adherence.proteinDays} of {history.loggedDays}</strong>{history.adherence.proteinUnknownDays > 0 ? ` (${history.adherence.proteinUnknownDays} could not be told because an entry has no protein value)` : ""}.
            {" "}<span className={styles.source}>{targetSource}</span>
          </p>
          : <p className={styles.note}>Set daily targets under Edit targets (or add your age, height and weight to your profile) to see how often you hit them.</p>}
        <div className={styles.bars} aria-hidden="true">
          {history.days.map((day) => (
            <div key={day.date} className={styles.barCol} title={day.logged ? `${dayName(day.date, { weekday: "short", day: "numeric", month: "short" })}: ${number(day.calories)} kcal` : `${dayName(day.date, { weekday: "short", day: "numeric", month: "short" })}: not logged`}>
              <div className={styles.barArea}>
                {targets && <span className={styles.targetLine} style={{ bottom: `${(targets.calories / top) * 100}%` }}/>}
                {day.logged ? <span className={`${styles.bar} ${day.caloriesState === "over" ? styles.barOver : ""}`} style={{ height: `${Math.max(2, (day.calories / top) * 100)}%` }}/> : <span className={styles.gap}/>}
              </div>
              {range === 7 && <span className={styles.barLabel}>{dayName(day.date, { weekday: "short" })}</span>}
            </div>
          ))}
        </div>
        {targets && <p className={styles.legend} aria-hidden="true"><span className={styles.legendLine}/>Calorie target · dashed bars are days not logged</p>}
        <table className="sr-only">
          <caption>Calories logged each day, last {range} days</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Calories</th><th scope="col">Protein (g)</th><th scope="col">Carbs (g)</th><th scope="col">Fat (g)</th></tr></thead>
          <tbody>{history.days.map((day) => <DayRow key={day.date} day={day}/>)}</tbody>
        </table>
        <h3 className={styles.subhead}>Logged days</h3>
        <div className={styles.calendar} role="group" aria-label={`Days logged in the last ${range} days`}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <span key={name} className={styles.weekday} aria-hidden="true">{name}</span>)}
          {Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} aria-hidden="true"/>)}
          {history.days.map((day) => (
            <button key={day.date} type="button" className={`${styles.day} ${day.logged ? styles.dayLogged : ""}`} onClick={() => onOpenDay(day.date)}
              aria-label={`${dayName(day.date, { weekday: "long", day: "numeric", month: "long" })}: ${day.logged ? `${number(day.calories)} kcal logged` : "not logged"}. Open this day.`}>
              {Number(day.date.slice(8))}
            </button>
          ))}
        </div>
      </>}
    </section>
  );
}

function DayRow({ day }: { day: HistoryDay }) {
  const known = (value: number, key: "protein" | "carbs" | "fat") => `${value}${day.unknown[key] ? ` (${day.unknown[key]} entries without a value left out)` : ""}`;
  return (
    <tr>
      <th scope="row">{dayName(day.date, { weekday: "long", day: "numeric", month: "short" })}</th>
      {day.logged
        ? <><td>{number(day.calories)}</td><td>{known(day.protein, "protein")}</td><td>{known(day.carbs, "carbs")}</td><td>{known(day.fat, "fat")}</td></>
        : <td colSpan={4}>not logged</td>}
    </tr>
  );
}
