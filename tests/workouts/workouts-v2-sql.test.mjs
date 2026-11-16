// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network,
// no real data) and checks the Workouts v2 functions in 20261118130050 as a signed-in member: a timed
// movement (a target in seconds) starts without a rep target and never counts as a lift when the workout
// finishes, and a programme day done before its date ticks off its own planner item. Plans are saved,
// started and finished with the same functions the app calls.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LocalPostgres, available } from "../support/local-postgres.mjs";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const asA = { role: "authenticated", sub: A };
const IST = "Asia/Kolkata";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

const BENCH = { exercise_id: "bench_press", exercise_name: "Barbell Bench Press", target_sets: 2, reps_min: 6, reps_max: 8, rest_seconds: 150, target_weight_kg: 60, target_duration_seconds: null };
const PLANK = { exercise_id: "plank", exercise_name: "Front Plank", target_sets: 2, reps_min: 1, reps_max: 1, rest_seconds: 45, target_weight_kg: null, target_duration_seconds: 40 };

describe("Workouts v2 database functions", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;

  const json = (value) => `'${JSON.stringify(value)}'::jsonb`;
  /** Saves a plan as the member with the function the Workouts page uses; returns its id. */
  const savePlan = (plan, exercises) => pg.json(`select to_json(public.fitx_save_workout_plan(${json(plan)}, ${json(exercises)}));`, asA);
  /** Starts a session from the plan as the member; returns the session id. */
  const start = (plan) => pg.json(`select to_json(public.fitx_start_workout_session('${plan}') ->> 'session_id');`, asA);
  /** The session's sets as "exercise #set": target reps (null when none). */
  const targets = (session) => pg.json(`select json_object_agg(se.exercise_id || ' #' || ws.set_number, ws.target_reps order by se.sort_order, ws.set_number)
    from public.workout_sets ws join public.workout_session_exercises se on se.id = ws.session_exercise_id where se.session_id = '${session}';`);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations();
    pg.exec(`
      insert into auth.users (id, email) values ('${A}', 'timed@example.test');
      insert into public.user_preferences (user_id, timezone) values ('${A}', '${IST}');
    `);
  });

  after(() => pg?.stop());

  test("a timed movement's sets start without a rep target; a rep movement's aim for the middle of its range", () => {
    const plan = savePlan({ title: "Push and hold" }, [BENCH, PLANK]);
    const session = start(plan);
    assert.deepEqual(targets(session), { "bench_press #1": 7, "bench_press #2": 7, "plank #1": null, "plank #2": null });
    pg.exec(`update public.workout_sessions set status = 'abandoned' where id = '${session}';`, asA);
  });

  test("finishing counts lifts only: a hold logged as 1 rep, or with reps typed in, makes no record and adds no volume", () => {
    const plan = savePlan({ title: "Push and hold again" }, [BENCH, PLANK]);
    const session = start(plan);
    const log = (exercise, setNumber, values) => pg.exec(`update public.workout_sets ws set ${values}, completed_at = now()
      from public.workout_session_exercises se where se.id = ws.session_exercise_id and se.session_id = '${session}'
        and se.exercise_id = '${exercise}' and ws.set_number = ${setNumber};`, asA);
    log("bench_press", 1, "reps = 8, weight_kg = 60");
    log("bench_press", 2, "reps = 6, weight_kg = 70");
    // How the app saved a timed set before this fix: the pre-filled 1 rep with the seconds, here on a weighted plank.
    log("plank", 1, "reps = 1, weight_kg = 20, duration_seconds = 40");
    // Reps typed into a timed movement without seconds still are not a lift.
    log("plank", 2, "reps = 3, weight_kg = 20");
    const summary = pg.json(`select public.fitx_finish_workout_session('${session}', 1800, '${IST}');`, asA);
    assert.deepEqual({ sets: summary.sets, volume: Number(summary.total_volume), records: summary.records }, { sets: 4, volume: 8 * 60 + 6 * 70, records: 1 });
    const records = pg.json(`select json_agg(exercise_name order by exercise_name) from public.personal_records where user_id = '${A}';`);
    assert.deepEqual(records, ["Barbell Bench Press"], "no record for the plank");
    assert.equal(Number(pg.json(`select to_json(total_volume) from public.workout_sessions where id = '${session}';`)), 900);
  });

  test("a programme day done a day early ticks off its own planner item; a reusable plan's later item stays planned", () => {
    const enrolment = pg.json(`with e as (insert into public.programme_enrolments (user_id, programme_id, context, weekdays)
      values ('${A}', 'ppl-3', 'gym', '{1,3,5}') returning id) select to_json(id) from e;`, asA);
    const tomorrow = pg.json(`select to_json(((now() at time zone '${IST}')::date + 1)::text);`);
    const pull = savePlan({ title: "Pull · Push, Pull, Legs", planned_for: tomorrow, programme_enrolment_id: enrolment, programme_day_index: 1 }, [BENCH]);
    const reusable = savePlan({ title: "My push day", planned_for: tomorrow }, [BENCH]);
    // As the app schedules them: a one-hour workout item at 18:00 on the plan's date.
    const item = (plan, title) => pg.json(`with item as (insert into public.planner_events (user_id, event_type, title, workout_plan_id, starts_at)
      values ('${A}', 'workout', '${title}', '${plan}', ('${tomorrow}'::date + time '18:00') at time zone '${IST}') returning id)
      select to_json(id) from item;`, asA);
    const pullItem = item(pull, "Pull tomorrow");
    item(reusable, "Push tomorrow");
    const linkedTo = {};
    for (const plan of [pull, reusable]) {
      const session = start(plan);
      linkedTo[plan] = pg.json(`select to_json(planner_event_id) from public.workout_sessions where id = '${session}';`);
      pg.exec(`update public.workout_sets ws set reps = 8, weight_kg = 60, completed_at = now() from public.workout_session_exercises se
        where se.id = ws.session_exercise_id and se.session_id = '${session}' and ws.set_number = 1;`, asA);
      pg.json(`select public.fitx_finish_workout_session('${session}', 1800, '${IST}');`, asA);
    }
    assert.equal(linkedTo[pull], pullItem, "the programme day's session is linked to its own item when it starts");
    assert.equal(linkedTo[reusable], null, "a reusable plan's session is not");
    const status = pg.json(`select json_object_agg(title, status) from public.planner_events where user_id = '${A}';`);
    assert.deepEqual(status, { "Pull tomorrow": "completed", "Push tomorrow": "scheduled" });
    const progress = pg.json(`select json_build_object('next', next_day_index, 'done', sessions_completed) from public.programme_enrolments where id = '${enrolment}';`);
    assert.deepEqual(progress, { next: 2, done: 1 });
  });
});
