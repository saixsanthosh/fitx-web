import type { Metadata } from "next";
import { Download } from "lucide-react";
import { BarChart, LineChart, Meters } from "@/components/content/charts";
import { ContentHeader, ContentTabs, DataState, Empty, Section, Stat, Stats, contentStyles as styles, formatCount } from "@/components/content/kit";
import { requireAdmin } from "@/lib/admin-auth";
import { CONTENT_MIGRATION } from "@/lib/content/errors";
import {
  EXPORTS,
  REPORT_RANGES,
  cumulativeAccounts,
  latest,
  parseRange,
  percentChange,
  stickiness,
  total,
  weekly,
  type ExportKind,
  type Report,
} from "@/lib/content/report";
import { getReport } from "@/lib/data/reports";
import { formatShortDay } from "@/lib/time";
import { formatInr, formatSignedInr, monthLabel, subscriptionLabel } from "../billing/format";

export const metadata: Metadata = { title: "Reports" };

const SPORTS: Record<string, string> = { walk: "Walks", run: "Runs", ride: "Rides" };
const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack", "Other"];

function Exports({ days }: { days: number }) {
  return (
    <>
      {(Object.keys(EXPORTS) as ExportKind[]).map((kind) => (
        <a key={kind} className={`${styles.buttonQuiet} ${styles.small}`} href={`/reports/export?kind=${kind}&days=${days}`} download>
          <Download aria-hidden="true" size={14} />
          {EXPORTS[kind]}
          <span className={styles.srOnly}> as CSV</span>
        </a>
      ))}
    </>
  );
}

const weekLabel = (week: string) => `w/c ${formatShortDay(week)}`;

function Growth({ report }: { report: Report }) {
  const totals = cumulativeAccounts(report);
  const added = total(report.daily, "new_accounts");
  const change = percentChange(report.accountsBefore, report.accountsTotal);
  return (
    <Section title="User growth" id="growth" note="Accounts that are not deleted, anonymous or Admin team.">
      <Stats label="User growth">
        <Stat label="Accounts now" value={report.accountsTotal} />
        <Stat label={`New in ${report.days} days`} value={added} />
        <Stat label="Growth in the range" value={change} unit="%" hint={change === null ? "No accounts before the range" : undefined} />
        <Stat label="New this month" value={report.monthly.at(-1)?.new_accounts ?? null} />
      </Stats>
      <div className={`${styles.split} ${styles.splitEven}`}>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <LineChart label="Accounts at the end of each day" labels={report.daily.map((day) => formatShortDay(day.day))} series={[{ key: "accounts", label: "Accounts", values: totals, tone: 1 }]} />
        </div>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <BarChart label="New accounts each week" points={weekly(report.daily, "new_accounts").map((week) => ({ label: weekLabel(week.week), value: week.value }))} />
        </div>
      </div>
    </Section>
  );
}

function ActiveUsers({ report }: { report: Report }) {
  const sticky = stickiness(report.daily);
  return (
    <Section title="Active users" id="active" note="Logged a workout, set, meal, water, measurement, goal, walk, run or ride. Signing in alone does not count.">
      <Stats label="Active users">
        <Stat label="Today" value={latest(report.daily, "dau")} />
        <Stat label="Last 7 days" value={latest(report.daily, "wau")} />
        <Stat label="Last 30 days" value={latest(report.daily, "mau")} />
        <Stat label="Daily of monthly" value={sticky} unit="%" hint="Today against the last 30 days" />
      </Stats>
      <div className={`${styles.panel} ${styles.panelPad}`}>
        <LineChart
          label="Daily, weekly and monthly active members"
          labels={report.daily.map((day) => formatShortDay(day.day))}
          series={[
            { key: "mau", label: "30 days", values: report.daily.map((day) => day.mau), tone: 1 },
            { key: "wau", label: "7 days", values: report.daily.map((day) => day.wau), tone: 2 },
            { key: "dau", label: "Daily", values: report.daily.map((day) => day.dau), tone: 3 },
          ]}
        />
      </div>
    </Section>
  );
}

