import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROGRAMMES } from "@/data/programmes";
import { loadProgrammes } from "@/lib/training/data";

/** A client whose training_programmes select resolves to one fixed result. */
function db(result: { data: unknown; error: { code: string } | null }) {
  const builder = { select: () => builder, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  return { from: () => builder } as unknown as SupabaseClient;
}

test("with every programme moved to draft in Admin, members see none, not the authored copies", async () => {
  const loaded = await loadProgrammes(db({ data: [], error: null }));
  assert.deepEqual(loaded.programmes, []);
  assert.equal(loaded.enrolAvailable, true);
});

test("before the programme migrations, or when the request fails, the authored copies are shown without enrolling", async () => {
  for (const code of ["PGRST205", "57014"]) {
    const loaded = await loadProgrammes(db({ data: null, error: { code } }));
    assert.equal(loaded.programmes.length, PROGRAMMES.length, code);
    assert.equal(loaded.enrolAvailable, false, code);
  }
});

test("published programmes come from the database", async () => {
  const authored = PROGRAMMES[0];
  const row = {
    id: authored.id, title: "Renamed in Admin", summary: authored.summary, context: authored.context, split: authored.split, level: authored.level,
    days_per_week: authored.daysPerWeek, default_weekdays: authored.defaultWeekdays, session_minutes: authored.sessionMinutes,
    built_around: authored.builtAround, is_premium: authored.isPremium, source_notes: authored.sourceNotes,
    training_programme_days: authored.days.map((day, index) => ({ day_index: index, key: day.key, title: day.title, focus: day.focus, slots: day.slots })),
  };
  const loaded = await loadProgrammes(db({ data: [row], error: null }));
  assert.deepEqual(loaded.programmes.map((programme) => programme.title), ["Renamed in Admin"]);
  assert.equal(loaded.enrolAvailable, true);
});
