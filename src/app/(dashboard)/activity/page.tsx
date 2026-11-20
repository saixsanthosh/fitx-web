import type { Metadata } from "next";
import { connection } from "next/server";
import { ActivityHome } from "@/components/activity/ActivityHome";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  // Rendered per request, so ActivityHome reads ?sport= from the address on the server as well.
  await connection();
  return <ActivityHome />;
}
