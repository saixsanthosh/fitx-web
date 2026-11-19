import type { Metadata } from "next";
import { ActivityHome } from "@/components/activity/ActivityHome";
import { parseSportFilter } from "@/lib/activity/feed";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sport } = await searchParams;
  return <ActivityHome initialFilter={parseSportFilter(sport)} />;
}
