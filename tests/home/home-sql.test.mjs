// Runs every repo migration on a throwaway local Postgres (Supabase stubs, no network, no real data)
// and checks the Phase 3 SQL: the To-Do store triggers, fitx_reorder_todo, fitx_complete_workout_event,
// fitx_today_summary, fitx_goal_progress, the manual-goal trigger, and that one user never sees or
// changes another user's rows. Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "./support/local-postgres.mjs";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAN = "cccccccc-0000-4000-8000-000000000003";
const TODAY = "2026-11-18"; // a Wednesday; its Monday-to-Sunday week is 16-22 November
const IST = "Asia/Kolkata";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("Phase 3 SQL on a local Postgres", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const ids = {};

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    // Accounts, profiles and preferences are created the way sign-up and onboarding create them.
    pg.exec(`
      insert into auth.users (id, email, raw_user_meta_data) values
        ('${A}', 'a@example.test', '{"name":"Asha"}'), ('${B}', 'b@example.test', '{"name":"Ben"}');
      update public.profiles set age = 30, gender = 'female', height = 165, weight = 82, target_weight = 70 where id = '${A}';
    `);
    pg.exec(`
      insert into public.user_preferences (user_id, timezone, workouts_per_week, daily_water_goal_ml, activity_level, primary_goal)
      values ('${A}', '${IST}', 4, 3000, 'light', 'fat_loss');
      insert into public.workout_plans (id, user_id, title) values ('${PLAN}', '${A}', 'Push day');
      insert into public.meals (user_id, date, meal, food_name, calories, protein, carbs, fat) values
        ('${A}', '${TODAY}', 'Breakfast', 'Oats', 500, 30, 50, 10),
        ('${A}', '${TODAY}', 'Lunch', 'Dal rice', 700, 40, 60, 25),
        ('${A}', '2026-11-17', 'Dinner', 'Yesterday', 300, 10, 20, 5);
      insert into public.water_logs (user_id, amount_ml, local_date) values
        ('${A}', 500, '${TODAY}'), ('${A}', 750, '${TODAY}'), ('${A}', 900, '2026-11-17');
      insert into public.body_metrics (user_id, date, weight, created_at) values
        ('${A}', '2026-11-10', 82.0, '2026-11-10T03:00:00Z'),
        ('${A}', '2026-11-17', 80.4, '2026-11-17T02:00:00Z'),
        ('${A}', '2026-11-17', 80.2, '2026-11-17T09:00:00Z'),
        ('${A}', '2026-11-20', 79.0, '2026-11-20T02:00:00Z');
      insert into public.body_metrics (user_id, date, weight, body_fat) values ('${A}', '${TODAY}', null, 24);
    `, asA);
    // Sessions, in UTC. In India (UTC+5:30): s1 08:00 and s2 01:00 on the 18th, s3 23:30 on the 17th,
    // s5 on Sunday the 15th (last week). s4 is still in progress.
    const sessions = pg.json(`
      with s as (
        insert into public.workout_sessions (user_id, plan_id, name, status, started_at) values
          ('${A}', '${PLAN}', 'Push day', 'completed', '2026-11-18T02:30:00Z'),
          ('${A}', '${PLAN}', 'Push day', 'completed', '2026-11-17T19:30:00Z'),
          ('${A}', null, 'Run', 'completed', '2026-11-17T18:00:00Z'),
          ('${A}', null, 'Legs', 'in_progress', '2026-11-18T03:00:00Z'),
          ('${A}', null, 'Old', 'completed', '2026-11-15T10:00:00Z')
        returning id, name, started_at)
      select json_agg(json_build_object('id', id, 'name', name, 'at', started_at) order by started_at) from s;`, asA);
    ids.s5 = sessions[0].id; ids.s3 = sessions[1].id; ids.s2 = sessions[2].id; ids.s1 = sessions[3].id; ids.s4 = sessions[4].id;
  });

  after(() => pg?.stop());

  test("To-Do items: untimed tasks, a local day from the user's time zone, and completed_at kept with status", () => {
    const rows = pg.json(`
      with inserted as (
        insert into public.planner_events (user_id, event_type, title, local_date, starts_at, status, sort_order, workout_plan_id) values
          ('${A}', 'task', 'Stretch', '${TODAY}', null, 'scheduled', 0, null),
          ('${A}', 'task', 'Buy oats', '${TODAY}', null, 'completed', 1, null),
          ('${A}', 'workout', 'Push day', null, '2026-11-18T12:30:00Z', 'scheduled', 2, '${PLAN}'),
          ('${A}', 'other', 'Early call', null, '2026-11-17T20:00:00Z', 'scheduled', 3, null),
          ('${A}', 'task', 'Dropped', '${TODAY}', null, 'cancelled', 4, null),
          ('${A}', 'workout', 'Push day', '2026-11-17', null, 'scheduled', 0, '${PLAN}'),
          ('${A}', 'workout', 'Push day', '2026-11-19', null, 'scheduled', 0, '${PLAN}')
        returning id, title, local_date, starts_at, status, completed_at)
      select json_agg(row_to_json(inserted)) from inserted;`, asA);
    const byTitle = (title, day) => rows.find((row) => row.title === title && (!day || row.local_date === day));
    ids.stretch = byTitle("Stretch").id;
    ids.oats = byTitle("Buy oats").id;
    ids.pushToday = byTitle("Push day", TODAY).id;
    ids.pushYesterday = byTitle("Push day", "2026-11-17").id;
    ids.pushTomorrow = byTitle("Push day", "2026-11-19").id;
    ids.call = byTitle("Early call").id;
    assert.equal(byTitle("Push day", TODAY).local_date, TODAY, "a timed event without a day gets the day in the user's zone");
    assert.equal(byTitle("Early call").local_date, TODAY, "20:00 UTC on the 17th is 01:30 on the 18th in India");
    assert.equal(byTitle("Buy oats").completed_at !== null, true, "inserted as completed: completed_at is set");
    assert.equal(byTitle("Stretch").completed_at, null);

    const toggled = pg.json(`
      update public.planner_events set status = 'completed' where id = '${ids.stretch}';
      select json_build_object('done', (select completed_at is not null from public.planner_events where id = '${ids.stretch}'));`, asA);
    assert.equal(toggled.done, true);
    const reopened = pg.json(`
      update public.planner_events set status = 'scheduled' where id = '${ids.stretch}';
      select json_build_object('completed_at', completed_at, 'touched', updated_at > created_at) from public.planner_events where id = '${ids.stretch}';`, asA);
    assert.deepEqual(reopened, { completed_at: null, touched: true }, "reopening clears completed_at; updated_at is maintained");

    const moved = pg.json(`
      update public.planner_events set starts_at = starts_at + interval '1 day' where id = '${ids.call}';
      select json_build_object('day', local_date) from public.planner_events where id = '${ids.call}';`, asA);
    assert.equal(moved.day, "2026-11-19", "moving the start time moves the day with it");
    pg.exec(`update public.planner_events set starts_at = starts_at - interval '1 day' where id = '${ids.call}';`, asA);
  });

  test("planner_events rejects items without a day, unknown types and an end without a start", () => {
    const noDay = pg.run(`insert into public.planner_events (user_id, event_type, title) values ('${A}', 'task', 'Nowhere');`, asA);
    assert.equal(noDay.ok, false);
    assert.match(noDay.stderr, /local_date/);
    const badType = pg.run(`insert into public.planner_events (user_id, event_type, title, local_date) values ('${A}', 'party', 'x', '${TODAY}');`, asA);
    assert.match(badType.stderr, /planner_events_event_type_check/);
    const endOnly = pg.run(`insert into public.planner_events (user_id, title, local_date, ends_at) values ('${A}', 'x', '${TODAY}', now());`, asA);
    assert.match(endOnly.stderr, /planner_events_untimed_end_check/);
  });

  test("fitx_reorder_todo saves one day's order and ignores other users' rows", () => {
    const changed = pg.json(`select to_json(public.fitx_reorder_todo('${TODAY}', array['${ids.oats}', '${ids.stretch}']::uuid[]));`, asA);
    assert.equal(changed, 2);
    const order = pg.json(`select json_agg(title order by sort_order, title) from public.planner_events where user_id = '${A}' and local_date = '${TODAY}' and title in ('Stretch', 'Buy oats');`);
    assert.deepEqual(order, ["Buy oats", "Stretch"]);
    const intruder = pg.json(`select to_json(public.fitx_reorder_todo('${TODAY}', array['${ids.stretch}', '${ids.oats}']::uuid[]));`, asB);
    assert.equal(intruder, 0, "another user cannot reorder these rows");
    const unchanged = pg.json(`select json_agg(title order by sort_order, title) from public.planner_events where user_id = '${A}' and local_date = '${TODAY}' and title in ('Stretch', 'Buy oats');`);
    assert.deepEqual(unchanged, ["Buy oats", "Stretch"]);
  });

  test("fitx_today_summary adds up the day in the database, in the user's time zone", () => {
    const summary = pg.json(`select public.fitx_today_summary('${TODAY}', '${IST}');`, asA);
    assert.equal(summary.local_date, TODAY);
    assert.equal(summary.timezone, IST);
    assert.equal(summary.week_start, "2026-11-16");
    assert.deepEqual(summary.nutrition, { calories: 1200, protein: 70, carbs: 110, fat: 35, entries: 2 });
    assert.deepEqual(summary.water, { ml: 1250, entries: 2 });
    assert.equal(summary.workouts.today, 2, "08:00 and 01:00 on the 18th in India; the in-progress session does not count");
    assert.equal(summary.workouts.week, 3);
    assert.deepEqual(summary.workouts.week_days, [{ date: "2026-11-17", count: 1 }, { date: TODAY, count: 2 }]);
    assert.deepEqual(summary.weight, { kg: 80.2, date: "2026-11-17" }, "newest weigh-in up to today; the later one that day wins");
    assert.deepEqual(summary.previous_weight, { kg: 80.4, date: "2026-11-17" });
    assert.equal(summary.profile.target_weight, 70);
    assert.equal(summary.profile.name, "Asha");
    assert.deepEqual(summary.preferences, { workouts_per_week: 4, daily_water_goal_ml: 3000, activity_level: "light", primary_goal: "fat_loss" });
    assert.deepEqual(summary.todo, { total: 4, completed: 1 }, "Stretch, Buy oats, Push day and Early call; the cancelled one is left out");
    assert.deepEqual(summary.planned_workouts.map((item) => [item.title, item.status]), [["Push day", "scheduled"]]);
  });

  test("fitx_today_summary falls back to the saved time zone, then UTC", () => {
    const saved = pg.json(`select public.fitx_today_summary('${TODAY}');`, asA);
    assert.equal(saved.timezone, IST, "no zone sent: the saved preference");
    const invalid = pg.json(`select public.fitx_today_summary('${TODAY}', 'Mars/Olympus_Mons');`, asA);
    assert.equal(invalid.timezone, IST, "an unknown zone falls back to the preference");
    const utc = pg.json(`select public.fitx_today_summary('${TODAY}', 'UTC');`, asA);
    assert.equal(utc.timezone, "UTC");
    assert.equal(utc.workouts.today, 1, "in UTC only the 02:30 session falls on the 18th");
  });

  test("fitx_today_summary shows another user nothing of this user's data", () => {
    pg.exec(`insert into public.meals (user_id, date, meal, food_name, calories, protein, carbs, fat) values ('${B}', '${TODAY}', 'Snack', 'Banana', 105, 1, 27, 0);`, asB);
    const summary = pg.json(`select public.fitx_today_summary('${TODAY}', '${IST}');`, asB);
    assert.deepEqual(summary.nutrition, { calories: 105, protein: 1, carbs: 27, fat: 0, entries: 1 });
    assert.deepEqual(summary.water, { ml: 0, entries: 0 });
    assert.equal(summary.workouts.today, 0);
    assert.equal(summary.weight, null);
    assert.equal(summary.preferences, null, "B has no preferences row, so no targets are invented");
    assert.equal(summary.profile.name, "Ben");
    assert.deepEqual(summary.todo, { total: 0, completed: 0 });
    assert.equal(pg.json(`select to_json(count(*)) from public.planner_events;`, asB), 0, "RLS hides A's planner rows from B");
  });

  test("the summary and progress functions are closed to signed-out callers", () => {
    const anon = pg.run(`select public.fitx_today_summary('${TODAY}');`, { role: "anon" });
    assert.equal(anon.ok, false);
    assert.match(anon.stderr, /permission denied/);
    const noUser = pg.run(`select public.fitx_goal_progress('${TODAY}');`, { role: "authenticated" });
    assert.match(noUser.stderr, /authentication required/);
  });

  test("goals: manual totals come from entries (corrections allowed, zero rejected)", () => {
    const goal = pg.json(`
      with g as (insert into public.goals (user_id, title, metric, period, target_value, current_value, unit)
                 values ('${A}', 'Read 10 books', 'manual', 'long_term', 10, 99, 'books') returning id, current_value)
      select row_to_json(g) from g;`, asA);
    ids.books = goal.id;
    assert.equal(Number(goal.current_value), 0, "the trigger ignores a client-sent total");
    pg.exec(`insert into public.goal_progress_entries (user_id, goal_id, amount) values ('${A}', '${ids.books}', 5), ('${A}', '${ids.books}', 3), ('${A}', '${ids.books}', -2);`, asA);
    assert.equal(Number(pg.json(`select to_json(current_value) from public.goals where id = '${ids.books}';`, asA)), 6);
    pg.exec(`delete from public.goal_progress_entries where goal_id = '${ids.books}' and amount = -2;`, asA);
    assert.equal(Number(pg.json(`select to_json(current_value) from public.goals where id = '${ids.books}';`, asA)), 8);
    const zero = pg.run(`insert into public.goal_progress_entries (user_id, goal_id, amount) values ('${A}', '${ids.books}', 0);`, asA);
    assert.match(zero.stderr, /goal_progress_entries_amount_check/);
    const completed = pg.json(`
      update public.goals set status = 'completed' where id = '${ids.books}';
      select json_build_object('at', completed_at is not null) from public.goals where id = '${ids.books}';`, asA);
    assert.equal(completed.at, true);
    const reopened = pg.json(`
      update public.goals set status = 'active' where id = '${ids.books}';
      select json_build_object('at', completed_at) from public.goals where id = '${ids.books}';`, asA);
    assert.equal(reopened.at, null);
  });

  test("goals: period, direction and metric are checked", () => {
    const badPeriod = pg.run(`insert into public.goals (user_id, title, period, target_value) values ('${A}', 'x', 'monthly', 1);`, asA);
    assert.match(badPeriod.stderr, /goals_period_check/);
    const badMetric = pg.run(`insert into public.goals (user_id, title, metric, target_value) values ('${A}', 'x', 'steps', 1);`, asA);
    assert.match(badMetric.stderr, /goals_metric_check/);
    const dailyWeight = pg.run(`insert into public.goals (user_id, title, metric, period, target_value) values ('${A}', 'x', 'body_weight_kg', 'daily', 70);`, asA);
    assert.match(dailyWeight.stderr, /goals_weight_long_term_check/);
  });

  test("fitx_goal_progress measures every metric over its period", () => {
    pg.exec(`
      insert into public.goals (user_id, title, metric, period, direction, target_value, unit, starts_on, baseline_value) values
        ('${A}', 'Protein', 'protein_g', 'daily', 'increase', 100, 'g', '2026-11-01', null),
        ('${A}', 'Calories', 'calories_kcal', 'daily', 'limit', 2000, 'kcal', '2026-11-01', null),
        ('${A}', 'Workouts', 'workouts_completed', 'weekly', 'increase', 4, 'workouts', '2026-11-01', null),
        ('${A}', 'Water', 'water_ml', 'daily', 'increase', 3000, 'ml', '2026-11-01', null),
        ('${A}', 'Weight', 'body_weight_kg', 'long_term', 'decrease', 70, 'kg', '2026-11-12', null),
        ('${A}', 'Checklist', 'tasks_completed', 'long_term', 'increase', 3, 'To-Dos', '2026-11-01', null),
        ('${A}', 'Stretch daily', 'manual', 'daily', 'increase', 10, 'min', '2026-11-01', null),
        ('${A}', 'Dropped', 'manual', 'long_term', 'increase', 5, '', '2026-11-01', null);
      update public.goals set status = 'cancelled' where title = 'Dropped' and user_id = '${A}';
      update public.planner_events set goal_id = (select id from public.goals where title = 'Checklist' and user_id = '${A}')
       where id in ('${ids.stretch}', '${ids.oats}');
      insert into public.goal_progress_entries (user_id, goal_id, amount, logged_at)
        select '${A}', id, 2, '2026-11-18T04:00:00Z' from public.goals where title = 'Stretch daily' and user_id = '${A}';
      insert into public.goal_progress_entries (user_id, goal_id, amount, logged_at)
        select '${A}', id, 5, '2026-11-17T18:00:00Z' from public.goals where title = 'Stretch daily' and user_id = '${A}';
    `, asA);
    const rows = pg.json(`select json_agg(row_to_json(p)) from public.fitx_goal_progress('${TODAY}', '${IST}') p;`, asA);
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row]));
    assert.equal(byTitle.Dropped, undefined, "cancelled goals are left out");
    assert.equal(Number(byTitle.Protein.current_value), 70);
    assert.equal(byTitle.Protein.period_start, TODAY);
    assert.equal(byTitle.Protein.period_end, TODAY);
    assert.equal(Number(byTitle.Calories.current_value), 1200);
    assert.equal(Number(byTitle.Workouts.current_value), 3);
    assert.deepEqual([byTitle.Workouts.period_start, byTitle.Workouts.period_end], ["2026-11-16", "2026-11-22"]);
    assert.equal(Number(byTitle.Water.current_value), 1250);
    assert.equal(Number(byTitle.Weight.current_value), 80.2, "the newest weigh-in up to today");
    assert.equal(byTitle.Weight.value_as_of, "2026-11-17");
    assert.equal(Number(byTitle.Weight.start_value), 82, "no baseline: the last weigh-in on or before the start date");
    assert.equal(Number(byTitle.Checklist.current_value), 1, "one of the two linked To-Dos is done");
    assert.deepEqual([byTitle.Checklist.linked_todos, byTitle.Checklist.linked_todos_done], [2, 1]);
    assert.equal(Number(byTitle["Stretch daily"].current_value), 2, "only entries logged today in India (23:30 on the 17th is yesterday)");
    assert.equal(Number(byTitle["Read 10 books"].current_value), 8);

    const other = pg.json(`select json_agg(p.id) from public.fitx_goal_progress('${TODAY}', '${IST}') p;`, asB);
    assert.equal(other, null, "another user gets no rows");
  });

  test("fitx_complete_workout_event completes the right planner item, once, and only for the session's owner", () => {
    const status = (id) => pg.json(`select json_build_object('status', status, 'done', completed_at is not null) from public.planner_events where id = '${id}';`);
    assert.equal(pg.json(`select to_json(public.fitx_complete_workout_event('${ids.s1}', '${IST}'));`, asB), null, "B cannot complete A's items");
    assert.equal(status(ids.pushToday).status, "scheduled");

    assert.equal(pg.json(`select to_json(public.fitx_complete_workout_event('${ids.s1}', '${IST}'));`, asA), ids.pushToday, "same day first");
    assert.deepEqual(status(ids.pushToday), { status: "completed", done: true });
    assert.equal(pg.json(`select to_json(public.fitx_complete_workout_event('${ids.s2}', '${IST}'));`, asA), ids.pushYesterday, "then the most recent overdue one");
    assert.equal(pg.json(`select to_json(public.fitx_complete_workout_event('${ids.s2}', '${IST}'));`, asA), null, "nothing left on or before that day");
    assert.equal(status(ids.pushTomorrow).status, "scheduled", "a later day is never touched");
    assert.equal(pg.json(`select to_json(public.fitx_complete_workout_event('${ids.s4}', '${IST}'));`, asA), null, "an unfinished session completes nothing");

    pg.exec(`update public.workout_sessions set planner_event_id = '${ids.stretch}' where id = '${ids.s3}';`, asA);
    assert.equal(pg.json(`select to_json(public.fitx_complete_workout_event('${ids.s3}', '${IST}'));`, asA), ids.stretch, "a session started from an item completes that item");
  });
});

