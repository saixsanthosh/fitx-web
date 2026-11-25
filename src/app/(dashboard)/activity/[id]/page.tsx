import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityDetailScreen } from "@/components/activity/ActivityDetailScreen";
import { SportScreen } from "@/components/activity/SportScreen";
import { activityRoute, activityRouteTitle } from "@/lib/activity/route";

/*
 * /activity/<id> is an activity; /activity/<sport slug> (hike, trail-run, mountain-bike…) is that sport's page.
 * Walk, run and ride keep their own folders. Any other address is not found, in its title too ("Page not
 * found", never "Activity"), so the metadata calls notFound() as the page does.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const route = activityRoute((await params).id);
  if (!route) notFound();
  return { title: activityRouteTitle(route) };
}

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const route = activityRoute((await params).id);
  if (!route) notFound();
  if (route.kind === "sport") return <SportScreen sport={route.sport} />;
  return <ActivityDetailScreen id={route.id} />;
}
