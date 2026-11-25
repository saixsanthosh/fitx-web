/**
 * Undo in the meal log. Removing a logged food leaves an "Undo" in its place that puts the same entry back (its id and
 * time too, so it returns to where it was); an "Added …" toast's Undo takes back only what it added, and never deletes
 * again an entry the member has already removed. Pure, so `node --test` can check it; the page does the reads and writes.
 */
import { MEAL_COLUMNS } from "@/lib/food/client-data";

/** What a removal reads back, so the entry can be put back exactly. */
export const RESTORE_COLUMNS = `${MEAL_COLUMNS},created_at`;

/** A food removed from the day, shown in its place with an Undo until the member moves on. */
export interface RemovedEntry {
  id: string;
  /** The day it was logged on: its Undo shows only on that day. */
  date: string;
  meal: string;
  name: string;
  /** The row as it was stored (RESTORE_COLUMNS). */
  row: Record<string, unknown>;
  /** Putting it back failed. */
  failed?: boolean;
}

/** The row to insert to put a removed entry back: as it was, for this member. */
export function restoreRow(entry: Pick<RemovedEntry, "row">, userId: string): Record<string, unknown> {
  return { ...entry.row, user_id: userId };
}

/** What a removal's Undo says while it waits, and after a failed attempt. */
export function removedText(entry: Pick<RemovedEntry, "name" | "failed">): string {
  return entry.failed ? `${entry.name} couldn't be put back. Try Undo again, or log it again from Recent.` : `Removed ${entry.name}.`;
}

/**
 * Which "Added …" toast can still take back which entries. Removing an entry (or using an Undo) forgets it, so a
 * toast still on screen can never delete it, or a restored copy of it, again.
 */
export function addedUndoRegistry() {
  const toasts = new Map<string, string | number>();
  return {
    remember(ids: readonly string[], toastId: string | number) {
      for (const id of ids) toasts.set(id, toastId);
    },
    /** The entry is gone or was taken back: forget it, and say which toast offered its Undo (to close it). */
    forget(id: string): string | number | undefined {
      const toastId = toasts.get(id);
      toasts.delete(id);
      return toastId;
    },
    canUndo(ids: readonly string[]): boolean {
      return ids.length > 0 && ids.every((id) => toasts.has(id));
    },
  };
}

/** What an "Added …" toast's Undo reports: only what it really took back. */
export function undoAddedMessage(deleted: number, label: string): string {
  return deleted > 0 ? `Removed ${label}.` : `${label} was already removed.`;
}

/**
 * Where the focus goes when a list row it was on is deleted: the next row, else the one before, else null (the
 * list's own control or heading takes it).
 */
export function neighbourAfterRemoval(ids: readonly string[], removed: string): string | null {
  const at = ids.indexOf(removed);
  if (at < 0) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}
