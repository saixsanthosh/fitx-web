import type { Metadata } from "next";
import { ChartNoAxesCombined } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { getOverviewMetrics } from "@/lib/overview";
import { ModuleState } from "@/components/module-state";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireAdmin();
  const result = await getOverviewMetrics();
  return <div className="page-stack">
    <div className="page-heading-row"><div><p className="eyebrow">PLATFORM SIGNALS</p><h1>Reports</h1><p className="page-lede">A bounded, aggregate view of connected FITX activity.</p></div><span className="page-heading-icon"><ChartNoAxesCombined aria-hidden="true" size={20} /></span></div>
    {result.state === "ready" ? <section className="report-grid" aria-label="Aggregate FITX reports">
      <article className="report-panel"><p className="eyebrow">AUTH</p><h2>Account activity</h2><div className="report-number">{result.metrics.registered_users.toLocaleString("en-IN")}</div><p>Registered accounts · {result.metrics.active_users_30d.toLocaleString("en-IN")} signed in during the last 30 days.</p></article>
      <article className="report-panel"><p className="eyebrow">TRAINING</p><h2>Workout completion</h2><div className="report-number">{result.metrics.completed_workouts_30d.toLocaleString("en-IN")}</div><p>Completed sessions during the last 30 days.</p></article>
      <article className="report-panel"><p className="eyebrow">CATALOG</p><h2>Published exercises</h2><div className="report-number">{result.metrics.active_exercises.toLocaleString("en-IN")}</div><p>Active entries in the FITX exercise library.</p></article>
      <article className="report-panel"><p className="eyebrow">NUTRITION</p><h2>Meal log volume</h2><div className="report-number">{result.metrics.food_logs_30d.toLocaleString("en-IN")}</div><p>Meal log records during the last 30 days; individual nutrition data is not shown.</p></article>
    </section> : <ModuleState state={result.state} />}
    <p className="privacy-note">All values are server-side aggregate counts. Billing, refunds, support, and notification metrics are omitted until real data sources exist.</p>
  </div>;
}
