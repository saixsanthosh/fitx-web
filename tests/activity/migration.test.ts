import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((name) => name.startsWith("202611181600")).sort();
const sql = (name: string) => readFileSync(path.join(DIR, name), "utf8").replace(/--.*$/gm, "");

test("activity migrations exist in order with the stream's prefix", () => {
  assert.deepEqual(files, ["20261118160000_fitx_activity_tracking.sql", "20261118160001_fitx_activity_retention_schedule.sql"]);
});

test("both tables are owner-only: RLS on, (select auth.uid()) policies, nothing for anon", () => {
  const text = sql(files[0]);
  for (const table of ["activities", "activity_track_chunks"]) {
    assert.match(text, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(text, new RegExp(`create policy \\w+ on public\\.${table} for all to authenticated\\s+using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\) with check \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`));
  }
  assert.match(text, /revoke all on table public\.activities, public\.activity_track_chunks from public, anon;/);
  assert.doesNotMatch(text, /grant[^;]*\banon\b/i);
  assert.doesNotMatch(text, /\bto public\b/i);
});

test("chunks can only belong to an activity of the same owner, and go with it", () => {
  const text = sql(files[0]);
  assert.match(text, /unique \(id, user_id\)/);
  assert.match(text, /foreign key \(activity_id, user_id\) references public\.activities \(id, user_id\) on delete cascade/);
});

test("additive only, and functions cannot be hijacked through the search path", () => {
  for (const name of files) {
    const text = sql(name);
    assert.doesNotMatch(text, /\bdrop table\b|\bdrop column\b|\balter table [\w.]+ drop\b|\btruncate\b/i, name);
    for (const fn of text.match(/create or replace function[\s\S]*?\$\$;?/gi) ?? []) {
      assert.match(fn, /set search_path = ''/, `${name}: function without a fixed search_path`);
    }
    const definers = text.match(/security definer/gi) ?? [];
    assert.equal(definers.length, 0, `${name}: no security definer functions are needed`);
  }
});

test("detailed points are pruned after the retention period, never before 7 days", () => {
  const text = sql(files[0]);
  assert.match(text, /make_interval\(days => greatest\(coalesce\(keep_days, 90\), 7\)\)/);
  assert.match(text, /revoke all on function public\.fitx_prune_activity_track_chunks\(integer\) from public, anon, authenticated;/);
  const schedule = sql(files[1]);
  assert.match(schedule, /cron\.schedule\(\s*'fitx-prune-activity-track-chunks',\s*'23 3 \* \* \*',\s*\$\$select public\.fitx_prune_activity_track_chunks\(90\)\$\$/);
});

test("one account cannot fill the database: limits match what the app produces", () => {
  const text = sql(files[0]);
  assert.match(text, /chunk_count integer not null default 0 check \(chunk_count between 0 and 200\)/);
  assert.match(text, /seq integer not null check \(seq between 0 and 199\)/);
  assert.match(text, /point_count integer not null check \(point_count between 1 and 1000\)/);
  assert.match(text, /char_length\(points\) between 1 and 40000/);
  assert.match(text, /create trigger fitx_activities_daily_limit before insert on public\.activities/);
  assert.match(text, /create trigger fitx_activity_chunks_limit before insert or update on public\.activity_track_chunks/);
  assert.match(text, />= 50 then\s+raise exception using errcode = '54000'/);
  assert.match(text, />= 1000 then\s+raise exception using errcode = '54000'/);
  // A chunk outside its activity can never be stored: that one is final.
  assert.match(text, /new\.seq >= allowed then\s+raise exception using errcode = 'P0001'/);
});

test("an activity's detailed points are pruned together, by when the activity ended", () => {
  const text = sql(files[0]);
  assert.match(text, /delete from public\.activity_track_chunks c\s+using public\.activities a\s+where a\.id = c\.activity_id\s+and a\.user_id = c\.user_id\s+and a\.ended_at < now\(\)/);
});
