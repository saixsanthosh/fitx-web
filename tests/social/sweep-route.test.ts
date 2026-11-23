// /api/social/sweep (wave-2 brief 3.9): only Vercel Cron's bearer secret runs it (401 otherwise, 503 without a secret
// or server key); every vercel.json cron runs at most once a day (the Hobby plan fails a deploy with anything more
// frequent); and the sweep itself: pages of at most 1,000, at most 5 a run, orphans that are in use again kept, rows
// forgotten only after Storage removed the files, idempotent, and a database without the migration left alone.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import "../billing/support/server-only.mjs";
import { chunks, isMissing, runSweep, SWEEP, type SweepDeps, type TrashRow } from "@/app/api/social/sweep/sweep";

type Route = { GET: (request: Request) => Promise<Response> };

describe("the sweep route", () => {
  let route: Route;
  before(async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    route = (await import("@/app/api/social/sweep/route")) as unknown as Route;
  });
  const call = (authorization?: string) => route.GET(new Request("http://fitx.test/api/social/sweep", { headers: authorization ? { authorization } : {} }));

  test("without CRON_SECRET it refuses to run (503)", async () => {
    delete process.env.CRON_SECRET;
    const response = await call("Bearer anything");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "cron_secret_missing" });
  });

  test("a missing or wrong secret is 401, never cached", async () => {
    process.env.CRON_SECRET = "sweep-test-secret";
    for (const header of [undefined, "Bearer wrong", "sweep-test-secret", "Bearer sweep-test-secret-and-more", "Basic sweep-test-secret"]) {
      const response = await call(header);
      assert.equal(response.status, 401, String(header));
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  });

  test("the right secret without the server key answers 503 (nothing is half done)", async () => {
    process.env.CRON_SECRET = "sweep-test-secret";
    const response = await call("Bearer sweep-test-secret");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "sweep_not_configured" });
  });
});

