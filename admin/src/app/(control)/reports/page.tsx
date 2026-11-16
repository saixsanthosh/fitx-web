import type { Metadata } from "next";
import Link from "next/link";
import { ChartNoAxesCombined } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { TrendChart } from "@/components/trend-chart";
import { requireAdmin } from "@/lib/admin-auth";
import { getDailyTrends, type TrendDay } from "@/lib/data/metrics";
import { MIGRATIONS } from "@/lib/schema";
import { formatShortDay } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

const RANGES = [14, 30, 90] as const;

const SERIES: Array<{ key: keyof Omit<TrendDay, "day">; title: string; definition: string; summary: "total" | "peak" }> = [
  { key: "new_accounts", title: "New accounts", definition: "Sign-ups per day. Deleted, anonymous and Admin team accounts are left out.", summary: "total" },
  { key: "active_accounts", title: "Active accounts", definition: "Accounts that logged a workout, workout set, meal, water entry, body measurement or goal progress that day. Signing in alone does not count.", summary: "peak" },
  { key: "workouts_completed", title: "Workouts completed", definition: "Workout sessions finished, counted on the day they started.", summary: "total" },
  { key: "meals_logged", title: "Meals logged", definition: "Meal entries recorded that day.", summary: "total" },
];

function summarise(days: TrendDay[], key: (typeof SERIES)[number]["key"], kind: "total" | "peak") {
  const values = days.map((day) => day[key]);
  if (kind === "total") return `${values.reduce((sum, value) => sum + value, 0).toLocaleString("en-IN")} in ${days.length} days`;
  const peak = Math.max(...values);
  const peakDay = days[values.indexOf(peak)];
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return `Busiest day ${peak.toLocaleString("en-IN")} (${formatShortDay(peakDay.day)}) · average ${average.toLocaleString("en-IN", { maximumFractionDigits: 1 })} a day`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin("reports.view");
  const params = await searchParams;
  const days = (RANGES as readonly number[]).includes(Number(params.days)) ? Number(params.days) : 30;
  const result = await getDailyTrends(days);

  return <div className="page-stack">
    <div className="page-heading-row"><div><p className="eyebrow">PLATFORM SIGNALS</p><h1>Reports</h1><p className="page-lede">Daily trends from the FITX database. Days are calendar days in IST; every number is a count, never an estimate.</p></div><span className="page-heading-icon"><ChartNoAxesCombined aria-hidden="true" size={20} /></span></div>
    <nav className="filter-tabs" aria-label="Time range">
      {RANGES.map((range) => <Link key={range} aria-current={range === days ? "page" : undefined} href={`/reports?days=${range}`}>Last {range} days</Link>)}
    </nav>
    {result.state === "ready" ? <>
      <section className="chart-grid" aria-label="Daily trends">
        {SERIES.map((series) => (
          <article className="report-panel chart-card" key={series.key}>
            <div className="chart-heading"><h2>{series.title}</h2><p className="chart-summary">{summarise(result.days, series.key, series.summary)}</p></div>
            <p className="chart-definition">{series.definition}</p>
            <TrendChart title={series.title} points={result.days.map((day) => ({ day: day.day, label: formatShortDay(day.day), value: day[series.key] }))} />
          </article>
        ))}
      </section>
      <details className="table-panel data-table-details">
        <summary>Show these numbers as a table</summary>
        <div className="table-scroll"><table><thead><tr><th>Day (IST)</th>{SERIES.map((series) => <th key={series.key}>{series.title}</th>)}</tr></thead><tbody>
          {[...result.days].reverse().map((day) => <tr key={day.day}><td>{formatShortDay(day.day)} {day.day.slice(0, 4)}</td>{SERIES.map((series) => <td key={series.key}>{day[series.key].toLocaleString("en-IN")}</td>)}</tr>)}
        </tbody></table></div>
      </details>
    </> : <ModuleState state={result.state} migration={MIGRATIONS.metrics} />}
    <p className="privacy-note">Aggregates only: no individual workout, meal or health record leaves the database for these charts.</p>
  </div>;
}
