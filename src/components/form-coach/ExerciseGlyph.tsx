import type { ExerciseId } from "@/lib/form-rules/types";

/** Line pictograms of each camera exercise, drawn side-on (or facing, for jumping jacks). */
const PATHS: Record<ExerciseId, React.ReactNode> = {
  push_up: (
    <>
      <circle cx="38" cy="19.5" r="3" />
      <path d="M33.5 23 8 32M33.5 23v12M4 36.5h40" />
    </>
  ),
  bodyweight_squat: (
    <>
      <circle cx="26.5" cy="8.5" r="3" />
      <path d="M24.5 12.5 16 25l12 2-3 11M24 15.5l12 1.5M6 40h36" />
    </>
  ),
  split_squat: (
    <>
      <circle cx="24" cy="7.5" r="3" />
      <path d="M24 11.5V24l9 2v12M24 24l-7 11-9 2M22 15l-3 9M6 40h36" />
    </>
  ),
  glute_bridge: (
    <>
      <circle cx="6.5" cy="31.5" r="3" />
      <path d="M10.5 34 24 26.5l10.5-4.5 2 14M10.5 35.5h10M4 38h40" />
    </>
  ),
  plank: (
    <>
      <circle cx="39" cy="22.5" r="3" />
      <path d="M34 26.5 8 33.5M34 26.5v8.5h8M4 37h40" />
    </>
  ),
  jumping_jack: (
    <>
      <circle cx="24" cy="7.5" r="3" />
      <path d="M24 11.5v13.5M24 14l-10-9M24 14l10-9M24 25l-9 15M24 25l9 15" />
    </>
  ),
};

export function ExerciseGlyph({ id, className }: { id: ExerciseId; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      {PATHS[id]}
    </svg>
  );
}
