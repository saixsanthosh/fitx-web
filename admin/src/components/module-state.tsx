import { Activity, CircleAlert, ShieldCheck } from "lucide-react";

const messages = {
  service_key_missing: {
    title: "Server data access is not configured",
    body: "Add the server-only Supabase key to this environment. It is never sent to the browser.",
  },
  migration_pending: {
    title: "This needs a database update",
    body: "The tables or functions for this screen are not installed yet. No sample data is shown meanwhile.",
  },
  query_failed: {
    title: "The live data could not be loaded",
    body: "FITX Admin did not substitute placeholder records. Check the server logs (lines starting with [fitx-admin]) and database connectivity.",
  },
} as const;

export function ModuleState({ state, migration }: { state: "service_key_missing" | "migration_pending" | "query_failed"; migration?: string }) {
  const message = messages[state];
  const Icon = state === "query_failed" ? CircleAlert : state === "migration_pending" ? ShieldCheck : Activity;
  return (
    <section className="module-state" role="status">
      <span className="module-state-icon"><Icon aria-hidden="true" size={19} /></span>
      <div>
        <p className="eyebrow">LIVE DATA CONNECTION</p>
        <h2>{message.title}</h2>
        <p>{message.body}</p>
        {state === "migration_pending" && migration && <p>Apply migration <code>{migration}</code> (listed in admin/README.md).</p>}
      </div>
    </section>
  );
}
