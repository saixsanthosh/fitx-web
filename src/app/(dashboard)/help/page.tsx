import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AtSign, Mail, PauseCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SupportForm } from "@/components/support/SupportForm";
import { helpCategories, SUPPORT_CATEGORIES, type SupportCategory } from "@/components/support/support-rules";
import { SupportThreads, type SupportThreadView } from "@/components/support/SupportThreads";
import { loadPlatformSettings } from "@/lib/platform/gate";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help" };

type RequestRow = { id: string; category: string; subject: string; body: string; status: string; created_at: string };
type MessageRow = { id: string; request_id: string; author_kind: string; body: string; created_at: string };

/** PostgREST and Postgres codes for a table that does not exist yet (the support migration is not applied). */
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

function Contact({ email, instagram }: { email: string; instagram: string }) {
  const handle = instagram.replace(/^https:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
  const row = "flex min-h-12 items-center gap-3 rounded-xl border border-fitx-border bg-fitx-surface px-4 text-sm font-medium text-fitx-text transition-colors hover:border-fitx-primary";
  return (
    <section aria-labelledby="help-contact-title" className="space-y-2">
      <h2 id="help-contact-title" className="text-xs font-semibold uppercase tracking-[.16em] text-fitx-text-secondary">Other ways</h2>
      <a className={row} href={`mailto:${email}`}><Mail aria-hidden="true" size={17} className="shrink-0 text-fitx-primary-text" /><span className="min-w-0 break-all">{email}</span></a>
      <a className={row} href={instagram} target="_blank" rel="noopener noreferrer"><AtSign aria-hidden="true" size={17} className="shrink-0 text-fitx-primary-text" /><span className="min-w-0 break-all">{handle || "Instagram"}</span></a>
    </section>
  );
}

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const supabase = await createClient();
  const { from } = await searchParams;
  const platform = await loadPlatformSettings();
  const { site, features } = platform.settings;
  const unavailable = (
    <p className="fitx-alert">
      Messages from this page are not switched on yet. Until then, email <a className="fitx-alert-action ml-0" href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>.
    </p>
  );

  if (!supabase) {
    return <div className="mx-auto max-w-5xl space-y-5"><PageHeader eyebrow="Support" title="Help and feedback" />{unavailable}</div>;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=%2Fhelp");

  // Row-level security returns only this person's own requests and messages.
  const requests = await supabase
    .from("support_requests")
    .select("id,category,subject,body,status,created_at")
    .order("last_message_at", { ascending: false })
    .limit(20);
  const available = !requests.error || !MISSING_TABLE.has(requests.error.code ?? "");
  const rows = (requests.data ?? []) as RequestRow[];

  let messages: MessageRow[] = [];
  if (rows.length) {
    const result = await supabase
      .from("support_messages")
      .select("id,request_id,author_kind,body,created_at")
      .in("request_id", rows.map((row) => row.id))
      .order("created_at", { ascending: true });
    messages = (result.data ?? []) as MessageRow[];
  }

  const threads: SupportThreadView[] = rows.map((row) => ({
    id: row.id,
    category: (SUPPORT_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as SupportCategory) : "other",
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    messages: messages
      .filter((message) => message.request_id === row.id)
      .map((message) => ({ id: message.id, fromTeam: message.author_kind === "staff", body: message.body, createdAt: message.created_at })),
  }));

  // Messages can be paused from FITX Admin (Settings); the conversations stay readable.
  const paused = !features.support;
  const open = available && !paused;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Support" title="Help and feedback" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-5">
          {open ? (
            <SupportForm fromPath={typeof from === "string" ? from : null} categories={helpCategories(platform.source === "database")} />
          ) : paused ? (
            <p className="fitx-alert flex items-start gap-2"><PauseCircle aria-hidden="true" size={18} className="mt-0.5 shrink-0" />New messages are paused for now. Email us instead.</p>
          ) : unavailable}
          <Contact email={site.supportEmail} instagram={site.instagramUrl} />
        </div>
        <div className="space-y-4">
          {requests.error && available && <p className="fitx-alert fitx-alert-danger">Your earlier messages could not be loaded right now. Please try again later.</p>}
          {threads.length ? <SupportThreads threads={threads} canReply={open} /> : (
            <section className="rounded-2xl border border-dashed border-fitx-border p-6 text-center">
              <h2 className="text-base font-semibold text-fitx-text">No messages yet</h2>
              <p className="mt-1 text-sm text-fitx-text-secondary">Replies from the team show here.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
