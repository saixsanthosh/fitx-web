import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ExerciseGlyph } from "@/components/form-coach/ExerciseGlyph";
import { EXERCISE_RULES } from "@/lib/form-rules/catalog";

/** The six exercises the camera can coach. Plain links, so it renders on the server too. */
export function ExercisePicker() {
  return (
    <section aria-labelledby="coach-pick-title">
      <h2 id="coach-pick-title" className="text-sm font-semibold text-fitx-text">Choose an exercise</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {EXERCISE_RULES.map((rule) => (
          <li key={rule.id}>
            <Link
              href={`/form-coach?exercise=${rule.id}`}
              scroll={false}
              className="fitx-panel group flex h-full items-start gap-4 p-4 hover:border-fitx-primary/50 focus-visible:border-fitx-primary/60"
            >
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-fitx-surface-variant text-fitx-primary">
                <ExerciseGlyph id={rule.id} className="h-10 w-10" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold tracking-tight text-fitx-text">{rule.name}</span>
                  <ChevronRight size={17} className="shrink-0 text-fitx-text-disabled transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  <Chip>{rule.view === "side" ? "Side-on to camera" : "Facing camera"}</Chip>
                  <Chip>{rule.motion.kind === "hold" ? "Timed hold" : "Rep count"}</Chip>
                </span>
                <span className="mt-2 block text-sm leading-6 text-fitx-text-secondary">{rule.checks}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-fitx-surface-variant px-2 py-0.5 text-[11px] font-medium text-fitx-text-secondary">{children}</span>;
}
