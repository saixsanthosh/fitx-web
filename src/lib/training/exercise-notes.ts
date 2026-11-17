/**
 * The member's private note on an exercise ("seat on 4, pin at 7"): one per exercise, at most 500 characters,
 * in public.exercise_notes (migration 20261119100010_fitx_exercise_notes.sql, owner-only row level security).
 *
 * Feature-detected: until that migration is applied the table is missing, every call answers "unavailable" and
 * the page hides the note box. Reads and writes use the member's own session. A merged duplicate's id is never
 * stored: the page opens the exercise it was merged into, and notes are saved under that id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/domain/schema-fallback";

type Db = Pick<SupabaseClient, "from">;

/** The database allows 1 to 500 characters (char_length, so an emoji counts once). */
export const NOTE_MAX_CHARS = 500;

export type ExerciseNote = { body: string; updatedAt: string | null };

/**
 * The text as it is stored: Windows line ends normalised, control characters other than tab and newline removed
 * (Postgres text cannot hold NUL), trailing spaces of each line and blank lines at either end trimmed.
 */
export function tidyNote(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** Characters as Postgres char_length counts them (code points). */
export function noteLength(text: string): number {
  return Array.from(text).length;
}

export type NoteCheck = { kind: "empty" } | { kind: "ok"; body: string } | { kind: "too_long"; length: number };

/** Whether the text can be saved: empty (saving removes the note), within the limit, or too long. */
export function checkNote(text: string): NoteCheck {
  const body = tidyNote(text);
  if (!body) return { kind: "empty" };
  const length = noteLength(body);
  return length > NOTE_MAX_CHARS ? { kind: "too_long", length } : { kind: "ok", body };
}

export type NoteLoad =
  /** The table is not in the database yet: hide the note box. */
  | { status: "unavailable" }
  | { status: "ready"; note: ExerciseNote | null }
  | { status: "error"; error: unknown };

export type NoteWrite =
  | { status: "saved"; note: ExerciseNote | null }
  | { status: "unavailable" }
  | { status: "too_long"; length: number }
  | { status: "error"; error: unknown };

type NoteRow = { body?: unknown; updated_at?: unknown };

function noteFrom(row: NoteRow | null | undefined): ExerciseNote | null {
  if (!row || typeof row.body !== "string" || !row.body) return null;
  return { body: row.body, updatedAt: typeof row.updated_at === "string" ? row.updated_at : null };
}

/** The member's note on the exercise, null when there is none. */
export async function loadExerciseNote(db: Db, userId: string, exerciseId: string): Promise<NoteLoad> {
  try {
    const result = await db.from("exercise_notes").select("body,updated_at").eq("user_id", userId).eq("exercise_id", exerciseId).maybeSingle();
    if (result.error) return isMissingTableError(result.error) ? { status: "unavailable" } : { status: "error", error: result.error };
    return { status: "ready", note: noteFrom(result.data as NoteRow | null) };
  } catch (error) {
    return { status: "error", error };
  }
}

/** Removes the member's note on the exercise (nothing happens when there is none). */
export async function deleteExerciseNote(db: Db, userId: string, exerciseId: string): Promise<NoteWrite> {
  try {
    const result = await db.from("exercise_notes").delete().eq("user_id", userId).eq("exercise_id", exerciseId);
    if (result.error) return isMissingTableError(result.error) ? { status: "unavailable" } : { status: "error", error: result.error };
    return { status: "saved", note: null };
  } catch (error) {
    return { status: "error", error };
  }
}

/**
 * Saves the note (one per member and exercise: a second save replaces it). Empty text removes the note; text
 * over the limit is refused before any request.
 */
export async function saveExerciseNote(db: Db, userId: string, exerciseId: string, text: string, now: Date = new Date()): Promise<NoteWrite> {
  const checked = checkNote(text);
  if (checked.kind === "empty") return deleteExerciseNote(db, userId, exerciseId);
  if (checked.kind === "too_long") return { status: "too_long", length: checked.length };
  try {
    const result = await db.from("exercise_notes")
      .upsert({ user_id: userId, exercise_id: exerciseId, body: checked.body, updated_at: now.toISOString() }, { onConflict: "user_id,exercise_id" })
      .select("body,updated_at")
      .single();
    if (result.error) return isMissingTableError(result.error) ? { status: "unavailable" } : { status: "error", error: result.error };
    return { status: "saved", note: noteFrom(result.data as NoteRow | null) ?? { body: checked.body, updatedAt: now.toISOString() } };
  } catch (error) {
    return { status: "error", error };
  }
}
