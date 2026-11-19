import type { Metadata } from "next";
import { SportScreen } from "@/components/activity/SportScreen";

export const metadata: Metadata = { title: "Ride" };

export default function RidePage() {
  return <SportScreen sport="ride" />;
}
