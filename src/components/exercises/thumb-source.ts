import { resolveExerciseMedia, type ExerciseMedia, type ExerciseMediaRow } from "@/lib/training/media";

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
};

/** The first still of an exercise (table media, else the pinned Free Exercise DB photo), or null when it has none. */
export function thumbSource(input: ThumbSourceInput): { url: string; alt: string } | null {
  if (input.src) return { url: input.src, alt: `${input.name}, photo` };
  const media = input.media ?? resolveExerciseMedia({ exerciseId: input.exerciseId, name: input.name, sourceRef: input.sourceRef, rows: input.rows, supabaseUrl: input.supabaseUrl });
  const first = media.stills[0];
  return first ? { url: first.url, alt: first.alt } : null;
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
