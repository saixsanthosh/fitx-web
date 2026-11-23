import { permanentRedirect } from "next/navigation";
import { legacyFormCheckTarget } from "@/lib/home-workout/route";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Home workout is now AI Form Check: /home-workout[?exercise=x] moves to /workouts/form-check[?exercise=x] (308). */
export default async function HomeWorkoutRedirect({ searchParams }: { searchParams: SearchParams }) {
  permanentRedirect(legacyFormCheckTarget(await searchParams));
}
