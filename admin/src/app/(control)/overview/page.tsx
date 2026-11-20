import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BarChart, Feed, Kpi, PageHead, Panel, SplitBar, consoleStyles as ui } from "@/components/console/ui";
import { dailyAverageHint } from "@/components/console/chart-math";
import { ModuleState } from "@/components/module-state";
import { CountUp } from "@/components/motion/count-up";
import { ADMIN_OPS_MIGRATION } from "@/components/settings/settings-rules";
import { METHOD_LABELS, subscriptionLabel } from "@/components/users/people-filters";
import { hasPermission, requireAdmin } from "@/lib/admin-auth";
import { auditActionLabel } from "@/lib/audit-catalog";
import { READ_ONLY_AUDIT_ACTIONS } from "@/lib/audit-catalog-core";
import { recentAuditEvents } from "@/lib/data/audit";
import { getOverviewExtras, getOverviewTrends, getPlatformMetrics, getSupportCounts, type TrendDay } from "@/lib/data/metrics";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDateTime, formatShortDay } from "@/lib/time";

export const metadata: Metadata = { title: "Dashboard" };

const DEFINITIONS = [
  ["Registered", "Sign-ups that are not deleted or anonymous. Old Admin team accounts are left out."],
  ["Active", "Logged a workout, set, meal, water, body measurement or goal progress in the window."],
  ["Signed in", "A fresh sign-in in the window. Staying signed in does not count."],
  ["New", "Accounts created in the window."],
  ["Premium", "A live Razorpay subscription with paid access now."],
] as const;

const LEGACY_TILES = [
  { key: "registered_users", label: "Registered users" },
  { key: "active_users_30d", label: "Signed in, 30 days" },
  { key: "completed_workouts_30d", label: "Workouts, 30 days" },
  { key: "active_exercises", label: "Published exercises" },
  { key: "food_logs_30d", label: "Meals, 30 days" },
] as const;

function series(days: TrendDay[], key: keyof Omit<TrendDay, "day">) {
  return days.map((day) => ({ label: formatShortDay(day.day), value: day[key] }));
}

