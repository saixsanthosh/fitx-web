import type { Metadata } from "next";
import { Suspense } from "react";
import { Info, ScanLine, ShieldCheck } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { ExercisePicker } from "./ExercisePicker";
import { FormCoachPractice } from "./FormCoachPractice";

export const metadata: Metadata = { title: "Home workout" };

const FACTS = [
  {
    icon: ShieldCheck,
    title: "Stays on your device",
    body: "Pose detection runs in your browser with Google's open-source MediaPipe model. The video is never uploaded or recorded, and practice results aren't saved.",
  },
  {
    icon: ScanLine,
    title: "One 2D camera view",
    body: "A single camera sees you from one side. It can't judge depth, knee direction or hand placement well, and it can be wrong in poor light or loose clothing. Treat counts as a helper.",
  },
  {
    icon: Info,
    title: "Not medical advice",
    body: "Cues are general technique pointers, not a diagnosis. Stop if anything hurts, and ask a qualified coach or physiotherapist if you're unsure.",
  },
] as const;

export default function HomeWorkoutPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Home workout"
        description="Count reps and get posture cues from your camera for six bodyweight exercises. It all runs on this device."
      />
      <Suspense fallback={<ExercisePicker />}>
        <FormCoachPractice />
      </Suspense>
      <section aria-label="How the form coach works" className="mt-8 grid gap-3 md:grid-cols-3">
        {FACTS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-fitx-border bg-fitx-surface p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-fitx-text">
              <Icon size={16} className="text-fitx-primary" aria-hidden="true" />
              {title}
            </p>
            <p className="mt-1.5 text-sm leading-6 text-fitx-text-secondary">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
