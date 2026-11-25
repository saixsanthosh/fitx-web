// saveWeighIn (src/lib/data/today.ts, in nobody's list) kept 0.1 kg while every other weigh-in path keeps 0.01 kg since
// release 3 (bug 6; the onboarding stream's open note in reports-3/onboarding.md), so a weight typed in pounds and
// saved through it came back changed: 150 lb as 149.9 lb.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StubDb } from "./support/stub-db";
import { saveWeighIn } from "@/lib/data/today";
import { weightFromUnit, weightInUnit } from "@/lib/domain/profile-options";
import { DataError } from "@/lib/data/missing-schema";

function db() {
  const stub = new StubDb(() => ({ data: null, error: null }));
  const saved = () => (stub.callsTo("body_metrics")[0]?.ops.find((op) => op.method === "insert")?.args[0] as { weight: number }).weight;
  const profile = () => (stub.callsTo("profiles")[0]?.ops.find((op) => op.method === "update")?.args[0] as { weight: number }).weight;
  return { client: stub as unknown as SupabaseClient, saved, profile };
}

test("a weight from pounds is saved to 0.01 kg and reads back as typed", async () => {
  for (const pounds of [150, 160, 155.5, 149.9, 67, 1102]) {
    const { client, saved, profile } = db();
    assert.equal(await saveWeighIn(client, "user-1", weightFromUnit(pounds, "lb")), true);
    assert.equal(saved(), weightFromUnit(pounds, "lb"), `${pounds} lb`);
    assert.equal(profile(), saved(), "the profile's copy is the same weight");
    assert.equal(weightInUnit(saved(), "lb"), pounds, `${pounds} lb reads back as ${pounds}`);
  }
  const { client, saved } = db();
  await saveWeighIn(client, "user-1", 68.044999);
  assert.equal(saved(), 68.04);
});

test("the kilogram range is unchanged", async () => {
  await assert.rejects(saveWeighIn(db().client, "user-1", 29.99), DataError);
  await assert.rejects(saveWeighIn(db().client, "user-1", Number.NaN), DataError);
  assert.equal(await saveWeighIn(db().client, "user-1", 30), true);
});
