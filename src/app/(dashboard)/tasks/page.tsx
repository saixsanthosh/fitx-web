import { redirect } from "next/navigation";
import { HOME_HREF } from "@/components/home/home-panel";

/** The To-Do list was removed from FITX (its stored rows stay in the data export); the old address opens Home. */
export default function TasksPage() {
  redirect(HOME_HREF);
}
