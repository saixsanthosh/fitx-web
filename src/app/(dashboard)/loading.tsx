/** Shown inside the app shell while a section's code and data load. Quiet, and still on low-power devices. */
export default function DashboardLoading() {
  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="animate-pulse space-y-5" aria-hidden="true">
        <div className="space-y-2">
          <div className="h-8 w-48 rounded-lg bg-fitx-surface-variant sm:w-64" />
          <div className="h-4 w-72 max-w-full rounded-md bg-fitx-surface-variant" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-52 rounded-2xl border border-fitx-border bg-fitx-card" />
          <div className="h-52 rounded-2xl border border-fitx-border bg-fitx-card" />
        </div>
        <div className="h-40 rounded-2xl border border-fitx-border bg-fitx-card" />
      </div>
    </div>
  );
}
