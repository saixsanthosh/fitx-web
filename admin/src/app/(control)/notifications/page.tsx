import { redirect } from "next/navigation";

/** The old Notifications screen became Announcements; bookmarks keep working. */
export default function NotificationsPage() {
  redirect("/announcements");
}
