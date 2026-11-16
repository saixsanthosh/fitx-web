import type { Metadata } from "next";
import { Activity, Apple, ArrowUpRight, Dumbbell, Users } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { getOverviewMetrics } from "@/lib/overview";

export const metadata: Metadata = { title: "Overview" };

const metricLabels = [
  { key: "registered_users", label: "Registered users", note: "FITX Auth accounts", icon: Users },
  { key: "active_users_30d", label: "Active · 30 days", note: "Recent sign-ins", icon: Activity },
  { key: "completed_workouts_30d", label: "Completed workouts", note: "Last 30 days", icon: Dumbbell },
  { key: "active_exercises", label: "Exercise library", note: "Active entries", icon: Apple },
] as const;

export default async function OverviewPage() {
  await requireAdmin();
  const result = await getOverviewMetrics();

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div><p className="eyebrow">FITX / OPERATIONS</p><h1>Platform overview</h1><p className="page-lede">A live read on the FITX ecosystem.</p></div>
        <div className="date-stamp">PRIVATE ADMIN WORKSPACE</div>
      </div>

      {result.state === "ready" ? (
        <>
          <section className="metric-grid" aria-label="Live platform metrics">
            {metricLabels.map(({ key, label, note, icon: Icon }) => (
              <article className="metric-panel" key={key}>
                <div className="metric-top"><Icon aria-hidden="true" size={19} /><span>{note}</span></div>
                <p className="metric-value">{result.metrics[key].toLocaleString("en-IN")}</p>
                <h2>{label}</h2>
              </article>
            ))}
          </section>
          <section className="overview-lower">
            <article className="report-panel">
              <div className="section-heading"><div><p className="eyebrow">DATA HEALTH</p><h2>What is connected</h2></div><span className="live-status"><span className="status-dot" />Live source</span></div>
              <div className="source-list">
                <div><span className="source-icon"><Users size={17} /></span><span><strong>Supabase Auth</strong><small>Registered and recently signed-in accounts</small></span><b>Ready</b></div>
                <div><span className="source-icon"><Dumbbell size={17} /></span><span><strong>Training records</strong><small>Workout sessions and exercise catalog</small></span><b>Ready</b></div>
                <div><span className="source-icon"><Apple size={17} /></span><span><strong>Nutrition logs</strong><small>{result.metrics.food_logs_30d.toLocaleString("en-IN")} meal logs in the last 30 days</small></span><b>Ready</b></div>
              </div>
            </article>
            <article className="report-note">
              <p className="eyebrow">OPERATING NOTE</p>
              <h2>Signals over guesses.</h2>
              <p>These figures come from the connected FITX database. Billing and support are marked unavailable until those systems have verified data sources.</p>
              <a className="text-link" href="/reports">Review data coverage <ArrowUpRight aria-hidden="true" size={15} /></a>
            </article>
          </section>
        </>
      ) : (
        <section className="setup-panel" role="status">
          <div className="setup-icon"><Activity aria-hidden="true" size={20} /></div>
          <div>
            <p className="eyebrow">DATA CONNECTION</p>
            <h2>{result.state === "service_key_missing" ? "Server data access is not configured" : result.state === "migration_pending" ? "Admin metrics are waiting for the approved migration" : "Live metrics could not be loaded"}</h2>
            <p>{result.state === "service_key_missing" ? "Add a server-only Supabase secret key to the Admin project environment. The value is never sent to the browser." : result.state === "migration_pending" ? "The dashboard uses a restricted database function that returns aggregate counts only. Apply the reviewed Admin migration after owner approval." : "The query failed safely. No placeholder or sample statistics are displayed."}</p>
          </div>
        </section>
      )}

      <section className="coverage-strip" aria-label="Platform modules">
        <div><span className="coverage-mark">A</span><span><strong>Training</strong><small>Connected</small></span></div>
        <div><span className="coverage-mark">B</span><span><strong>Nutrition</strong><small>Personal logs only</small></span></div>
        <div><span className="coverage-mark coverage-muted">C</span><span><strong>Billing</strong><small>Not connected</small></span></div>
        <div><span className="coverage-mark coverage-muted">D</span><span><strong>Support</strong><small>Not connected</small></span></div>
      </section>
    </div>
  );
}
