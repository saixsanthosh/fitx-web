import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { CoachApp } from "@/components/coach/CoachApp";
import { CoachUnavailable } from "@/components/coach/CoachUnavailable";
import { readAiConfig } from "@/lib/ai/config";
import { coachStatus, type CoachStatus } from "@/lib/ai/status";
import type { Db } from "@/lib/ai/store";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "AI Coach" };

export default async function AiCoachPage() {
  const supabase = await createClient();
  const heading = <PageHeader title="AI Coach" className="mb-4 sm:mb-6" />;
  if (!supabase) {
    return <div className="mx-auto max-w-[1180px]">{heading}<CoachUnavailable state="not_available" /></div>;
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/signin?next=%2Fai-coach");

  let status: CoachStatus | null = null;
  try {
    status = await coachStatus(supabase as Db, data.user.id, readAiConfig());
  } catch (error) {
    console.error("[fitx-coach] status failed", error instanceof Error ? error.name : "unknown");
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      {heading}
      {status ? <CoachApp initialStatus={status} /> : <CoachUnavailable state="failed" />}
    </div>
  );
}
