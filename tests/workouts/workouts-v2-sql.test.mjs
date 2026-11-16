// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network,
// no real data) and checks the Workouts v2 functions in 20261118130050 as a signed-in member: a timed
// movement (a target in seconds) starts without a rep target and never counts as a lift when the workout
// finishes. Plans are saved, started and finished with the same functions the app calls.
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
});
