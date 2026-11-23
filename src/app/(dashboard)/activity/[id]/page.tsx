import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityDetailScreen } from "@/components/activity/ActivityDetailScreen";
import { SportScreen } from "@/components/activity/SportScreen";
import { SPORT_INFO, sportFromSlug } from "@/lib/activity/config";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** A saved activity's id, or "local-" + the device id of one not uploaded yet. */
const ACTIVITY_ID = new RegExp(`^(?:local-)?${UUID}$`, "i");

/*
 * /activity/<id> is an activity; /activity/<sport slug> (hike, trail-run, mountain-bike…) is that sport's page.
 * Walk, run and ride keep their own folders. Ids are UUIDs, so the two never collide.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const sport = sportFromSlug(id);
  return { title: sport ? SPORT_INFO[sport].plural : "Activity" };
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sport = sportFromSlug(id);
  if (sport) return <SportScreen sport={sport} />;
  if (!ACTIVITY_ID.test(id)) notFound();
  return <ActivityDetailScreen id={id.toLowerCase()} />;
}
