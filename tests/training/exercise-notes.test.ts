// The member's private note on an exercise: what can be saved, and the reads and writes before and after the
// exercise_notes migration (20261119100010) is applied.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb, used } from "../home/support/stub-db";
import { NOTE_MAX_CHARS, checkNote, deleteExerciseNote, loadExerciseNote, noteLength, saveExerciseNote, tidyNote } from "@/lib/training/exercise-notes";
import { EXPORT_TABLES } from "@/lib/account/export";

const db = (stub: StubDb) => stub as unknown as SupabaseClient;
const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const MISSING = { code: "PGRST205", message: "Could not find the table 'public.exercise_notes' in the schema cache" };
const OFFLINE = { code: "", message: "TypeError: Failed to fetch" };
const NOW = new Date("2026-11-18T09:30:00.000Z");

describe("note text", () => {
  test("stored as written, with line ends, control characters and outer blank space tidied", () => {
    assert.equal(tidyNote("  Seat on 4\r\npin at 7   \r\n\n"), "Seat on 4\npin at 7");
    assert.equal(tidyNote("a\u0000b\u0007c\td"), "abc\td");
    assert.equal(tidyNote("   "), "");
  });

  test("500 characters at most, counted as the database counts them", () => {
    assert.equal(noteLength("💪💪"), 2, "an emoji is one character");
    assert.deepEqual(checkNote(""), { kind: "empty" });
    assert.deepEqual(checkNote(" \n "), { kind: "empty" });
    assert.deepEqual(checkNote(" Seat on 4 "), { kind: "ok", body: "Seat on 4" });
    assert.equal(checkNote("x".repeat(NOTE_MAX_CHARS)).kind, "ok");
    assert.deepEqual(checkNote("💪".repeat(NOTE_MAX_CHARS)), { kind: "ok", body: "💪".repeat(NOTE_MAX_CHARS) });
    assert.deepEqual(checkNote("x".repeat(NOTE_MAX_CHARS + 1)), { kind: "too_long", length: NOTE_MAX_CHARS + 1 });
  });
});

describe("reading a note", () => {
  test("the member's own note on this exercise", async () => {
    const stub = new StubDb(() => ({ data: { body: "Seat on 4", updated_at: "2026-11-17T08:00:00Z" } }));
    assert.deepEqual(await loadExerciseNote(db(stub), USER, "bench_press"), { status: "ready", note: { body: "Seat on 4", updatedAt: "2026-11-17T08:00:00Z" } });
    const [call] = stub.callsTo("exercise_notes");
    assert.ok(used(call, "eq", "user_id", USER) && used(call, "eq", "exercise_id", "bench_press") && used(call, "maybeSingle"));
  });

  test("no note yet; no table yet (the box is hidden); a failed request", async () => {
    assert.deepEqual(await loadExerciseNote(db(new StubDb(() => ({ data: null }))), USER, "bench_press"), { status: "ready", note: null });
    assert.deepEqual(await loadExerciseNote(db(new StubDb(() => ({ error: MISSING }))), USER, "bench_press"), { status: "unavailable" });
    assert.deepEqual(await loadExerciseNote(db(new StubDb(() => ({ error: { code: "42P01", message: "relation does not exist" } }))), USER, "x"), { status: "unavailable" });
    const failed = await loadExerciseNote(db(new StubDb(() => ({ error: OFFLINE }))), USER, "bench_press");
    assert.equal(failed.status, "error");
  });
});

describe("saving a note", () => {
  test("one note per member and exercise: an upsert on (user_id, exercise_id) of the tidied text", async () => {
    const stub = new StubDb(() => ({ data: { body: "Seat on 4", updated_at: NOW.toISOString() } }));
    const result = await saveExerciseNote(db(stub), USER, "bench_press", "  Seat on 4 ", NOW);
    assert.deepEqual(result, { status: "saved", note: { body: "Seat on 4", updatedAt: NOW.toISOString() } });
    const [call] = stub.callsTo("exercise_notes");
    assert.ok(used(call, "upsert", { user_id: USER, exercise_id: "bench_press", body: "Seat on 4", updated_at: NOW.toISOString() }, { onConflict: "user_id,exercise_id" }));
  });

  test("empty text removes the note; text over the limit sends nothing", async () => {
    const stub = new StubDb(() => ({ data: null }));
    assert.deepEqual(await saveExerciseNote(db(stub), USER, "bench_press", "   "), { status: "saved", note: null });
    const [call] = stub.callsTo("exercise_notes");
    assert.ok(used(call, "delete") && used(call, "eq", "user_id", USER) && used(call, "eq", "exercise_id", "bench_press"));

    const quiet = new StubDb(() => ({ data: null }));
    assert.deepEqual(await saveExerciseNote(db(quiet), USER, "bench_press", "x".repeat(NOTE_MAX_CHARS + 3)), { status: "too_long", length: NOTE_MAX_CHARS + 3 });
    assert.equal(quiet.calls.length, 0);
  });

  test("before the migration and on failure", async () => {
    assert.deepEqual(await saveExerciseNote(db(new StubDb(() => ({ error: MISSING }))), USER, "bench_press", "Seat on 4"), { status: "unavailable" });
    assert.equal((await saveExerciseNote(db(new StubDb(() => ({ error: OFFLINE }))), USER, "bench_press", "Seat on 4")).status, "error");
    assert.deepEqual(await deleteExerciseNote(db(new StubDb(() => ({ error: MISSING }))), USER, "bench_press"), { status: "unavailable" });
    assert.equal((await deleteExerciseNote(db(new StubDb(() => ({ error: OFFLINE }))), USER, "bench_press")).status, "error");
  });
});

test("notes are part of Download my data", () => {
  const spec = EXPORT_TABLES.find((entry) => entry.table === "exercise_notes");
  assert.deepEqual(spec, { table: "exercise_notes", label: "Exercise notes", owner: "user_id", order: "exercise_id" });
});
