import { redirect } from "next/navigation";
import { WORKOUTS_HREF } from "@/components/home/home-panel";

/** The Planner went with the To-Do list; planned workouts are in Workouts. */
export default function PlannerPage() {
  redirect(WORKOUTS_HREF);
}
