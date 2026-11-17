import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SessionRecordScreen } from "@/components/session/SessionRecordScreen";

export const metadata: Metadata = { title: "Workout record" };

/** workout_sessions ids are UUIDs; anything else is not a workout. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One workout's record: totals, the muscles it trained, every exercise with its sets (see SessionRecordScreen). */
export default async function WorkoutRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SESSION_ID.test(id)) notFound();
  return <SessionRecordScreen id={id.toLowerCase()} />;
}
