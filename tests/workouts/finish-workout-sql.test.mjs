// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network,
// no real data) and checks that finishing a workout with fitx_finish_workout_session ticks off the planner
// item behind it through fitx_complete_workout_event: the item the session was started from, else the plan's
// workout on the session's day (untimed To-Do workouts included, nearest time first), else its latest
// overdue one; never a later day's, one item per finished workout, and only the session owner's rows.
// Workouts are saved, started and finished with the same functions the app calls, as signed-in members.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };
const IST = "Asia/Kolkata";
const TODAY = "2026-11-18";
// Session start times on TODAY in India (UTC+5:30).
const MORNING = "2026-11-18T03:30:00Z"; // 09:00
const EVENING = "2026-11-18T13:30:00Z"; // 19:00

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("finishing a workout ticks off the right planner item", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const plans = {};
  const items = {};

  const sql = (value) => (value === null || value === undefined ? "null" : `'${value}'`);

  /** A one-exercise plan, saved with the function the Workouts page uses. */
  const savePlan = (who, plan) => pg.json(`select to_json(public.fitx_save_workout_plan('${JSON.stringify(plan)}'::jsonb,
    '[{"exercise_id":"bench_press","exercise_name":"Barbell Bench Press","target_sets":1,"reps_min":8,"reps_max":8,"rest_seconds":90,"target_weight_kg":20}]'::jsonb));`, who);

  /** A planner item, added by the member: a To-Do with only a day, or an event with a start time. */
  const addItem = (who, title, { plan = null, day = null, at = null } = {}) => pg.json(`
    with item as (
      insert into public.planner_events (user_id, event_type, title, workout_plan_id, local_date, starts_at)
      values ('${who.sub}', 'workout', '${title}', ${sql(plan)}, ${sql(day)}, ${sql(at)}) returning id)
    select to_json(id) from item;`, who);

  /** Every item of the member's, title to status. */
  const statuses = (who) => pg.json(`select json_object_agg(title, status order by title) from public.planner_events where user_id = '${who.sub}';`);

  /** The titles whose status differs between two `statuses()` readings. */
  const changed = (before, after) => Object.keys(after).filter((title) => before[title] !== after[title]);

  /** Starts a session from the plan as the member, logs its set and returns the session id. */
  function start(who, plan, { startedAt = MORNING, from = null } = {}) {
    const session = pg.json(`select to_json(public.fitx_start_workout_session('${plan}') ->> 'session_id');`, who);
    // A fixed start time, so the session's day is known (the app cannot change it; the test database can).
    pg.exec(`update public.workout_sessions set started_at = '${startedAt}' where id = '${session}';`);
    // Started from a To-Do or planner item, as the app records it.
    if (from) pg.exec(`update public.workout_sessions set planner_event_id = '${from}' where id = '${session}';`, who);
    pg.exec(`update public.workout_sets ws set reps = 8, completed_at = now() from public.workout_session_exercises se
      where se.id = ws.session_exercise_id and se.session_id = '${session}';`, who);
    return session;
  }

  /** Finishes the session as the member, in the given time zone; returns the function's summary. */
  const finish = (who, session, tz = IST) => pg.json(`select public.fitx_finish_workout_session('${session}', 1800, ${sql(tz)});`, who);

  /** One whole workout; returns the summary and which items it ticked off. */
  function workout(who, plan, options = {}) {
    const before = statuses(who);
    const summary = finish(who, start(who, plan, options), options.tz === undefined ? IST : options.tz);
    return { summary, ticked: changed(before, statuses(who)) };
  }

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`
      insert into auth.users (id, email) values ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      insert into public.user_preferences (user_id, timezone) values ('${A}', '${IST}'), ('${B}', '${IST}');
    `);
    plans.push = savePlan(asA, { title: "Push day" });
    plans.legs = savePlan(asA, { title: "Legs day" });
    plans.run = savePlan(asA, { title: "Easy run" });
    plans.theirs = savePlan(asB, { title: "Push day" });
    for (const [who, plan] of [[asA, plans.push], [asB, plans.theirs]]) {
      const own = (items[who.sub] = {});
      own.earlierOverdue = addItem(who, "Push · 14 Nov", { plan, day: "2026-11-14" });
      own.overdue = addItem(who, "Push · 16 Nov", { plan, day: "2026-11-16" });
      own.todo = addItem(who, "Push · To-Do today", { plan, day: TODAY });
      own.at18 = addItem(who, "Push · 18:00 today", { plan, at: "2026-11-18T12:30:00Z" });
      own.at20 = addItem(who, "Push · 20:00 today", { plan, at: "2026-11-18T14:30:00Z" });
      own.tomorrow = addItem(who, "Push · tomorrow", { plan, day: "2026-11-19" });
    }
    items[A].legs = addItem(asA, "Legs · To-Do today", { plan: plans.legs, day: TODAY });
    items[A].run17 = addItem(asA, "Run · 17 Nov", { plan: plans.run, day: "2026-11-17" });
    items[A].run18 = addItem(asA, "Run · 18 Nov", { plan: plans.run, day: TODAY });
  });

  after(() => pg?.stop());

  test("the item a session was started from is ticked first, even with a nearer one that day", () => {
    const { summary, ticked } = workout(asA, plans.push, { from: items[A].at20 });
    assert.deepEqual(ticked, ["Push · 20:00 today"], "09:00 start: the untimed To-Do would be nearer");
    const { planner_event_id: tickedId, ...totals } = summary;
    assert.equal(tickedId, items[A].at20, "the finish function returns the item it ticked");
    assert.deepEqual(totals, { duration_seconds: 1800, total_volume: 160, sets: 1, records: 1 });
  });

  test("an untimed To-Do workout for the plan that day is ticked: it counts as at the session's start", () => {
    const { summary, ticked } = workout(asA, plans.push, { startedAt: MORNING });
    assert.deepEqual(ticked, ["Push · To-Do today"], "09:00: the To-Do before the 18:00 event");
    assert.equal(summary.planner_event_id, items[A].todo);
  });

  test("overdue items wait while the session's day still has one", () => {
    const { ticked } = workout(asA, plans.push, { startedAt: EVENING });
    assert.deepEqual(ticked, ["Push · 18:00 today"]);
    const now = statuses(asA);
    assert.equal(now["Push · 16 Nov"], "scheduled");
    assert.equal(now["Push · 14 Nov"], "scheduled");
  });

  test("with nothing left that day, the latest overdue item is ticked, then the one before; never a later day's", () => {
    assert.deepEqual(workout(asA, plans.push).ticked, ["Push · 16 Nov"]);
    assert.deepEqual(workout(asA, plans.push).ticked, ["Push · 14 Nov"]);
    const { summary, ticked } = workout(asA, plans.push);
    assert.deepEqual(ticked, [], "nothing on or before the session's day is left");
    assert.equal(summary.planner_event_id, null);
    assert.equal(statuses(asA)["Push · tomorrow"], "scheduled");
    assert.equal(statuses(asA)["Legs · To-Do today"], "scheduled", "another plan's item is not this workout's");
  });

  test("nothing is ticked twice: one item per finished workout, and a finished session cannot finish again", () => {
    const firstTicked = pg.json(`select to_json(completed_at) from public.planner_events where id = '${items[A].at20}';`);
    const session = start(asA, plans.legs);
    const summary = finish(asA, session);
    assert.equal(summary.planner_event_id, items[A].legs);
    const before = statuses(asA);
    const again = pg.run(`select public.fitx_finish_workout_session('${session}', 1800, '${IST}');`, asA);
    assert.equal(again.ok, false);
    assert.match(again.stderr, /already closed/);
    assert.deepEqual(statuses(asA), before, "the refused second finish ticks nothing");
    const completed = pg.json(`select json_object_agg(id, completed_at) from public.planner_events where user_id = '${A}' and status = 'completed';`);
    assert.equal(Object.keys(completed).length, 6, "six workouts finished with an item to tick, six items ticked");
    assert.equal(completed[items[A].at20], firstTicked, "an item ticked earlier keeps its time");
  });

  test("the session's day comes from the browser's time zone, else the saved one", () => {
    // 19:30 UTC on the 17th is 01:00 on the 18th in India.
    const late = "2026-11-17T19:30:00Z";
    assert.deepEqual(workout(asA, plans.run, { startedAt: late, tz: "UTC" }).ticked, ["Run · 17 Nov"], "UTC: still the 17th");
    assert.deepEqual(workout(asA, plans.run, { startedAt: late, tz: null }).ticked, ["Run · 18 Nov"], "no zone sent: the saved one, India");
  });

  test("another member's items are never touched, and nobody finishes or links someone else's session", () => {
    const theirs = statuses(asB);
    assert.ok(Object.values(theirs).every((status) => status === "scheduled"), "A's workouts left all of B's items alone");

    const mine = start(asA, plans.push);
    const byB = pg.run(`select public.fitx_finish_workout_session('${mine}', 1800, '${IST}');`, asB);
    assert.equal(byB.ok, false, "B cannot finish A's session");
    assert.match(byB.stderr, /already closed or does not exist/);
    const sneaky = pg.run(`update public.workout_sessions set planner_event_id = '${items[A].tomorrow}' where id = '${mine}';`, asB);
    assert.equal(pg.json(`select to_json(planner_event_id) from public.workout_sessions where id = '${mine}';`), null, `B cannot link an item to A's session (${sneaky.ok ? "no rows" : "denied"})`);
    const crossLink = pg.run(`update public.workout_sessions set planner_event_id = '${items[B].tomorrow}' where id = '${mine}';`, asA);
    assert.equal(crossLink.ok, false, "A cannot link B's item to A's session");
    finish(asA, mine);

    const before = statuses(asA);
    const { ticked } = workout(asB, plans.theirs);
    assert.deepEqual(ticked, ["Push · To-Do today"], "B's own workout ticks B's own item");
    assert.deepEqual(statuses(asA), before, "and none of A's");
  });

  test("a programme day still moves its programme on", () => {
    const enrolment = pg.json(`
      with e as (insert into public.programme_enrolments (user_id, programme_id, context, weekdays) values ('${A}', 'ppl-3', 'gym', '{1,3,5}') returning id)
      select to_json(id) from e;`, asA);
    const days = pg.json(`select count(*) from public.training_programme_days where programme_id = 'ppl-3';`);
    const plan = savePlan(asA, { title: "PPL · Legs", programme_enrolment_id: enrolment, programme_day_index: 2 });
    workout(asA, plan);
    const after = pg.json(`select json_build_object('next', next_day_index, 'done', sessions_completed) from public.programme_enrolments where id = '${enrolment}';`);
    assert.deepEqual(after, { next: 3 % days, done: 1 });
  });

  test("only signed-in members can finish a workout, and the draft signature is gone", () => {
    const access = pg.json(`select json_build_object(
      'anon', has_function_privilege('anon', 'public.fitx_finish_workout_session(uuid, integer, text)', 'execute'),
      'authenticated', has_function_privilege('authenticated', 'public.fitx_finish_workout_session(uuid, integer, text)', 'execute'),
      'draft', to_regprocedure('public.fitx_finish_workout_session(uuid, integer, timestamptz, timestamptz)'));`);
    assert.deepEqual(access, { anon: false, authenticated: true, draft: null });
  });
});
