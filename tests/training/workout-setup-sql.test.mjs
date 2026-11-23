// Runs every repo migration on a throwaway local Postgres (the Supabase stand-in in tests/support, no network, no
// real data) and checks 20261123100020: members who already saved an equipment list, or who finished the old
// onboarding (which asked the training questions), are backfilled as set up, others are not; a later run never
// counts a member who finished onboarding after the first run; a member saves their own setup time and demonstration model (male or female only) and cannot
// change another member's; running the file again changes nothing; exercise_media gains model and caption.
// Skipped when the Postgres binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR, available } from "../support/local-postgres.mjs";

const FILE = "20261123100020_fitx_workout_setup.sql";
const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
// C finished the old onboarding as a gym member and kept the full-gym default, so no equipment list was saved.
const C = "cccccccc-0000-4000-8000-0000000000c3";
// D finishes the new onboarding (which no longer asks) after the first run.
const D = "dddddddd-0000-4000-8000-0000000000d4";
const asA = { role: "authenticated", sub: A };
const asB = { role: "authenticated", sub: B };

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

describe("workout setup migration", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  const setupOf = (user) => pg.json(`select json_build_object('set', workout_setup_at is not null, 'model', demo_model) from public.user_preferences where user_id = '${user}';`);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: FILE });
    pg.exec(`insert into auth.users (id, email) values ('${A}', 'setup-a@example.test'), ('${B}', 'setup-b@example.test'), ('${C}', 'setup-c@example.test');
      update public.profiles set onboarded = true where id = '${C}';
      insert into public.user_preferences (user_id, workout_location, fitness_level, workouts_per_week)
        values ('${A}', 'home', 'beginner', 3), ('${B}', 'gym', 'beginner', 3), ('${C}', 'gym', 'intermediate', 4)
        on conflict (user_id) do nothing;
      insert into public.user_equipment_profiles (user_id, context, equipment_keys) values ('${A}', 'home', array['dumbbell']);`);
    pg.applyMigrations({ from: FILE });
  });

  after(() => pg?.stop());

  test("members with a saved equipment list or a finished onboarding are backfilled as set up, others are not", () => {
    assert.deepEqual(setupOf(A), { set: true, model: null });
    assert.deepEqual(setupOf(B), { set: false, model: null });
    assert.deepEqual(setupOf(C), { set: true, model: null }, "the old onboarding's answers count; it saved no list for the gym default");
    const kept = pg.json(`select json_build_object('l', workout_location, 'f', fitness_level, 'd', workouts_per_week) from public.user_preferences where user_id = '${C}';`);
    assert.deepEqual(kept, { l: "gym", f: "intermediate", d: 4 }, "the answers themselves are not changed");
  });

  test("a member saves their own setup; the model is male or female only", () => {
    assert.equal(pg.exec(`update public.user_preferences set workout_setup_at = now(), demo_model = 'female' where user_id = '${B}' returning 1;`, asB), "1");
    assert.deepEqual(setupOf(B), { set: true, model: "female" });
    const odd = pg.run(`update public.user_preferences set demo_model = 'robot' where user_id = '${B}';`, asB);
    assert.ok(!odd.ok && /user_preferences_demo_model_check/.test(odd.stderr), `an unknown model is refused: ${odd.stderr}`);
    assert.equal(pg.exec(`update public.user_preferences set demo_model = 'male' where user_id = '${A}' returning 1;`, asB), "", "another member's row is not changed");
    assert.deepEqual(setupOf(A), { set: true, model: null });
    assert.equal(pg.exec(`select demo_model from public.user_preferences where user_id = '${B}';`, asA), "", "nor read");
  });

  test("running the file again changes nothing, and never counts a member onboarded since", () => {
    pg.exec(`insert into auth.users (id, email) values ('${D}', 'setup-d@example.test');
      update public.profiles set onboarded = true where id = '${D}';
      insert into public.user_preferences (user_id) values ('${D}') on conflict (user_id) do nothing;`);
    const beforeRun = pg.json("select json_agg(json_build_object('u', user_id, 'at', workout_setup_at, 'm', demo_model) order by user_id) from public.user_preferences;");
    pg.applyFile(path.join(MIGRATIONS_DIR, FILE));
    const afterRun = pg.json("select json_agg(json_build_object('u', user_id, 'at', workout_setup_at, 'm', demo_model) order by user_id) from public.user_preferences;");
    assert.deepEqual(afterRun, beforeRun);
    assert.deepEqual(setupOf(D), { set: false, model: null });
  });

  test("exercise_media has model and caption with their checks", () => {
    const columns = pg.json("select json_agg(column_name order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'exercise_media' and column_name in ('model', 'caption');");
    assert.deepEqual(columns, ["caption", "model"]);
    const checks = pg.json("select json_agg(conname order by conname) from pg_constraint where conrelid = 'public.exercise_media'::regclass and conname in ('exercise_media_model_check', 'exercise_media_caption_check');");
    assert.deepEqual(checks, ["exercise_media_caption_check", "exercise_media_model_check"]);
    const check = pg.json(`select count(*)::int from information_schema.columns where table_schema = 'public'
      and ((table_name = 'user_preferences' and column_name in ('workout_setup_at', 'demo_model')) or (table_name = 'exercise_media' and column_name in ('model', 'caption')));`);
    assert.equal(check, 4, "the runbook Check query");
  });
});
