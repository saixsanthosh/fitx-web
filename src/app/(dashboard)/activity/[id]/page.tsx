import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityDetailScreen } from "@/components/activity/ActivityDetailScreen";

export const metadata: Metadata = { title: "Activity" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A saved activity's id, or "local-" + the device id of one not uploaded yet. */
const ACTIVITY_ID = new RegExp(`^(?:local-)?${UUID}$`, "i");

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ACTIVITY_ID.test(id)) notFound();
  return <ActivityDetailScreen id={id.toLowerCase()} />;
}
