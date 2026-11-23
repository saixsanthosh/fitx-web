import { demoCoverFrame, resolveExerciseMedia, withDemoMedia, type DemoIndex, type DemoModelKey, type ExerciseMedia, type ExerciseMediaRow } from "@/lib/training/media";

export type ThumbSourceInput = {
  exerciseId: string;
  name: string;
  /** The exercise's first photo when the caller already has it (e.g. from GET /api/exercises). */
  src?: string | null;
  sourceRef?: string | null;
  /** exercise_media rows; null when the table could not be read. */
  rows?: readonly ExerciseMediaRow[] | null;
  /** Resolved media, when the caller has it. */
  media?: ExerciseMedia;
  supabaseUrl?: string | null;
  /** The demonstration index and the member's model (useDemoIndexData, useDemoModel), when the page has them. */
  demo?: { index: DemoIndex | null; model: DemoModelKey | null } | null;
};

/**
 * The first still of an exercise, or null when it has none: the member's own demonstration model's start frame when
 * the demonstration index lists one, else the given photo, else table media or the pinned Free Exercise DB photo (with
 * a demonstration only when nothing else shows the exercise).
 */
export function thumbSource(input: ThumbSourceInput): { url: string; alt: string; aiDemo: boolean } | null {
  const frame = demoCoverFrame(input.demo?.index, input.exerciseId, input.demo?.model ?? null);
  if (frame) return { url: frame, alt: `${input.name}, AI demonstration`, aiDemo: true };
  if (input.src) return { url: input.src, alt: `${input.name}, photo`, aiDemo: false };
  const base = input.media ?? resolveExerciseMedia({ exerciseId: input.exerciseId, name: input.name, sourceRef: input.sourceRef, rows: input.rows, supabaseUrl: input.supabaseUrl });
  const media = input.demo ? withDemoMedia(base, { exerciseId: input.exerciseId, name: input.name, index: input.demo.index, model: input.demo.model }) : base;
  const first = media.stills[0];
  return first ? { url: first.url, alt: first.alt, aiDemo: Boolean(first.aiDemo) } : null;
}

/** Up to two capital letters from an exercise name, for the no-photo fallback. */
export function exerciseInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

export const THUMB_SIZES = { sm: 40, md: 64, lg: 120 } as const;
export type ThumbSize = keyof typeof THUMB_SIZES;