function Workouts({ report }: { report: Report }) {
  const w = report.workouts;
  const sports = Object.entries(w.activitiesBySport).map(([sport, value]) => ({ label: SPORTS[sport] ?? sport, value }));
  const sportTotal = sports.reduce((sum, item) => sum + item.value, 0);
  return (
    <Section title="Workout engagement" id="workouts">
      <Stats label="Workout engagement">
        <Stat label="Workouts completed" value={w.completed} hint={`${formatCount(w.abandoned)} left unfinished`} />
        <Stat label="Members who trained" value={w.members} />
        <Stat label="Average length" value={w.avgMinutes === null ? null : Math.round(w.avgMinutes)} unit="min" hint="Completed workouts with a recorded time" />
        <Stat label="On a programme" value={w.enrolmentsActive} hint={`${formatCount(w.enrolmentsStarted)} started in the range`} />
      </Stats>
      <div className={`${styles.split} ${styles.splitEven}`}>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <BarChart label="Workouts completed each week" tone="accent" points={weekly(report.daily, "workouts_completed").map((week) => ({ label: weekLabel(week.week), value: week.value }))} />
        </div>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <h3 className={styles.dayTitle}>Most trained exercises</h3>
          {w.topExercises.length ? (
            <Meters items={w.topExercises.map((row) => ({ label: row.name, value: row.sessions }))} total={w.completed} format={(n) => `${n.toLocaleString("en-IN")} workouts`} />
          ) : (
            <Empty title="No completed workouts yet" />
          )}
        </div>
      </div>
      <div className={`${styles.panel} ${styles.panelPad}`}>
        <h3 className={styles.dayTitle}>Walks, runs and rides</h3>
        {sportTotal ? <Meters items={sports.sort((a, b) => b.value - a.value)} total={sportTotal} /> : <Empty title="None recorded in the range" />}
      </div>
    </Section>
  );
}

function Nutrition({ report }: { report: Report }) {
  const n = report.nutrition;
  const slots = SLOTS.map((slot) => ({ label: slot, value: n.bySlot[slot] ?? 0 })).filter((slot) => slot.value > 0 || slot.label !== "Other");
  return (
    <Section title="Nutrition use" id="nutrition">
      <Stats label="Nutrition use">
        <Stat label="Meals logged" value={n.meals} />
        <Stat label="Members who logged" value={n.members} />
        <Stat label="From a barcode scan" value={n.barcodeMeals} />
        <Stat label="Water entries" value={n.waterEntries} />
      </Stats>
      <div className={`${styles.split} ${styles.splitEven}`}>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <BarChart label="Meals logged each week" tone="good" points={weekly(report.daily, "meals_logged").map((week) => ({ label: weekLabel(week.week), value: week.value }))} />
        </div>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <h3 className={styles.dayTitle}>Where logged food came from</h3>
          {n.bySource.length ? <Meters items={n.bySource.map((row) => ({ label: row.source, value: row.meals }))} total={n.meals} /> : <Empty title="No meals logged yet" />}
        </div>
      </div>
      <div className={`${styles.split} ${styles.splitEven}`}>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <h3 className={styles.dayTitle}>By meal</h3>
          {n.meals ? <Meters items={slots} total={n.meals} /> : <Empty title="No meals logged yet" />}
        </div>
        <dl className={`${styles.facts} ${styles.panel} ${styles.panelPad}`}>
          <div><dt>Custom foods created</dt><dd>{formatCount(n.customFoodsCreated)}</dd></div>
          <div><dt>Saved meals created</dt><dd>{formatCount(n.savedMealsCreated)}</dd></div>
          <div><dt>Day routines created</dt><dd>{formatCount(n.routinesCreated)}</dd></div>
        </dl>
      </div>
    </Section>
  );
}

