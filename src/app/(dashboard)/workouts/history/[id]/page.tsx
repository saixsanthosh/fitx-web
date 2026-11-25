import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SessionRecordScreen } from "@/components/session/SessionRecordScreen";

/** workout_sessions ids are UUIDs; anything else is not a workout. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Workout record", and for an address that is not a workout the not-found page's own title (bug 78, D3). */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: SESSION_ID.test(id) ? "Workout record" : "Page not found" };
}

/** One workout's record: totals, the muscles it trained, every exercise with its sets (see SessionRecordScreen). */
export default async function WorkoutRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SESSION_ID.test(id)) notFound();
  return <SessionRecordScreen id={id.toLowerCase()} />;
}
