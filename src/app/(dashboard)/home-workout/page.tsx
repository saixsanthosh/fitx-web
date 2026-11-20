import type { Metadata } from "next";
import { Suspense } from "react";
import { ExercisePicker } from "./ExercisePicker";
import { HomeFacts } from "./HomeFacts";
import { HomeWorkoutApp } from "./HomeWorkoutApp";
import { HomeWorkoutHero } from "./HomeWorkoutHero";

export const metadata: Metadata = { title: "Home workout" };

export default function HomeWorkoutPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense
        fallback={
          <div className="space-y-6 sm:space-y-8">
            <HomeWorkoutHero />
            <HomeFacts />
            <ExercisePicker />
          </div>
        }
      >
        <HomeWorkoutApp />
      </Suspense>
    </div>
  );
}
