import type { Metadata } from "next";
import { WorkoutHistoryScreen } from "@/components/session/WorkoutHistoryScreen";

export const metadata: Metadata = { title: "Workout history" };

/** Every finished and abandoned workout, newest first (see WorkoutHistoryScreen). */
export default function WorkoutHistoryPage() {
  return <WorkoutHistoryScreen />;
}