describe("Phase 3 migrations on a database that already has data", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const PHASE3 = "20261118120000";

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: PHASE3 });
    // Rows the way the Phase 1 app wrote them: timed events only, manual goals with a browser-kept total.
    pg.exec(`
      insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      insert into public.user_preferences (user_id, timezone) values ('${A}', '${IST}'), ('${B}', 'Not/A_Zone');
      insert into public.planner_events (user_id, event_type, title, starts_at, status) values
        ('${A}', 'workout', 'Late session', '2026-11-17T19:00:00Z', 'completed'),
        ('${A}', 'meal', 'Lunch', '2026-11-18T07:00:00Z', 'scheduled'),
        ('${B}', 'other', 'Call', '2026-11-17T19:00:00Z', 'scheduled');
      insert into public.goals (id, user_id, title, target_value, current_value, unit)
        values ('dddddddd-0000-4000-8000-000000000004', '${A}', 'Run 100 km', 100, 7, 'km');
      insert into public.goal_progress_entries (user_id, goal_id, amount)
        values ('${A}', 'dddddddd-0000-4000-8000-000000000004', 5), ('${A}', 'dddddddd-0000-4000-8000-000000000004', 4);
    `);
    pg.applyMigrations({ from: PHASE3 });
  });

  after(() => pg?.stop());

  test("existing events get their day in the owner's saved time zone (UTC when it is invalid)", () => {
    const days = pg.json(`select json_object_agg(title, local_date) from public.planner_events;`);
    assert.deepEqual(days, { "Late session": TODAY, Lunch: TODAY, Call: "2026-11-17" });
    const legacy = pg.json(`select json_build_object('completed_at', completed_at, 'sort', sort_order) from public.planner_events where title = 'Late session';`);
    assert.deepEqual(legacy, { completed_at: null, sort: 0 }, "old completions keep a null completed_at instead of an invented time");
  });

  test("existing manual goals become long-term, increasing goals with totals taken from their entries", () => {
    const goal = pg.json(`select json_build_object('period', period, 'direction', direction, 'metric', metric, 'current', current_value) from public.goals;`);
    assert.deepEqual(goal, { period: "long_term", direction: "increase", metric: "manual", current: 9 });
  });

  test("the Phase 3 migrations can be applied again without errors or changes", () => {
    const before = pg.json(`select json_agg(row_to_json(e) order by id) from (select id, local_date, sort_order, status from public.planner_events) e;`);
    pg.applyMigrations({ from: PHASE3 });
    const after = pg.json(`select json_agg(row_to_json(e) order by id) from (select id, local_date, sort_order, status from public.planner_events) e;`);
    assert.deepEqual(after, before);
    const constraints = pg.json(`select json_agg(conname order by conname) from pg_constraint where conname in ('planner_events_event_type_check', 'goal_progress_entries_amount_check');`);
    assert.deepEqual(constraints, ["goal_progress_entries_amount_check", "planner_events_event_type_check"]);
  });
});
