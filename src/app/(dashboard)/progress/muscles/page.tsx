import type { Metadata } from "next";
import { isRegionKey } from "@/lib/training/anatomy";
import { parseMusclePeriod } from "@/lib/training/muscle-history";
import { MuscleAnalytics } from "./MuscleAnalytics";

export const metadata: Metadata = { title: "Muscles" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /progress/muscles?period=today|week|four_weeks|all&muscle=<region>: which muscles the member's logged sets worked. */
export default async function MusclesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const period = parseMusclePeriod(typeof params.period === "string" ? params.period : null, "week");
  const muscle = typeof params.muscle === "string" && isRegionKey(params.muscle) ? params.muscle : null;
  return <MuscleAnalytics initialPeriod={period} initialMuscle={muscle} />;
}
