import type { Metadata } from "next";
import { Suspense } from "react";
import { ExercisePicker } from "./ExercisePicker";
import { FormCheckFacts } from "./FormCheckFacts";
import { FormCheckApp } from "./FormCheckApp";
import { FormCheckHero } from "./FormCheckHero";

export const metadata: Metadata = { title: "Home workout" };

export default function HomeWorkoutPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense
        fallback={
          <div className="space-y-6 sm:space-y-8">
            <FormCheckHero />
            <FormCheckFacts />
            <ExercisePicker />
          </div>
        }
      >
        <FormCheckApp />
      </Suspense>
    </div>
  );
}
