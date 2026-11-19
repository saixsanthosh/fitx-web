import { redirect } from "next/navigation";
import { homePanel } from "@/config/routes";

/** The Planner is the week plan on Home. */
export default function PlannerPage() {
  redirect(homePanel("week"));
}
