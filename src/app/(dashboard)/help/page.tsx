import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/app/PageHeading";
import { SupportForm } from "@/components/support/SupportForm";
import { SUPPORT_CATEGORIES, type SupportCategory } from "@/components/support/support-rules";
import { SupportThreads, type SupportThreadView } from "@/components/support/SupportThreads";
import { BRAND } from "@/config/brand";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Help" };

type RequestRow = { id: string; category: string; subject: string; body: string; status: string; created_at: string };
type MessageRow = { id: string; request_id: string; author_kind: string; body: string; created_at: string };

/** PostgREST and Postgres codes for a table that does not exist yet (the support migration is not applied). */
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const supabase = await createClient();
  const { from } = await searchParams;
  const unavailable = (
    <p className="fitx-alert">
      Messages from this page are not switched on yet. Until then, email <a className="fitx-alert-action ml-0" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
    </p>
  );

  if (!supabase) {
    return <div className="mx-auto max-w-3xl space-y-5"><PageHeading title="Help and feedback" />{unavailable}</div>;
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeading title="Help and feedback" description="Questions, problems and ideas go straight to the FITX team. Replies appear here." />
      {available ? <SupportForm fromPath={typeof from === "string" ? from : null} /> : unavailable}
      {requests.error && available && <p className="fitx-alert fitx-alert-danger">Your earlier messages could not be loaded right now. Please try again later.</p>}
      <SupportThreads threads={threads} canReply={available} />
    </div>
  );
}
