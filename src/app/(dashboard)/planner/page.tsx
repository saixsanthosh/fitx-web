import { redirect } from "next/navigation";

/** The Planner is now the Week tab of Goals. */
export default function PlannerPage() {
  redirect("/goals?tab=week");
}
