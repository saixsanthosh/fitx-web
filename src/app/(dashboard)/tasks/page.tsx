import { redirect } from "next/navigation";
import { homePanel } from "@/config/routes";

/** Tasks live in the To-Do list on Home. */
export default function TasksPage() {
  redirect(homePanel("todo"));
}
