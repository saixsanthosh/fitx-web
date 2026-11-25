"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  NOTE_MAX_CHARS, checkNote, deleteExerciseNote, noteLength, saveExerciseNote, tidyNote, type ExerciseNote as Note, type NoteLoad, type NoteWrite,
} from "@/lib/training/exercise-notes";

type ExerciseNoteProps = {
  userId: string;
  exerciseId: string;
  exerciseName: string;
  /** The note as loaded: null while it loads. "unavailable" (no notes table yet) renders nothing. */
  load: NoteLoad | null;
  /** Called after a save or delete with the new state, and with "unavailable" if the table has gone. */
  onChange: (load: NoteLoad) => void;
  onRetry: () => void;
};

type Status = { tone: "success" | "danger"; text: string } | null;

const FAILED = "Your note couldn’t be saved. Check your connection and try again.";

/**
 * The member's private note on the exercise (one per exercise, up to 500 characters). Hidden until the notes
 * table exists. Explicit Save, Cancel and Delete (with a confirmation step); nothing saves on its own.
 */
export function ExerciseNote({ userId, exerciseId, exerciseName, load, onChange, onRetry }: ExerciseNoteProps) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  /** Set when the editor closes, so focus goes back to the button that opens it (rendered again by then). */
  const returnFocus = useRef(false);
  const askDelete = useRef<HTMLButtonElement>(null);
  const confirmDeleteButton = useRef<HTMLButtonElement>(null);
  /** Set by "Keep it", so focus goes back to the Delete button once the confirmation closes. */
  const backToDelete = useRef(false);

  useEffect(() => {
    if (editing) field.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [editing]);

  // The confirmation replaces the buttons that held focus: move focus into it, and back to Delete on "Keep it".
  useEffect(() => {
    if (confirmDelete) confirmDeleteButton.current?.focus();
    else if (backToDelete.current) {
      backToDelete.current = false;
      askDelete.current?.focus();
    }
  }, [confirmDelete]);

  if (load?.status === "unavailable") return null;

  const note: Note | null = load?.status === "ready" ? load.note : null;
  const length = noteLength(tidyNote(draft));
  const over = length > NOTE_MAX_CHARS;
  const unchanged = tidyNote(draft) === (note?.body ?? "");

  function startEditing() {
    setDraft(note?.body ?? "");
    setStatus(null);
    setConfirmDelete(false);
    setEditing(true);
  }

  function keepNote() {
    if (busy) return;
    backToDelete.current = true;
    setConfirmDelete(false);
  }

  function stopEditing() {
    if (busy) return;
    returnFocus.current = true;
    backToDelete.current = false;
    setEditing(false);
    setConfirmDelete(false);
  }

  function finish(result: NoteWrite, done: string) {
    if (result.status === "saved") {
      onChange({ status: "ready", note: result.note });
      setStatus({ tone: "success", text: result.note ? done : "Note removed." });
      stopEditing();
    } else if (result.status === "unavailable") {
      onChange({ status: "unavailable" });
    } else if (result.status === "too_long") {
      setStatus({ tone: "danger", text: `Notes can be up to ${NOTE_MAX_CHARS} characters. This one has ${result.length}.` });
    } else {
      setStatus({ tone: "danger", text: FAILED });
    }
  }

  async function save() {
    const supabase = createClient();
    if (!supabase || busy) return;
    const checked = checkNote(draft);
    if (checked.kind === "too_long") {
      setStatus({ tone: "danger", text: `Notes can be up to ${NOTE_MAX_CHARS} characters. This one has ${checked.length}.` });
      return;
    }
    setBusy("save");
    setStatus(null);
    const result = await saveExerciseNote(supabase, userId, exerciseId, draft);
    setBusy(null);
    finish(result, "Note saved. Only you can see it.");
  }

  async function remove() {
    const supabase = createClient();
    if (!supabase || busy) return;
    setBusy("delete");
    setStatus(null);
    const result = await deleteExerciseNote(supabase, userId, exerciseId);
    setBusy(null);
    finish(result, "Note removed.");
  }

  return (
    <section aria-labelledby={`${fieldId}-heading`} className="fitx-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${fieldId}-heading`} className="text-sm font-semibold text-fitx-text">Your note</h2>
        <span className="inline-flex items-center gap-1 text-[11px] text-fitx-text-secondary"><Lock size={12} aria-hidden="true" />Only you can see it</span>
      </div>

      {load === null && <p role="status" className="mt-3 h-10 animate-pulse rounded-md bg-fitx-surface-variant motion-reduce:animate-none"><span className="sr-only">Loading your note</span></p>}

      {load?.status === "error" && (
        <div className="mt-2 text-sm text-fitx-text-secondary">
          <p className="m-0">Your note couldn’t be loaded.</p>
          <button type="button" onClick={onRetry} className="mt-1 inline-flex min-h-11 items-center rounded-md px-1 text-sm font-semibold text-fitx-primary-text hover:underline">Try again</button>
        </div>
      )}

      {load?.status === "ready" && !editing && (
        note ? (
          <div className="mt-2">
            <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-fitx-text">{note.body}</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              {note.updatedAt && <p className="m-0 text-[11px] text-fitx-text-secondary">Updated {formatDay(note.updatedAt)}</p>}
              <button ref={opener} type="button" onClick={startEditing} aria-label={`Edit your note on ${exerciseName}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-fitx-primary-text hover:underline">
                <Pencil size={14} aria-hidden="true" />Edit
              </button>
            </div>
          </div>
        ) : (
          <button ref={opener} type="button" onClick={startEditing} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-fitx-border px-3 text-left text-sm text-fitx-text-secondary transition-colors hover:border-fitx-primary/45 hover:text-fitx-text motion-reduce:transition-none">
            <Plus size={16} aria-hidden="true" />Add a note, for example your seat or pin setting
          </button>
        )
      )}

      {load?.status === "ready" && editing && (
        <form className="mt-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label htmlFor={fieldId} className="sr-only">Your note on {exerciseName}</label>
          <textarea
            ref={field}
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            aria-describedby={`${fieldId}-count`}
            aria-invalid={over || undefined}
            placeholder="For example: seat on 4, pin at 7"
            className="fitx-field min-h-24 resize-y py-2.5 text-sm leading-6"
          />
          <p id={`${fieldId}-count`} className={`m-0 mt-1 text-right text-[11px] tabular-nums ${over ? "font-semibold text-fitx-danger" : "text-fitx-text-secondary"}`}>
            {length} of {NOTE_MAX_CHARS} characters
          </p>
          {confirmDelete ? (
            <div role="group" aria-labelledby={`${fieldId}-delete`} className="mt-2 rounded-lg border border-fitx-danger-border bg-fitx-danger-bg p-3">
              <p id={`${fieldId}-delete`} className="m-0 text-sm text-fitx-text">Delete this note?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {/* Busy, never disabled while it works (a disabled button drops keyboard focus, D5): a press then is ignored. */}
                <button ref={confirmDeleteButton} type="button" onClick={() => void remove()} aria-disabled={busy !== null || undefined} className="fitx-button fitx-button-danger aria-disabled:opacity-60">
                  {busy === "delete" ? <LoaderCircle size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Trash2 size={15} aria-hidden="true" />}
                  {busy === "delete" ? "Deleting…" : "Delete note"}
                </button>
                <button type="button" onClick={keepNote} aria-disabled={busy !== null || undefined} className="fitx-button fitx-button-quiet aria-disabled:opacity-60">Keep it</button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="submit" disabled={over || unchanged} aria-disabled={busy !== null || undefined} className="fitx-button aria-disabled:opacity-60">
                {busy === "save" && <LoaderCircle size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
                {busy === "save" ? "Saving…" : "Save note"}
              </button>
              <button type="button" onClick={stopEditing} aria-disabled={busy !== null || undefined} className="fitx-button fitx-button-quiet aria-disabled:opacity-60">Cancel</button>
              {note && (
                <button ref={askDelete} type="button" onClick={() => { if (!busy) setConfirmDelete(true); }} aria-disabled={busy !== null || undefined} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-fitx-danger hover:underline aria-disabled:opacity-60">
                  <Trash2 size={14} aria-hidden="true" />Delete
                </button>
              )}
            </div>
          )}
        </form>
      )}

      {status && <p role={status.tone === "danger" ? "alert" : "status"} className={`m-0 mt-2 text-xs ${status.tone === "danger" ? "text-fitx-danger" : "text-fitx-success"}`}>{status.text}</p>}
    </section>
  );
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
