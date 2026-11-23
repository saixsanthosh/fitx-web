import type { Metadata } from "next";
import { SettingsView } from "@/components/social/SettingsView";

export const metadata: Metadata = { title: "Settings" };

export default function ExploreSettingsPage() {
  return <SettingsView />;
}
