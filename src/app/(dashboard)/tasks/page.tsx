import { redirect } from "next/navigation";

/** Tasks live in the To-Do list on the Today tab of Goals. */
export default function TasksPage() {
  redirect("/goals?tab=today");
}
