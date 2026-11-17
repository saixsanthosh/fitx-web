import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeQueryClient } from "../support/fake-query-client.ts";
import { EXPORT_PAGE_SIZE, EXPORT_TABLES, ExportError, countRecords, exportAccountData, exportFileName, isMissingTable } from "@/lib/account/export";

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "me@example.test",
  created_at: "2026-10-01T00:00:00Z",
  last_sign_in_at: "2026-11-16T09:00:00Z",
  user_metadata: { full_name: "Asha Rao", avatar_url: "https://lh3.example/photo.jpg", email_verified: true },
  identities: [
    { provider: "google", identity_data: { sub: "1234567890", name: "Asha Rao", picture: "https://lh3.example/photo.jpg" }, created_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-11-16T09:00:00Z" },
    { provider: "email" },
  ],
};
let fake: FakeQueryClient;
const client = () => fake as unknown as SupabaseClient;

beforeEach(() => {
  fake = new FakeQueryClient();
  for (const spec of EXPORT_TABLES) fake.tables[spec.table] = [];
  fake.tables.profiles = [{ id: USER.id, name: "Asha" }, { id: "someone-else", name: "Not me" }];
  fake.tables.user_preferences = [{ user_id: USER.id, primary_goal: "fat_loss" }];
  fake.tables.meals = [
    ...Array.from({ length: EXPORT_PAGE_SIZE + 5 }, (_, i) => ({ id: `meal-${String(i).padStart(5, "0")}`, user_id: USER.id, food_name: `Food ${i}` })),
    { id: "meal-x", user_id: "someone-else", food_name: "Theirs" },
  ];
  fake.files[`fitx-user-media/${USER.id}`] = [
    { name: "avatar-1.jpg", id: "f1", metadata: { size: 2048, mimetype: "image/jpeg" }, updated_at: "2026-11-01T00:00:00Z" },
    { name: "foods", id: null },
    { name: "progress", id: null },
  ];
  // Photos of the user's own foods (Nutrition), under <uid>/foods/.
  fake.files[`fitx-user-media/${USER.id}/foods`] = [{ name: "dal-1.webp", id: "f3", metadata: { size: 640, mimetype: "image/webp" } }];
  fake.files[`fitx-user-media/${USER.id}/progress`] = [{ name: "front.webp", id: "f2", metadata: { size: 900, mimetype: "image/webp" } }];
});

describe("data export", () => {
  test("includes every row of the user's own, across pages, and nobody else's", async () => {
    const progress: string[] = [];
    const data = await exportAccountData(client(), USER, { onProgress: ({ label }) => progress.push(label), now: new Date("2026-11-16T10:00:00Z") });
    assert.equal(data.format, "fitx-account-export");
    assert.equal(data.exported_at, "2026-11-16T10:00:00.000Z");
    assert.equal(data.tables.meals.length, EXPORT_PAGE_SIZE + 5);
    assert.ok(data.tables.meals.every((row) => row.user_id === USER.id));
    assert.deepEqual(data.tables.profiles, [{ id: USER.id, name: "Asha" }]);
    assert.equal(countRecords(data), EXPORT_PAGE_SIZE + 5 + 2);
    assert.deepEqual(data.account.sign_in_methods, ["google", "email"]);
    // The sign-in profile FITX holds is part of "everything": what Google shared, and each linked identity.
    assert.deepEqual(data.account.profile_from_sign_in, USER.user_metadata);
    assert.deepEqual(data.account.identities[0], { provider: "google", details: USER.identities[0].identity_data, created_at: "2026-10-01T00:00:00Z", last_sign_in_at: "2026-11-16T09:00:00Z" });
    assert.deepEqual(data.account.identities[1], { provider: "email", details: {}, created_at: null, last_sign_in_at: null });
    assert.doesNotMatch(JSON.stringify(data.account), /token/i);
    assert.ok(progress.includes("Food log"));
    // Two pages were read for meals: 0-999 and 1000-1999.
    assert.deepEqual(fake.calls.filter((call) => call.table === "meals").map((call) => call.range), [[0, 999], [1000, 1999]]);
  });

  test("lists uploaded files from every folder without their contents", async () => {
    const data = await exportAccountData(client(), USER);
    assert.deepEqual(data.files, [
      { path: `${USER.id}/avatar-1.jpg`, size: 2048, contentType: "image/jpeg", updatedAt: "2026-11-01T00:00:00Z" },
      { path: `${USER.id}/foods/dal-1.webp`, size: 640, contentType: "image/webp", updatedAt: null },
      { path: `${USER.id}/progress/front.webp`, size: 900, contentType: "image/webp", updatedAt: null },
    ]);
    assert.ok(data.notes.some((note) => note.includes("listed by name only")));
  });

  test("pages a table with a two-column key in a stable order", async () => {
    fake.tables.activity_track_chunks = [
      { activity_id: "b", seq: 0, user_id: USER.id }, { activity_id: "a", seq: 1, user_id: USER.id },
      { activity_id: "a", seq: 0, user_id: USER.id }, { activity_id: "a", seq: 0, user_id: "someone-else" },
    ];
    const data = await exportAccountData(client(), USER);
    assert.deepEqual(data.tables.activity_track_chunks.map((row) => `${row.activity_id}${row.seq}`), ["a0", "a1", "b0"]);
  });

  test("reads only the columns members may see where a table grants some", async () => {
    await exportAccountData(client(), USER);
    const support = fake.calls.find((call) => call.table === "support_requests");
    assert.match(support?.columns ?? "", /^id,user_id,.*support_messages\(id,author_kind,body,created_at\)$/);
    assert.doesNotMatch(support?.columns ?? "", /priority|assigned_to|page_path/);
  });

  test("a table that doesn't exist yet becomes a note; other errors stop the export", async () => {
    delete fake.tables.habits;
    const data = await exportAccountData(client(), USER);
    assert.ok(!("habits" in data.tables));
    assert.ok(data.notes.some((note) => note.includes("habits")));

    fake.failures["meals:select"] = { code: "08006", message: "connection failure" };
    await assert.rejects(exportAccountData(client(), USER), (error: unknown) => error instanceof ExportError && error.section === "Food log");
  });

  test("helpers", () => {
    assert.equal(isMissingTable({ code: "PGRST205" }), true);
    assert.equal(isMissingTable({ code: "42P01" }), true);
    assert.equal(isMissingTable({ code: "42703" }), false);
    assert.equal(exportFileName(new Date(2026, 10, 6)), "fitx-data-2026-11-06.json");
  });
});
