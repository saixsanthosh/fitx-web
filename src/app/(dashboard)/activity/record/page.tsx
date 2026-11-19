import type { Metadata } from "next";
import { ActivityRecorderScreen } from "@/components/activity/ActivityRecorderScreen";
import { isSport } from "@/lib/activity/types";

export const metadata: Metadata = { title: "Record activity" };

export default async function RecordActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sport } = await searchParams;
  return <ActivityRecorderScreen initialSport={isSport(sport) ? sport : null} />;
}