function Revenue({ report }: { report: Report }) {
  const statuses = Object.entries(report.subscriptions.byStatus).sort((a, b) => b[1] - a[1]);
  const statusTotal = statuses.reduce((sum, [, n]) => sum + n, 0);
  const month = report.monthly.at(-1);
  return (
    <Section title="Subscriptions and revenue" id="revenue" note="Live Razorpay records only. Captured minus processed refunds.">
      <Stats label="Subscriptions and revenue">
        <Stat label="Paying now" value={report.subscriptions.payingNow} hint="Inside a paid period" />
        <Stat label="Started this month" value={month?.subscriptions_started ?? null} />
        <Stat label="Net this month" value={month ? month.captured_paise - month.refunded_paise : null} display={month ? formatSignedInr(month.captured_paise - month.refunded_paise) : undefined} />
        <Stat label="Net, 12 months" value={report.monthly.reduce((sum, m) => sum + m.captured_paise - m.refunded_paise, 0)} display={formatSignedInr(report.monthly.reduce((sum, m) => sum + m.captured_paise - m.refunded_paise, 0))} />
      </Stats>
      <div className={`${styles.split} ${styles.splitEven}`}>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <BarChart label="Captured revenue by month" tone="accent" format={formatInr} points={report.monthly.map((m) => ({ label: monthLabel(m.month), value: m.captured_paise }))} />
        </div>
        <div className={`${styles.panel} ${styles.panelPad}`}>
          <h3 className={styles.dayTitle}>Subscriptions by status</h3>
          {statusTotal ? <Meters items={statuses.map(([status, value]) => ({ label: subscriptionLabel(status), value }))} total={statusTotal} /> : <Empty title="No live subscriptions yet" />}
        </div>
      </div>
      <div className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Month (IST)</th>
                <th scope="col" className={styles.num}>New accounts</th>
                <th scope="col" className={styles.num}>Started</th>
                <th scope="col" className={styles.num}>Cancelled</th>
                <th scope="col" className={styles.num}>Failed payments</th>
                <th scope="col" className={styles.num}>Captured</th>
                <th scope="col" className={styles.num}>Refunded</th>
                <th scope="col" className={styles.num}>Net</th>
              </tr>
            </thead>
            <tbody>
              {[...report.monthly].reverse().map((m) => (
                <tr key={m.month}>
                  <td><strong>{monthLabel(m.month)}</strong></td>
                  <td className={styles.num}>{m.new_accounts.toLocaleString("en-IN")}</td>
                  <td className={styles.num}>{m.subscriptions_started.toLocaleString("en-IN")}</td>
                  <td className={styles.num}>{m.cancellations.toLocaleString("en-IN")}</td>
                  <td className={styles.num}>{m.payments_failed.toLocaleString("en-IN")}</td>
                  <td className={styles.num}>{formatInr(m.captured_paise)}</td>
                  <td className={styles.num}>{formatInr(m.refunded_paise)}</td>
                  <td className={styles.num}>{formatSignedInr(m.captured_paise - m.refunded_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin("reports.view");
  const params = await searchParams;
  const days = parseRange(params.days);
  const result = await getReport(days);
  return (
    <div className={styles.page}>
      <ContentHeader
        eyebrow="08 Reports"
        title="Reports"
        meta={result.state === "ready" ? `${formatShortDay(result.report.from)} to ${formatShortDay(result.report.to)} · IST days · counts, never estimates` : undefined}
        actions={result.state === "ready" ? <Exports days={days} /> : undefined}
      />
      <ContentTabs label="Time range" items={REPORT_RANGES.map((range) => ({ href: `/reports?days=${range}`, label: range === 365 ? "12 months" : `${range} days`, current: range === days }))} />
      {result.state !== "ready" ? (
        <DataState state={result.state} migration={CONTENT_MIGRATION} />
      ) : (
        <>
          <Growth report={result.report} />
          <ActiveUsers report={result.report} />
          <Workouts report={result.report} />
          <Nutrition report={result.report} />
          <Revenue report={result.report} />
          <p className={styles.hint}>Aggregates only: no member&apos;s workout, meal or payment row leaves the database for these reports. Exports are logged.</p>
        </>
      )}
    </div>
  );
}
