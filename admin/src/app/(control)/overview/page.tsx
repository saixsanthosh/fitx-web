import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowUpRight, CircleHelp, Dumbbell, LogIn, Users, Utensils } from "lucide-react";
import { ModuleState } from "@/components/module-state";
import { CountUp } from "@/components/motion/count-up";
import { requireAdmin } from "@/lib/admin-auth";
import { getPlatformMetrics, getSupportCounts, type MetricKey } from "@/lib/data/metrics";
import { can } from "@/lib/roles";
import { MIGRATIONS } from "@/lib/schema";
import { formatIstDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Overview" };

type Tile = { key: MetricKey; label: string };

const GROUPS: Array<{ title: string; icon: typeof Users; definition: string; tiles: Tile[] }> = [
  {
    title: "Accounts",
    icon: Users,
    definition: "FITX sign-ups that are not deleted or anonymous. Admin team accounts are left out of every number on this page.",
    tiles: [
      { key: "accounts", label: "Registered accounts" },
      { key: "confirmed_accounts", label: "With a confirmed email" },
      { key: "new_accounts_7d", label: "New in the last 7 days" },
      { key: "new_accounts_30d", label: "New in the last 30 days" },
    ],
  },
  {
    title: "Signed in (from Supabase Auth)",
    icon: LogIn,
    definition: "Accounts whose most recent fresh sign-in falls in the window. Staying signed in does not count as a new sign-in, so regular users are undercounted here.",
    tiles: [
      { key: "signed_in_24h", label: "Last 24 hours" },
      { key: "signed_in_7d", label: "Last 7 days" },
      { key: "signed_in_30d", label: "Last 30 days" },
    ],
  },
  {
    title: "Active (from app activity)",
    icon: Activity,
    definition: "Accounts that logged a workout, workout set, meal, water entry, body measurement or goal progress in the window. Signing in alone does not count.",
    tiles: [
      { key: "active_24h", label: "Last 24 hours" },
      { key: "active_7d", label: "Last 7 days" },
      { key: "active_30d", label: "Last 30 days" },
    ],
  },
  {
    title: "Training and nutrition volume",
    icon: Dumbbell,
    definition: "Completed workout sessions (by the day they started), meal entries, and exercises published in the library.",
    tiles: [
      { key: "workouts_completed_7d", label: "Workouts completed, 7 days" },
      { key: "workouts_completed_30d", label: "Workouts completed, 30 days" },
      { key: "meals_logged_7d", label: "Meals logged, 7 days" },
      { key: "meals_logged_30d", label: "Meals logged, 30 days" },
      { key: "published_exercises", label: "Published exercises" },
    ],
  },
];

const LEGACY_TILES = [
  { key: "registered_users", label: "Registered users", note: "All Auth accounts, including unconfirmed and Admin team accounts" },
  { key: "active_users_30d", label: "Signed in, 30 days", note: "Fresh sign-ins only; staying signed in does not count" },
  { key: "completed_workouts_30d", label: "Completed workouts", note: "Last 30 days" },
  { key: "active_exercises", label: "Published exercises", note: "Active library entries" },
  { key: "food_logs_30d", label: "Meal logs", note: "Last 30 days, by meal date" },
] as const;

export default async function OverviewPage() {
  const admin = await requireAdmin("overview.view");
  const [result, supportCounts] = await Promise.all([
    getPlatformMetrics(),
    can(admin.role, "support.view") ? getSupportCounts() : Promise.resolve(null),
  ]);
  const needsAttention = supportCounts ? (supportCounts.open ?? 0) + (supportCounts.in_progress ?? 0) + (supportCounts.waiting_on_user ?? 0) : null;

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div><p className="eyebrow">FITX / OPERATIONS</p><h1>Platform overview</h1><p className="page-lede">Live counts from the FITX database. Each number says exactly what it counts.</p></div>
        <div className="date-stamp">{result.state === "ready" && result.metrics.generated_at ? `UPDATED ${formatIstDateTime(result.metrics.generated_at)?.toUpperCase()}` : "PRIVATE ADMIN WORKSPACE"}</div>
      </div>

      {needsAttention !== null && (
        <Link className="attention-banner" href="/support"><CircleHelp aria-hidden="true" size={18} /><span><strong>{needsAttention.toLocaleString("en-IN")}</strong> help requests need attention ({(supportCounts?.open ?? 0).toLocaleString("en-IN")} not yet answered)</span><ArrowUpRight aria-hidden="true" size={16} /></Link>
      )}

      {result.state === "ready" ? GROUPS.map((group) => (
        <section className="metric-section" key={group.title} aria-label={group.title}>
          <div className="metric-section-heading"><group.icon aria-hidden="true" size={17} /><h2>{group.title}</h2></div>
          <p className="metric-definition">{group.definition}</p>
          <div className="metric-grid">
            {group.tiles.map((tile) => (
              <article className="metric-panel" key={tile.key}>
                <p className="metric-value"><CountUp value={result.metrics[tile.key]} /></p>
                <h3>{tile.label}</h3>
              </article>
            ))}
          </div>
        </section>
      )) : result.state === "legacy" ? (
        <>
          <p className="inline-notice notice-error" role="status">These are the original five counts. Apply migration <code>{MIGRATIONS.metrics}</code> for the defined metrics above, which leave out Admin team accounts and measure real activity.</p>
          <section className="metric-grid" aria-label="Original platform counts">
            {LEGACY_TILES.map((tile) => (
              <article className="metric-panel" key={tile.key}>
                <div className="metric-top"><Utensils aria-hidden="true" size={17} /><span>{tile.note}</span></div>
                <p className="metric-value"><CountUp value={result.metrics[tile.key]} /></p>
                <h3>{tile.label}</h3>
              </article>
            ))}
          </section>
        </>
      ) : <ModuleState state={result.state} migration={MIGRATIONS.metrics} />}

      {can(admin.role, "reports.view") && <Link className="text-link" href="/reports">Daily trends in Reports <ArrowUpRight aria-hidden="true" size={15} /></Link>}
      <p className="privacy-note">Counts only. Billing and refunds are not shown because FITX has no payment records yet.</p>
    </div>
  );
}