export default async function OverviewPage() {
  const admin = await requireAdmin("overview.view");
  const canSupport = hasPermission(admin, "support.view");
  const canAudit = hasPermission(admin, "audit.view");
  const [result, extras, trends, supportCounts, recent] = await Promise.all([
    getPlatformMetrics(),
    getOverviewExtras(),
    getOverviewTrends(30),
    canSupport ? getSupportCounts() : Promise.resolve(null),
    canAudit ? recentAuditEvents({ limit: 8, excludeActions: READ_ONLY_AUDIT_ACTIONS, permission: "audit.view" }) : Promise.resolve(null),
  ]);
  const days = trends.state === "ready" ? trends.days : [];
  const metrics = result.state === "ready" ? result.metrics : null;
  const more = extras.state === "ready" ? extras.extras : null;
  const waiting = supportCounts ? (supportCounts.open ?? 0) + (supportCounts.in_progress ?? 0) + (supportCounts.waiting_on_user ?? 0) : null;

  return (
    <div className="page-stack">
      <PageHead
        eyebrow="Dashboard"
        title="Overview"
        meta={metrics?.generated_at ? `Updated ${formatIstDateTime(metrics.generated_at)}` : undefined}
        actions={hasPermission(admin, "reports.view") ? <Link className="quiet-button" href="/reports">Reports<ArrowUpRight aria-hidden="true" size={16} /></Link> : undefined}
      />

      {metrics ? (
        <>
          <section className={`${ui.hero} ${ui.rise}`} aria-labelledby="hero-title">
            <svg className={ui.heroArt} viewBox="0 0 800 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
              <g className={ui.heroGrid}>
                {Array.from({ length: 17 }, (_, index) => <line key={`v${index}`} x1={index * 50} y1={0} x2={index * 50} y2={360} />)}
                {Array.from({ length: 8 }, (_, index) => <line key={`h${index}`} x1={0} y1={index * 50} x2={800} y2={index * 50} />)}
              </g>
              <circle className={ui.heroRing} cx={620} cy={180} r={160} />
              <circle className={ui.heroRing} cx={620} cy={180} r={104} />
              <circle className={ui.heroArc} cx={620} cy={180} r={132} pathLength={1} transform="rotate(-90 620 180)" />
            </svg>
            <div>
              <p className={ui.heroLabel} id="hero-title"><span className={ui.live} aria-hidden="true" />Registered users</p>
              <p className={ui.heroValue}><CountUp value={metrics.accounts} duration={1400} /></p>
              <p className={ui.heroNote}>{metrics.confirmed_accounts.toLocaleString("en-IN")} confirmed</p>
            </div>
            <div className={`${ui.heroStats} ${ui.stagger}`}>
              <div className={ui.heroStat}><strong><CountUp value={metrics.new_accounts_7d} /></strong><span>New, 7 days</span></div>
              <div className={ui.heroStat}><strong><CountUp value={metrics.new_accounts_30d} /></strong><span>New, 30 days</span></div>
              <div className={ui.heroStat}><strong><CountUp value={metrics.active_7d} /></strong><span>Active, 7 days</span></div>
              <div className={ui.heroStat}><strong><CountUp value={more ? more.suspended : null} /></strong><span>Suspended</span></div>
            </div>
          </section>

          {waiting !== null && waiting > 0 && (
            <Link className="attention-banner" href="/support"><span className={ui.live} aria-hidden="true" /><span><strong>{waiting.toLocaleString("en-IN")}</strong> help requests waiting · {(supportCounts?.open ?? 0).toLocaleString("en-IN")} new</span><ArrowUpRight aria-hidden="true" size={16} /></Link>
          )}

          <section aria-labelledby="active-title" className="metric-section">
            <h2 id="active-title" className="sr-only">Active users</h2>
            <div className={`${ui.kpiGrid} ${ui.stagger}`}>
              <Kpi label="Active today" value={metrics.active_24h} hint="Last 24 hours" accent />
              <Kpi label="Active, 30 days" value={metrics.active_30d} hint={dailyAverageHint(days.map((day) => day.active_accounts))} trend={days.map((day) => day.active_accounts)} />
              <Kpi label="Signed in, 24 hours" value={metrics.signed_in_24h} hint={`${metrics.signed_in_7d.toLocaleString("en-IN")} in 7 days`} />
              <Kpi label="Signed in, 30 days" value={metrics.signed_in_30d} hint="Fresh sign-ins only" />
            </div>
          </section>
        </>
      ) : result.state === "legacy" ? (
        <>
          <p className="inline-notice notice-error" role="status">Older counts. Apply <code>{MIGRATIONS.metrics}</code> for the full dashboard.</p>
          <div className={`${ui.kpiGrid} ${ui.stagger}`}>{LEGACY_TILES.map((tile) => <Kpi key={tile.key} label={tile.label} value={result.metrics[tile.key]} />)}</div>
        </>
      ) : result.state !== "ready" ? <ModuleState state={result.state} migration={MIGRATIONS.metrics} /> : null}

      {trends.state === "ready" && days.length > 0 && (
        <Panel title="Platform activity" hint="Last 30 days, IST" className={ui.onScroll}>
          <div className={ui.columns}>
            <div><h3 className="metric-definition">New registrations</h3><BarChart title="New registrations" points={series(days, "new_accounts")} /></div>
            <div><h3 className="metric-definition">Active accounts</h3><BarChart title="Active accounts" points={series(days, "active_accounts")} tone="green" /></div>
            <div><h3 className="metric-definition">Workouts completed</h3><BarChart title="Workouts completed" points={series(days, "workouts_completed")} tone="slate" /></div>
            <div><h3 className="metric-definition">Meals logged</h3><BarChart title="Meals logged" points={series(days, "meals_logged")} /></div>
          </div>
        </Panel>
      )}

      <div className={`${ui.columns} ${ui.columnsWide}`}>
        <div className={ui.stack}>
          <Panel
            title="Subscriptions"
            hint="Live mode"
            className={ui.onScroll}
            action={hasPermission(admin, "billing.view") ? <Link className="text-link" href="/billing">Open<ArrowUpRight aria-hidden="true" size={15} /></Link> : undefined}
          >
            {more ? (
              <div className={ui.stack}>
                <div className={`${ui.kpiGrid} ${ui.kpiGrid3}`}>
                  <Kpi label="Premium now" value={more.premium} accent />
                  <Kpi label="Free" value={metrics ? Math.max(metrics.accounts - more.premium, 0) : null} />
                  <Kpi label="Ever subscribed" value={Object.values(more.subscriptions).reduce((sum, value) => sum + value, 0)} />
                </div>
                <SplitBar
                  label="Latest subscription status"
                  empty="No live subscriptions yet."
                  segments={Object.entries(more.subscriptions).sort((a, b) => b[1] - a[1]).map(([status, value]) => ({ key: status, label: subscriptionLabel(status, false)?.text ?? status, value }))}
                />
              </div>
            ) : extras.state !== "ready" ? <ModuleState state={extras.state} migration={ADMIN_OPS_MIGRATION} /> : null}
          </Panel>

          <Panel title="Sign-in methods" hint="Accounts per method" className={ui.onScroll}>
            {more ? (
              <SplitBar label="Sign-in methods" segments={Object.entries(more.methods).sort((a, b) => b[1] - a[1]).map(([method, value]) => ({ key: method, label: METHOD_LABELS[method] ?? method, value }))} />
            ) : <p className="metric-definition">Needs migration <code>{ADMIN_OPS_MIGRATION}</code>.</p>}
          </Panel>

          {metrics && (
            <div className={`${ui.kpiGrid} ${ui.kpiGrid3} ${ui.onScroll}`}>
              <Kpi label="Workouts, 7 days" value={metrics.workouts_completed_7d} hint={`${metrics.workouts_completed_30d.toLocaleString("en-IN")} in 30 days`} />
              <Kpi label="Meals, 7 days" value={metrics.meals_logged_7d} hint={`${metrics.meals_logged_30d.toLocaleString("en-IN")} in 30 days`} />
              <Kpi label="Exercises live" value={metrics.published_exercises} />
            </div>
          )}
        </div>

        <div className={ui.stack}>
          {recent && (
            <Panel title="Recent admin activity" className={ui.onScroll} action={<Link className="text-link" href="/audit">Audit log<ArrowUpRight aria-hidden="true" size={15} /></Link>}>
              {recent.state === "ready" ? (
                recent.rows.length ? (
                  <Feed items={recent.rows.map((row) => ({ id: row.id, title: auditActionLabel(row.action), detail: `${row.actorLabel ?? "System"} · ${formatIstDateTime(row.createdAt) ?? ""}` }))} />
                ) : <p className="metric-definition">Nothing yet.</p>
              ) : <ModuleState state={recent.state} />}
            </Panel>
          )}
          <Panel title="How we count" className={ui.onScroll} flush>
            <dl className={ui.definitions}>
              {DEFINITIONS.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