test("every vercel.json cron runs at most once a day (fixed minute and hour), and the sweep is scheduled", () => {
  const config = JSON.parse(readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8")) as { crons?: { path: string; schedule: string }[]; ignoreCommand?: string };
  assert.equal(config.ignoreCommand, "node admin/scripts/vercel-ignore.mjs fitx", "the existing ignoreCommand stays");
  assert.ok(config.crons?.length, "vercel.json has crons");
  assert.ok(config.crons.some((cron) => cron.path === "/api/social/sweep"), "the sweep is scheduled");
  for (const cron of config.crons) {
    const fields = cron.schedule.trim().split(/\s+/);
    assert.equal(fields.length, 5, cron.schedule);
    const [minute, hour] = fields;
    assert.match(minute, /^([0-5]?\d)$/, `${cron.path}: one fixed minute (${cron.schedule})`);
    assert.match(hour, /^(1?\d|2[0-3])$/, `${cron.path}: one fixed hour (${cron.schedule})`);
  }
});

type Store = { trash: TrashRow[]; files: Set<string>; inUse: Set<string>; removeCalls: string[][]; forgetCalls: string[][]; hourlyCalls: number };

function fake(store: Store, over: Partial<SweepDeps> = {}): SweepDeps {
  let clock = 0;
  return {
    async hourly() { store.hourlyCalls += 1; return { stories_deleted: 0 }; },
    async trash(limit) { return store.trash.slice(0, limit); },
    async referenced(paths) { return new Set(paths.filter((item) => store.inUse.has(item))); },
    async remove(paths) {
      assert.ok(paths.length <= 1000, "Storage removes at most 1,000 at once");
      store.removeCalls.push(paths);
      for (const item of paths) store.files.delete(item);
    },
    async forget(paths) { store.forgetCalls.push(paths); store.trash = store.trash.filter((row) => !paths.includes(row.path)); },
    now: () => (clock += 10),
    ...over,
  };
}

const rows = (count: number, reason = "story_expired", prefix = "u") =>
  Array.from({ length: count }, (_, index) => ({ path: `${prefix}/${String(index).padStart(5, "0")}/0.webp`, reason }));
const store = (trash: TrashRow[], inUse: string[] = []): Store =>
  ({ trash, files: new Set(trash.map((row) => row.path)), inUse: new Set(inUse), removeCalls: [], forgetCalls: [], hourlyCalls: 0 });

test("queued files are removed through Storage and then forgotten; the hourly job runs first", async () => {
  const s = store(rows(3));
  const summary = await runSweep(fake(s));
  assert.equal(s.hourlyCalls, 1);
  assert.deepEqual(summary, { hourly: { stories_deleted: 0 }, removed: 3, kept: 0, pages: 1, more: false, schema: true });
  assert.equal(s.files.size, 0);
  assert.equal(s.trash.length, 0);
});

test("an orphan that something refers to again is kept, and only orphans are checked", async () => {
  const trash = [...rows(2, "orphan", "o"), ...rows(2, "removed", "r")];
  const s = store(trash, [trash[1].path, trash[3].path]);
  let checked: string[] = [];
  const summary = await runSweep(fake(s, { referenced: async (paths) => { checked = paths; return new Set(paths.filter((item) => s.inUse.has(item))); } }));
  assert.deepEqual(checked, [trash[0].path, trash[1].path], "only orphans are checked");
  assert.equal(summary.removed, 3);
  assert.equal(summary.kept, 1);
  assert.ok(s.files.has(trash[1].path), "the orphan in use stays in the bucket");
  assert.ok(!s.files.has(trash[3].path), "a removed post's file goes even if it was referenced before");
  assert.equal(s.trash.length, 0, "every row of the page is forgotten");
});

test("at most 5 pages of 1,000 a run; the rest waits for the next run", async () => {
  const s = store(rows(5600));
  const summary = await runSweep(fake(s));
  assert.equal(SWEEP.pages, 5);
  assert.equal(SWEEP.pageSize, 1000);
  assert.equal(summary.pages, 5);
  assert.equal(summary.removed, 5000);
  assert.equal(summary.more, true);
  assert.equal(s.trash.length, 600);
  assert.ok(s.removeCalls.every((call) => call.length <= 1000));
  const second = await runSweep(fake(s));
  assert.deepEqual([second.removed, second.more, s.trash.length], [600, false, 0]);
});

test("when Storage refuses, the rows stay queued (the next run tries again)", async () => {
  const s = store(rows(4));
  await assert.rejects(runSweep(fake(s, { remove: async () => { throw new Error("storage down"); } })), /storage down/);
  assert.equal(s.trash.length, 4);
  assert.equal(s.forgetCalls.length, 0);
});

test("running again with nothing queued does nothing (idempotent)", async () => {
  const s = store([]);
  const summary = await runSweep(fake(s));
  assert.deepEqual([summary.removed, summary.pages, summary.more], [0, 0, false]);
  assert.equal(s.removeCalls.length, 0);
});

test("before the migration is applied: no hourly function and no trash table, nothing happens", async () => {
  const s = store(rows(2));
  const summary = await runSweep(fake(s, { hourly: async () => null, trash: async () => null }));
  assert.deepEqual(summary, { hourly: null, removed: 0, kept: 0, pages: 0, more: false, schema: false });
  assert.equal(s.files.size, 2);
});

test("the time budget stops a long run between pages", async () => {
  const s = store(rows(3000));
  let clock = 0;
  const summary = await runSweep(fake(s, { now: () => (clock += 30_000) }), { budgetMs: 45_000 });
  assert.equal(summary.pages, 1);
  assert.equal(summary.more, true);
});

test("helpers: chunks and the missing-schema codes", () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([], 3), []);
  assert.ok(isMissing({ code: "PGRST202" }) && isMissing({ code: "42P01" }) && isMissing({ code: "PGRST205" }));
  assert.ok(!isMissing({ code: "42501" }) && !isMissing(null));
});
