// Every migration in supabase/migrations, applied the way the owner will apply them to production: in
// version order, one file at a time, each in a single transaction, on throwaway databases shaped like a
// Supabase project (tests/support/supabase-stub.sql):
//   fresh       every migration, on a new project;
//   production  the database production really has, then every pending migration (20261115100000 on).
//               Production's history holds the 14 September migrations and three changes applied there by
//               hand, with no file in supabase/migrations; tests/integration/fixtures/production-drift holds
//               those three byte for byte, and they run right after the September migrations, as there;
//   food last   production again, with the five food parts and 20261118200000 applied after every other
//               pending migration: the order the runbook (docs/runbooks/platform-database.md) allows.
// On the fresh and production databases:
//   * every migration (on production, every pending one) is applied a second time, in order, and must
//     neither fail nor move the database away from the fully migrated state (tables, columns, constraints,
//     indexes, policies, triggers, functions, grants, comments, row counts), except the problems listed
//     below with their reason;
//   * a migration that finds a table, column, index or extension already there is listed below, after
//     checking both definitions match;
//   * every table in public must have row level security on and at least one policy, except the tables
//     listed below with the reason they need none.
// Then:
//   * on the fresh database, an account created between the two runs must still have its intro film unseen
//     after the second;
//   * production must end exactly like the fresh database, reference rows included, apart from the leftovers
//     of production's hand-applied changes (PRODUCTION_LEFTOVERS), which nothing in the app, Admin or the
//     scripts uses and no pending migration changes. Columns are compared by name, not by position: in the six
//     tables experience 2.0 added columns to (exercise_library, custom_foods, workout_sessions, workout_sets,
//     workout_plan_exercises, workout_session_exercises), production has those before the ones the pending
//     migrations add. Nothing depends on that order (every insert names its columns, the app selects named
//     columns); keep it so: nothing may write those tables by position (`insert ... select *`, a row without
//     column names, `create table ... as table` restored positionally);
//   * on production, the runbook's own queries, read from the runbook itself, as the session runs them: every
//     Start, Before, Check, Smoke and Final query, the Records and History 0 and 2, each at the moment the
//     runbook gives it, must give what its Expect line says, or what RUNBOOK_PINNED holds where that line is
//     prose or this copy differs for a stated reason (runbookNotRun lists the few this copy cannot run). Start 10
//     and the Before queries for #1 and #2 must also catch what production may have saved since its copy was
//     made, and #2 must then stop. With the optional Backup made before #12, section 5 is run at the end: every
//     Undo block, newest first, each with the history delete it asks for. The history must then hold production's
//     17 rows and those of the files section 5 keeps; the exercise catalogue, and the fields and rules production
//     shares with experience 2.0, must be as before #1, #18's barcode check aside, with no workout left paused. The
//     undo of #18 must stop while a member has one barcode on two foods, until the runbook's fix has run;
//   * with the food parts last, every other pending migration applies without them, the final checks give the
//     same results right after #36, food search keeps answering meanwhile, and the end is exactly production's
//     with every file in version order.
// The first migration that fails stops the run: later ones may depend on it, so they are not applied
// and the checks that need the whole schema are skipped with the reason.
// Skipped when the PostgreSQL server binaries (initdb, pg_ctl, psql) are not on PATH.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LocalPostgres, MIGRATIONS_DIR, SUPABASE_STUB, available, requiresPgCron } from "../support/local-postgres.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
const CRON_MIGRATIONS = MIGRATIONS.filter((name) => requiresPgCron(path.join(MIGRATIONS_DIR, name)));
const NO_CRON =
  "needs the pg_cron extension, which Supabase provides and this local PostgreSQL does not have installed and preloaded";

// Production's migration history (supabase_migrations.schema_migrations, read 2026-11-17): the 14 September
// migrations, under the versions and names of the files here, then three changes applied by hand that no file
// here matches. Each fixture's md5 is md5(statements[1]) of its history row.
const PRODUCTION_HISTORY = [
  ["20260924162506", "initial_fitx_schema"],
  ["20260924164105", "harden_trigger_function_privileges"],
  ["20260924170604", "fitx_v1_core_product"],
  ["20260924171527", "fitx_preferences_water_goal"],
  ["20260924174525", "fitx_foreign_key_indexes"],
  ["20260930180637", "free_exercise_db_part_01"],
  ["20260930180649", "free_exercise_db_part_02"],
  ["20260930180652", "free_exercise_db_part_03"],
  ["20260930180655", "free_exercise_db_part_04"],
  ["20260930180659", "free_exercise_db_part_05"],
  ["20260930180706", "free_exercise_db_part_06"],
  ["20260930180709", "free_exercise_db_part_07"],
  ["20260930180714", "free_exercise_db_part_08"],
  ["20260930180717", "free_exercise_db_part_09"],
  ["20261002172610", "fitx_experience_2_0"],
  ["20261002172706", "fitx_share_access_and_index"],
  ["20261116093902", "fitx_admin_control_plane"],
];
const PRODUCTION_ONLY_MD5 = {
  "20261002172610_fitx_experience_2_0.sql": "8cade9d4cc29515551260735fbcca189",
  "20261002172706_fitx_share_access_and_index.sql": "a1d1251b3971a7e63274af58ff2ca142",
  "20261116093902_fitx_admin_control_plane.sql": "91921eac9b51cdf9a279008693d51944",
};
const FIXTURES_DIR = path.join(HERE, "fixtures", "production-drift");
const FIXTURES = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith(".sql")).sort();
/** The first migration production has not applied: it and every later one are pending. */
const FIRST_PENDING = "20261115100000";
const SEPTEMBER = MIGRATIONS.filter((name) => name < FIRST_PENDING);
const PENDING = MIGRATIONS.filter((name) => name >= FIRST_PENDING);
/**
 * The newest file production has applied since its copy was made (2026-11-27; tests/integration/applied-migrations
 * .test.mjs pins those files). The runbook's earlier sittings applied the pending files up to it and recorded them
 * under their own numbers; its current sitting (Start 1 and 2, History 0 to 2) applies the rest. There is no rest now:
 * #56, 20261126100000 (release 3: members' own foods may keep protein, carbs or fat unknown), was applied on
 * 2026-11-27, so THIS_SITTING is empty and the runbook says nothing is pending. When a new file is written,
 * THIS_SITTING is that file and the runbook names it as pending (as #56 was from its writing until 2026-11-27).
 */
const LAST_APPLIED = "20261126100000";
const APPLIED_SINCE = PENDING.filter((name) => name.slice(0, 14) <= LAST_APPLIED);
const THIS_SITTING = PENDING.filter((name) => name.slice(0, 14) > LAST_APPLIED);
/** The first file of production's latest sitting (2026-11-27: #56 alone; before it, 2026-11-25: #55 alone). */
const LATEST_SITTING_FROM = "20261126100000";
/**
 * The files Start 2 is for: this sitting's or, with nothing pending, the latest sitting's, whose list the runbook keeps
 * as its record. Start 2 runs before the first of them and again after the last file (section 6.1), as on that day.
 */
const START_2_SITTING = THIS_SITTING.length > 0 ? THIS_SITTING : APPLIED_SINCE.filter((name) => name.slice(0, 14) >= LATEST_SITTING_FROM);
const FOOD_PARTS = PENDING.filter((name) => /_fitx_food_catalog_seed_part_\d+\.sql$/.test(name));
/** Adds search words to six foods from the first food part, so it moves with the parts. */
const RAJMA = "20261118200000_fitx_food_catalog_rajma_keywords.sql";
const RAJMA_FOODS = [...readFileSync(path.join(MIGRATIONS_DIR, RAJMA), "utf8").matchAll(/'(\d+)',?\s+--/g)].map((match) => match[1]).sort();
const RUNBOOK = path.join(ROOT, "docs", "runbooks", "platform-database.md");
/**
 * #56 (release 3): protein, carbs and fat of members' own foods may be unknown. Section 3 also says what its Check
 * gives right before it ("Before #56 it gives ..."), so the session can run the Check first.
 */
const UNKNOWN_MACROS = "20261126100000_fitx_custom_food_unknown_macros.sql";

// Tables that have row level security on but no policy, on purpose. With no policy, anon and
// authenticated can reach no row even if granted; the test also checks they hold no privileges at all.
const NO_POLICY_BY_DESIGN = {
  fitx_rate_limits: "food search quota counters; only the security definer fitx_take_food_search_quota() reads and writes them (20261117110000)",
  ai_coach_limits: "daily coach limits set by the owner; read only inside the security definer coach quota functions (20261118150000)",
  ai_coach_usage_events: "coach usage counters; written only by the security definer quota functions, so members cannot reset their own limit (20261118150000)",
  fitx_admin_audit_logs: "Admin audit log, row level security forced; read and appended by service_role (which bypasses RLS) and the security definer Admin functions (20261118180000, 20261118180002)",
  billing_provider_events: "Razorpay event log; read by service_role only and written by billing_apply_event() (20261118190000)",
  billing_reconciliation_runs: "nightly Razorpay reconciliation results; read by service_role only and written by billing_record_reconciliation() (20261118190000)",
  admin_operators: "Admin operators and their scrypt hashes; read by service_role (bypasses RLS) and written only by the security definer fitx_admin_op_* functions (20261121100030)",
  admin_web_sessions: "Admin sessions (token hashes only); read and written by service_role from the Admin server (20261121100030)",
  admin_login_attempts: "Admin sign-in attempts (hashed username and IP keys); written only by the security definer fitx_admin_login_* functions, read by service_role (20261121100030)",
  fitx_member_write_budget: "each member's hourly write totals; written only by the security definer fitx_member_write_budget() trigger, so members cannot read or reset them, read by service_role (20261121100040)",
  social_challenge_templates: "FITX-written challenge templates, set in Admin through service_role (which bypasses RLS); members never read them, only the challenges made from them, in social_challenges (20261124100000)",
  social_moderation_actions: "Explore's moderation record (operators in Admin, community moderators); written and read by service_role and the security definer moderation functions, never by members (20261124100000)",
  social_storage_trash: "Explore files waiting to be removed through the Storage API; queued only by the security definer fitx_social_hourly() (the fitx-social-hourly job, service_role only), read and cleared by service_role from the server's sweep (20261124100000)",
};

// Migrations that cannot safely be applied a second time: the error they stop at, or the changes they
// make to the fully migrated database, and why that is acceptable. Both are part of the original schema
// the hosted project already has (the Phase 1 runbook's inventory builds on their tables), so Supabase's
// migration history never runs them again; they must never be pasted into the SQL editor again either.
const KNOWN_RERUN_PROBLEMS = {
  "20260924162506_initial_fitx_schema.sql": {
    changes: [
      /^added policy public\.profiles\.profiles_self: /,
      /^changed function public\.(handle_new_user|touch_updated_at)\(\): /,
      /^changed policy public\.(body_metrics|habits|meals|tasks|workouts)\.\1_owner: /,
    ],
    reason:
      "its header says it is safe to re-run, but run again it puts back its original profiles_self policy, handle_new_user() " +
      "(search_path public, unbounded metadata), touch_updated_at() without a pinned search_path and the owner policies for " +
      "workouts, meals, tasks, habits and body_metrics (to public, auth.uid() per row), undoing 20260924164105, " +
      "20260924170604 and 20261117100000",
  },
  "20260924170604_fitx_v1_core_product.sql": {
    error: /policy "user_preferences_owner" for table "user_preferences" already exists/,
    reason: "its create policy statements from user_preferences_owner on have no drop policy if exists",
  },
  "20261117100000_fitx_profiles_column_privileges.sql": {
    changes: [/^changed column public\.profiles\.date_of_birth: acl /],
    reason:
      "run again it takes back every profile update right and grants its 13 fields, so members lose 20261120100000's right to " +
      "set date_of_birth until that file runs again (it does, later in the order); the app then saves the age without the date",
  },
  "20261118110000_fitx_profile_v2.sql": {
    changes: [/^changed constraint public\.user_preferences\.user_preferences_primary_goal_check: /],
    reason:
      "run again it puts back its seven-goal rule, without 20261120100000's maintain_weight (the runbook says not to run it " +
      "again after a success); 20261120100000, run again after it, restores the eight-goal rule",
  },
  "20261118180001_fitx_admin_roles.sql": {
    changes: [/^changed function public\.fitx_admin_role_permissions\(p_role text\): /],
    reason:
      "run again it puts back its 16-permission role table; 20261124100020 (Explore's Admin file, the newest to define it), run " +
      "again after it, restores the 23-permission table that fitx_admin_op_can uses",
  },
  "20261118180003_fitx_admin_metrics.sql": {
    changes: [/^changed function public\.fitx_admin_(metrics\(\)|daily_trends\(p_days integer\)): /],
    reason:
      "run again it puts back its Dashboard counts, which leave out walks, runs and rides (production has it applied, so the " +
      "file stays as it is); 20261121100033, run again after it, restores the counts that include them",
  },
  "20261121100030_fitx_admin_v2.sql": {
    changes: [/^changed function public\.fitx_admin_role_permissions\(p_role text\): /],
    reason:
      "run again after 20261124100020 it puts back its 21-permission role table, without explore.view and explore.moderate; " +
      "20261124100020, run again after it, restores the 23-permission table",
  },
  "20261121100033_fitx_admin_ops.sql": {
    changes: [
      /^changed function public\.fitx_admin_op_save_platform_settings\(p_operator_id uuid, p_features jsonb, p_maintenance jsonb, p_site jsonb, p_expected_updated_at timestamp with time zone\): /,
    ],
    reason:
      "run again after 20261124100020 it puts back the five-switch settings save, which refuses explore and explore_video; " +
      "20261124100020, run again after it, restores the seven-switch save",
  },
  "20261123100060_fitx_social_v1.sql": {
    changes: [
      /^added function public\.fitx_social_save_notification_prefs\(p_follows boolean, p_follow_requests boolean, p_likes boolean, p_comments boolean, p_mentions boolean\): /,
      new RegExp(
        "^changed function public\\.fitx_social_(" +
          "add_comment|browse|can_comment|can_read_object|comments|create_post|delete_comment|delete_post|feed|me|member|" +
          "notification_prefs|notification_visible|notifications|notify|notify_mentions|post|post_json|report|safety_lists|" +
          "save_profile|saved|search|sees_comment|sees_posts|set_block|set_like|set_restrict|set_save|suggestions|trending|" +
          'unfollow|update_post|upload_allowed|viewer_sees_comment|viewer_sees_post)\\([^)]*\\): definition "[0-9a-f]{32}" -> "[0-9a-f]{32}"$',
      ),
      /^changed policy public\.(social_posts|social_post_media|social_comments)\.\1_read: using "(?:[^"\\]|\\.)*" -> "(?:[^"\\]|\\.)*"$/,
      // Its grant names the whole of social_reports, which also takes back 20261125100000's ten column reads.
      /^changed relation public\.social_reports: acl /,
      /^changed column public\.social_reports\.(id|user_id|target_type|target_id|target_user_id|reason|details|status|created_at|reviewed_at): acl /,
    ],
    reason:
      "run again after 20261124100000 it puts back part 1's definitions of the 36 Explore functions and the three read policies " +
      "(social_posts_read, social_post_media_read, social_comments_read) that 20261124100000 rewrites for moderation, sanctions " +
      "and item-level visibility, and adds back the five-parameter fitx_social_save_notification_prefs beside the nine-parameter " +
      "one; run again after 20261125100000 it gives members a read of every column of their own reports again, the evidence " +
      "included, in place of that file's ten column reads; production has it applied, so its history never runs it again, and it " +
      "must never be pasted into the SQL editor again while 20261124100000 is in place (only as the last step of section 5's undo " +
      "of #52, which comes after 20261125100000's undo, so nothing runs again after it there); run by mistake while both are in " +
      "place, 20261124100000 and then 20261125100000, run again after it, restore everything",
  },
};

// On a fresh database every migration creates what it declares. A later migration that finds a table,
// column, index or extension already there is either re-declaring it on purpose (listed here, after
// checking both definitions match) or conflicting with the earlier one.
const KNOWN_REDECLARATIONS = {
  "20261117100000_fitx_profiles_column_privileges.sql": {
    notices: [/^column "intro_completed_at" of relation "profiles" already exists, skipping$/],
    reason: "adds profiles.intro_completed_at timestamptz exactly as 20261117090000 does, so it also works when applied without it",
  },
};

// On production four pending migrations find objects that a hand-applied change made first: experience 2.0
// (20261002172610) or the old Admin draft (20261116093902). Each keeps the object, which has the definition the
// file gives it (production must end like the fresh database), and adds what is missing.
const KNOWN_PRODUCTION_REDECLARATIONS = {
  "20261115100000_fitx_workout_session_pause_timing.sql": {
    notices: [/^column "paused_at" of relation "workout_sessions" already exists, skipping$/],
    reason: "experience 2.0 added workout_sessions.paused_at timestamptz; on production this file adds active_duration_seconds and resumed_at",
  },
  "20261115110000_fitx_workout_prescription_targets.sql": {
    notices: [
      /^column "target_weight_kg" of relation "workout_plan_exercises" already exists, skipping$/,
      /^column "target_duration_seconds" of relation "workout_plan_exercises" already exists, skipping$/,
      /^column "target_weight_kg" of relation "workout_session_exercises" already exists, skipping$/,
      /^column "target_duration_seconds" of relation "workout_session_exercises" already exists, skipping$/,
      /^column "duration_seconds" of relation "workout_sets" already exists, skipping$/,
    ],
    reason:
      "experience 2.0 added the five target and duration columns with these types; on production this file adds its five range " +
      "checks and validates experience 2.0's three NOT VALID checks",
  },
  "20261118140001_fitx_nutrition_user_data.sql": {
    notices: [/^column "barcode" of relation "custom_foods" already exists, skipping$/],
    reason:
      "experience 2.0 added custom_foods.barcode text; this file adds custom_foods_barcode_check on its own and drops experience " +
      "2.0's two barcode rules",
  },
  "20261118180000_fitx_admin_control_plane.sql": {
    notices: [
      /^relation "fitx_admin_members" already exists, skipping$/,
      /^relation "fitx_admin_audit_logs" already exists, skipping$/,
      /^relation "fitx_admin_audit_logs_created_at_idx" already exists, skipping$/,
      /^relation "fitx_admin_audit_logs_actor_idx" already exists, skipping$/,
    ],
    reason: "the Admin draft created both tables and both indexes as this file declares them, apart from the audit log's key to accounts, which this file drops",
  },
};

// What experience 2.0 (20261002172610, 20261002172706) leaves on production after every pending migration and a
// fresh database never has. Production has no rows in any of it (2026-11-17); keeping, locking down or dropping it
// is the owner's decision (docs/runbooks/platform-database.md, section 1.8). Until a migration settles an entry,
// production must end with exactly these extras, as the hand-applied changes left them: remove the entry when one
// does. `names` are what code using an entry would have to name; nothing in the app, Admin or the scripts may.
// exercise_favorites was a leftover too until 20261119100020 adopted it, unchanged.
const LEFTOVER_TABLES = ["food_favorites", "outdoor_activities", "activity_shares", "user_release_reads"];
const PRODUCTION_LEFTOVERS = [
  {
    what:
      "the tables food_favorites, outdoor_activities, activity_shares and user_release_reads, with their " +
      "columns, keys, checks, indexes and owner-only policies; until 20261121100040 signed-in members could write their own rows " +
      "and signed-out visitors held every table privilege (no policy let them reach a row); it takes every right from both",
    keys: new RegExp(
      `^((relation|column|constraint|policy|trigger|rows) public\\.(${LEFTOVER_TABLES.join("|")})(\\.|$)|index public\\.(${LEFTOVER_TABLES.join("|")})_)`,
    ),
    names: LEFTOVER_TABLES,
  },
  {
    what:
      "get_activity_share(text): runs as its owner and returns the route coordinates saved in activity_shares for a share " +
      "token; signed-out visitors could call it until 20261121100040 took that right away",
    keys: /^function public\.get_activity_share\(p_token text\)$/,
    names: ["get_activity_share"],
  },
  {
    // aliases, tags and breathing are ordinary words in the code too; the app reads exercise_library through
    // explicit column lists (src/lib/training/catalog.ts) that name none of the five.
    what: "exercise_library.aliases, tags, form_cues, common_mistakes (text[], empty on every exercise) and breathing (text, null)",
    keys: /^column public\.exercise_library\.(aliases|tags|form_cues|common_mistakes|breathing)$/,
    names: ["form_cues", "common_mistakes"],
  },
  {
    // ingredients and allergens are ordinary words in the nutrition and coach code; the app reads custom_foods
    // through explicit column lists that name neither.
    what: "custom_foods.additional_nutrients (jsonb, {}), ingredients and allergens (text, null)",
    keys: /^column public\.custom_foods\.(additional_nutrients|ingredients|allergens)$/,
    names: ["additional_nutrients"],
  },
  {
    what:
      "workout_sessions.paused_duration_seconds (integer, 0) and rest_timer_ends_at, target_distance_meters on both exercise " +
      "tables and workout_sets.distance_meters",
    keys: /^column public\.(workout_sessions\.(paused_duration_seconds|rest_timer_ends_at)|workout_(plan|session)_exercises\.target_distance_meters|workout_sets\.distance_meters)$/,
    names: ["paused_duration_seconds", "rest_timer_ends_at", "target_distance_meters", "distance_meters"],
  },
  {
    what:
      "the checks workout_plan_exercises_targets_nonnegative, workout_session_exercises_targets_nonnegative and " +
      "workout_sets_time_distance_nonnegative, which also cover the distance columns (validated by 20261115110000)",
    keys: /^constraint public\.(workout_plan_exercises\.workout_plan_exercises_targets_nonnegative|workout_session_exercises\.workout_session_exercises_targets_nonnegative|workout_sets\.workout_sets_time_distance_nonnegative)$/,
    names: ["workout_plan_exercises_targets_nonnegative", "workout_session_exercises_targets_nonnegative", "workout_sets_time_distance_nonnegative"],
  },
];
/** Where the app, Admin and the scripts live (node_modules and build output left out). */
const APP_SOURCES = ["src", "admin/src", "admin/scripts", "scripts"];

// Everything a migration can change, keyed by object, so two snapshots can be compared. Columns are keyed by
// name, so their order is not compared (see the header). fitx_backup is left out: it holds the runbook's optional
// copy made before #12 ("Backup 20261118130010"), which the owner makes and no migration does.
const SNAPSHOT = `
with
schemas as (
  select oid, nspname from pg_namespace
  where nspname not in ('pg_catalog', 'information_schema', 'fitx_backup') and nspname !~ '^pg_(toast|temp_)'
),
extension_members as (select objid from pg_depend where deptype = 'e'),
rels as (
  select c.oid, s.nspname || '.' || c.relname as name, c.relkind
  from pg_class c join schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and c.oid not in (select objid from extension_members)
)
select jsonb_build_object(
  'schema', (select jsonb_object_agg(n.nspname, jsonb_build_object(
      'owner', n.nspowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(n.nspacl) a)))
    from pg_namespace n where n.oid in (select oid from schemas)),
  'relation', (select jsonb_object_agg(r.name, jsonb_build_object(
      'kind', c.relkind, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'options', c.reloptions,
      'owner', c.relowner::regrole::text,
      'acl', (select jsonb_agg(a::text order by a::text) from unnest(c.relacl) a),
      'comment', obj_description(c.oid, 'pg_class')))
    from rels r join pg_class c on c.oid = r.oid),
  'column', (select jsonb_object_agg(r.name || '.' || a.attname, jsonb_build_object(
      'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity, 'generated', a.attgenerated,
      'acl', (select jsonb_agg(x::text order by x::text) from unnest(a.attacl) x),
      'comment', col_description(a.attrelid, a.attnum)))
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum),
  'constraint', (select jsonb_object_agg(r.name || '.' || co.conname, jsonb_build_object(
      'definition', pg_get_constraintdef(co.oid), 'validated', co.convalidated))
    from rels r join pg_constraint co on co.conrelid = r.oid),
  'index', (select jsonb_object_agg(s.nspname || '.' || i.relname, pg_get_indexdef(i.oid))
    from pg_index x join pg_class i on i.oid = x.indexrelid join schemas s on s.oid = i.relnamespace
    where x.indrelid in (select oid from rels)),
  'policy', (select jsonb_object_agg(r.name || '.' || p.polname, jsonb_build_object(
      'command', p.polcmd, 'permissive', p.polpermissive,
      'roles', (select jsonb_agg(case when role_id = 0 then 'public' else role_id::regrole::text end
                                 order by case when role_id = 0 then 'public' else role_id::regrole::text end)
                from unnest(p.polroles) role_id),
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid)))
    from rels r join pg_policy p on p.polrelid = r.oid),
  'trigger', (select jsonb_object_agg(r.name || '.' || t.tgname, jsonb_build_object(
      'definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled))
    from rels r join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal),
  'function', (select jsonb_object_agg(s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      jsonb_build_object(
        'definition', md5(pg_get_functiondef(p.oid)), 'security_definer', p.prosecdef, 'config', p.proconfig,
        'owner', p.proowner::regrole::text,
        'acl', (select jsonb_agg(a::text order by a::text) from unnest(p.proacl) a),
        'comment', obj_description(p.oid, 'pg_proc')))
    from pg_proc p join schemas s on s.oid = p.pronamespace
    where p.prokind in ('f', 'p') and p.oid not in (select objid from extension_members)),
  'type', (select jsonb_object_agg(s.nspname || '.' || t.typname, jsonb_build_object(
      'kind', t.typtype, 'base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
      'labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)))
    from pg_type t join schemas s on s.oid = t.typnamespace
    where t.typtype in ('e', 'd') and t.oid not in (select objid from extension_members)),
  'extension', (select jsonb_object_agg(e.extname, jsonb_build_object('version', e.extversion, 'schema', e.extnamespace::regnamespace::text))
    from pg_extension e),
  'event_trigger', (select jsonb_object_agg(e.evtname, jsonb_build_object('event', e.evtevent, 'function', e.evtfoid::regproc::text))
    from pg_event_trigger e),
  'publication', (select jsonb_object_agg(pt.pubname || ' ' || pt.schemaname || '.' || pt.tablename, true) from pg_publication_tables pt),
  'default_acl', (select jsonb_object_agg(d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '*') || ' ' || d.defaclobjtype::text,
      (select jsonb_agg(a::text order by a::text) from unnest(d.defaclacl) a))
    from pg_default_acl d),
  'rows', (select jsonb_object_agg(r.name, (xpath('/row/n/text()', query_to_xml(
      format('select count(*) as n from %s', r.oid::regclass), false, true, '')))[1]::text::bigint)
    from rels r where r.relkind in ('r', 'p'))
)::text;`;

const RLS = `
select jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'rls', c.relrowsecurity,
      'policies', (select count(*) from pg_policy p where p.polrelid = c.oid),
      'anon', has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
              or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'),
      'authenticated', has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger')
              or has_any_column_privilege('authenticated', c.oid, 'select, insert, update, references'))
      order by c.relname), '[]'::jsonb)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')),
  'other_relations', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'kind', c.relkind,
      'security_invoker', coalesce(c.reloptions @> array['security_invoker=true'], false)) order by c.relname), '[]'::jsonb)
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm', 'f'))
)::text;`;

// Values that differ from one database to the next however the migrations ran: times and random ids.
const VOLATILE_DEFAULT = /\b(now|gen_random_uuid|uuid_generate_v4|clock_timestamp|statement_timestamp|transaction_timestamp)\(|\bCURRENT_(DATE|TIMESTAMP)\b/i;

/** Per table in a snapshot, the columns whose values every database must agree on: no times, no random ids. */
function stableColumns(snapshot) {
  const columns = {};
  for (const [key, column] of Object.entries(snapshot.column ?? {})) {
    const [schema, table, name] = key.split(".");
    if (!["r", "p"].includes(snapshot.relation?.[`${schema}.${table}`]?.kind)) continue;
    if (/^timestamp/.test(column.type) || VOLATILE_DEFAULT.test(column.default ?? "")) continue;
    (columns[`${schema}.${table}`] ??= []).push(name);
  }
  return columns;
}

/**
 * Per table, an md5 of its rows, each row reduced to `columns` (so a table with extra columns elsewhere still
 * compares); null for a table this database lacks. What the migrations wrote, not only how much.
 */
function rowDigests(pg, columns) {
  const tables = JSON.stringify(Object.entries(columns).sort().map(([name, cols]) => ({ name, cols }))).replaceAll("'", "''");
  return pg.json(`
select coalesce(jsonb_object_agg(t.name, case when to_regclass(t.name) is null then null else
  (xpath('/row/d/text()', query_to_xml(format(
    'select md5(coalesce(string_agg(r, chr(10) order by r), %L)) as d from ('
      'select (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(x)) e where e.key = any (%L::text[]))::text as r '
      'from %s x) s',
    '', t.cols, to_regclass(t.name)), false, true, '')))[1]::text end), '{}'::jsonb)::text
from jsonb_to_recordset('${tables}'::jsonb) as t (name text, cols text[]);`);
}

/** The error psql reported, from the first ERROR line on, with the migration's path shortened to its name. */
function errorText(stderr) {
  const lines = stderr.split("\n").filter((line) => !/there is (already a|no) transaction in progress/.test(line));
  const start = lines.findIndex((line) => /\bERROR:/.test(line));
  return (start === -1 ? lines : lines.slice(start))
    .map((line) => line.replace(/^psql:.*?([^/]+\.sql):(\d+): /, "$1:$2: "))
    .join("\n")
    .trim();
}

/** The "... already exists, skipping" notices psql printed while applying a file. */
function skippedNotices(stderr) {
  return [...stderr.matchAll(/NOTICE:\s+(.+ already exists, skipping)/g)].map((match) => match[1]);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function short(value) {
  const text = JSON.stringify(value) ?? "none";
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** One object's change: the fields that differ, or the whole value. */
function describeChange(a, b) {
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isRecord(a) || !isRecord(b)) return `${short(a)} -> ${short(b)}`;
  return Object.keys({ ...a, ...b })
    .filter((field) => !same(a[field], b[field]))
    .map((field) => `${field} ${short(a[field])} -> ${short(b[field])}`)
    .join("; ");
}

/**
 * What changed between two snapshots, one line per object. With a `reference` (the fully migrated
 * database), changes that bring an object back to it are listed apart as `restored`.
 */
function diff(before, after, reference) {
  const moved = [];
  const restored = [];
  for (const section of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[section] ?? {};
    const b = after[section] ?? {};
    const r = reference?.[section] ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      let line;
      if (!(key in a)) line = `added ${section} ${key}: ${short(b[key])}`;
      else if (!(key in b)) line = `removed ${section} ${key}`;
      else if (!same(a[key], b[key])) line = `changed ${section} ${key}: ${describeChange(a[key], b[key])}`;
      else continue;
      (reference && same(b[key], r[key]) ? restored : moved).push(line);
    }
  }
  return { moved: moved.sort(), restored: restored.sort() };
}

/** How two databases' ends differ, as "<section> <key>": only on the first, only on the second, or changed. */
function compareEnds(first, second) {
  const onlyFirst = [];
  const onlySecond = [];
  const changed = [];
  for (const section of new Set([...Object.keys(first), ...Object.keys(second)])) {
    const a = first[section] ?? {};
    const b = second[section] ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const object = `${section} ${key}`;
      if (!(key in b)) onlyFirst.push(object);
      else if (!(key in a)) onlySecond.push(object);
      else if (!same(a[key], b[key])) changed.push(`${object}: ${describeChange(a[key], b[key])}`);
    }
  }
  return { onlyFirst: onlyFirst.sort(), onlySecond: onlySecond.sort(), changed: changed.sort() };
}

const indent = (text) => `    ${text.replaceAll("\n", "\n    ")}`;

/**
 * Applies the migrations in order, each in one transaction, stopping at the first failure; `beforeFile` runs
 * right before each file that is applied, and `afterFile` right after each file that applied. Each file's entry says
 * whether it applied (with the notices it printed), was skipped (needs pg_cron) or failed.
 * @returns {{ status: Map<string, { first: { ok?: boolean, skipped?: string, error?: string, notices?: string[] }, second?: { ok: boolean, error: string | null, moved: string[], restored: string[] } }>, failure: { name: string, error: string } | null }}
 */
function applyInOrder(pg, names, cronUsable, { beforeFile = () => {}, afterFile = () => {} } = {}) {
  const status = new Map();
  for (const name of names) {
    if (!cronUsable && CRON_MIGRATIONS.includes(name)) {
      status.set(name, { first: { skipped: NO_CRON } });
      continue;
    }
    beforeFile(name);
    const result = pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
    if (!result.ok) {
      const failure = { name, error: errorText(result.stderr) };
      status.set(name, { first: { ok: false, error: failure.error } });
      return { status, failure };
    }
    status.set(name, { first: { ok: true, notices: skippedNotices(result.stderr) } });
    afterFile(name);
  }
  return { status, failure: null };
}

// The runbook's SQL blocks whose first line is "-- <label>", in order. `key` is how the runbook names a block
// ("Start 10", "Before 20261115110000", "Check 20261118140010 to 20261118140014", "Before undo 20261118140001"),
// `id` tells apart blocks that share a key ("Before 20261118120001 (2)"), and `expect` is what its Expect line says
// (after a note in brackets such as "Expect (as on 2026-11-17): ...").
const RUNBOOK_BLOCKS = (() => {
  const seen = {};
  return [...readFileSync(RUNBOOK, "utf8").matchAll(/^```sql\n-- ([^\n]+)\n([^]*?)^```$/gm)].map(([, label, body]) => {
    const key = label.match(/^[A-Z][a-z]+(?: [a-z]+)* (?:\d{14}(?: to \d{14})?|\d+)\b/)?.[0] ?? label;
    seen[key] = (seen[key] ?? 0) + 1;
    return { key, id: seen[key] === 1 ? key : `${key} (${seen[key]})`, expect: label.match(/\b[Ee]xpect(?: \([^)]*\))?:? (.+)$/)?.[1] ?? null, sql: `-- ${label}\n${body}`.trim() };
  });
})();

/** The runbook's SQL block with that id. */
function blockOf(id) {
  const block = RUNBOOK_BLOCKS.find((candidate) => candidate.id === id);
  if (!block) throw new Error(`docs/runbooks/platform-database.md has no SQL block that starts "-- ${id}"`);
  return block;
}

/** The blocks whose result the session compares with an Expect line: the ones that only read, and the Records. */
const SHOWS_A_RESULT = /^(Start|Before|Before undo|Check|Smoke|Later|Final|Record) |^History [02]$/;

/** A block's statements without its own begin and commit, to run inside a larger transaction. */
const statementsOf = (id) => blockOf(id).sql.replace(/^(begin|commit);$/gm, "");

/** A block's query as a subquery giving its rows as a json array, in column order. */
const rowsOf = (id) => `(select coalesce(json_agg(q), '[]') from (\n${blockOf(id).sql.replace(/;\s*$/, "")}\n) q)`;

/** The json values a script printed, one per line (json_agg's own line breaks taken out by the script). */
const printed = (stdout) => stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));

/**
 * Runs one of the runbook's single-statement blocks as the session would (a Record, which writes, through a
 * data-modifying CTE): `{ rows }`, each row an object in the query's column order, or `{ error }`.
 */
function runbookQuery(pg, block) {
  const result = pg.run(`with q as (\n${block.sql.replace(/;\s*$/, "")}\n)\nselect translate(coalesce(json_agg(q), '[]')::text, chr(10), ' ') from q;`);
  return result.ok ? { rows: printed(result.stdout).pop() } : { error: errorText(result.stderr) };
}

/** Whether rows are what an Expect line writes out: one row's values joined by ", " (t and f for booleans), or "no rows". */
function saysExactly(expect, rows) {
  if (expect === null || rows.length > 1) return false;
  if (rows.length === 0) return expect === "no rows";
  const value = (v) => (v === true ? "t" : v === false ? "f" : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));
  const text = Object.values(rows[0]).map(value).join(", ");
  return [text, `one row, ${text}`, `one row: ${text}`].includes(expect);
}

/** A history row as Start 1 and History 2 list it, for a migration file's name. */
const historyRow = (name) => ({ version: name.slice(0, 14), name: name.slice(15, -".sql".length) });
const PRODUCTION_ROWS = PRODUCTION_HISTORY.map(([version, name]) => ({ version, name }));
const byVersion = (rows) => [...rows].sort((a, b) => a.version.localeCompare(b.version));
/**
 * The files section 5 leaves in the history: #8, #9, #29 to #31 and #40 (it adopts what production already has) have
 * no undo SQL, and #15's and #20 to #24's undo only hide rows.
 */
const KEPT_BY_SECTION_5 = [8, 9, 15, 20, 21, 22, 23, 24, 29, 30, 31, 40];
/** Start 2's list: each pending file and the object that shows it is in. */
const START_2_LIST = [...blockOf("Start 2").sql.matchAll(/\('(\d{14})', '[a-z]+', '([^']+)'\)/g)].map(([, file, object]) => ({ file, object }));

// What the runbook's queries give on production's copy where their Expect line does not write the result out (prose,
// several rows, a choice), or where this copy differs for the reason given. Per block id, one entry per time the query
// runs, in order: the rows, or a function of (rows, { cron, cronAvailable }) giving what the rows must be. Every other
// query must give exactly what its Expect line says. The copy has no member rows, so counts of them are 0.
const RUNBOOK_PINNED = {
  // Before this sitting (today, with nothing pending): production's rows and every applied file under its own number.
  "Start 1": [byVersion([...PRODUCTION_ROWS, ...APPLIED_SINCE.map(historyRow)]), (rows, { cron }) =>
    // After section 5; #27's undo needs pg_cron, so without it its file keeps its row.
    byVersion([...PRODUCTION_ROWS, ...[...KEPT_BY_SECTION_5, ...(cron ? [] : [27])].map((number) => historyRow(PENDING[number - 1]))])],
  // Before the first file of its sitting (#56, kept as the 2026-11-27 sitting's record) its Expect line holds ("no
  // rows"); after the last file (section 6.1) it lists every row.
  "Start 2": [undefined, START_2_LIST],
  // The local cluster's postgres is a superuser; production's is not.
  "Start 3": [[{ applying_role: "postgres", rolsuper: true, rolbypassrls: true, owner_of_existing_tables: "postgres" }]],
  // pg_cron is listed where it is installed; pg_trgm is listed, and here it is not installed before #17.
  "Start 5": [(rows, { cronAvailable }) => [
    ...(cronAvailable ? [rows.find((row) => row.name === "pg_cron")] : []),
    { ...rows.find((row) => row.name === "pg_trgm"), installed_version: null, installed_in: null },
  ]],
  "Start 6": [[{ search_path: '"$user", public, extensions' }]],
  // Statistics lag behind writes, so the counts (and the order of tables with equal counts) vary from run to run.
  "Start 7": [(rows) => (rows.length > 0 && rows.length <= 10 && rows.every((row) => typeof row.table_name === "string" && Number.isInteger(row.rows))
    ? rows : "up to ten public tables, each with its number of rows")],
  "Start 8": [[
    { column_name: "version", data_type: "text", is_nullable: "NO" }, { column_name: "statements", data_type: "ARRAY", is_nullable: "YES" },
    { column_name: "name", data_type: "text", is_nullable: "YES" }, { column_name: "created_by", data_type: "text", is_nullable: "YES" },
    { column_name: "idempotency_key", data_type: "text", is_nullable: "YES" }, { column_name: "rollback", data_type: "ARRAY", is_nullable: "YES" },
  ]],
  "Before 20261115100000": [[]],
  "Before 20261117090000": [[{ accounts: 0 }]],
  "Check 20261117090000": [[{ accounts: 0, film_not_started: 0 }]],
  "Before 20261118110000": [[{ diets_to_fill: 0, food_rules_to_fill: 0 }]],
  "Check 20261118110000": [[{
    new_columns: 9, goal_rules: 1, new_goals_allowed: true, repair_runs_as_owner: true, repair_settings: 'search_path=""',
    members_can_repair: true, visitors_can_repair: false, diets_filled: 0, food_rules_filled: 0,
  }]],
  "Before 20261118120000": [[{ planner_items: 0, unknown_time_zones: 0, long_descriptions: 0 }]],
  "Before 20261118120001": [[{ totals_that_change: 0 }]],
  "Before 20261118120001 (2)": [[]],
  "Before 20261118130010": [[{ plan_rows: 0, history_rows: 0, record_rows: 0 }]],
  "Before 20261118130050": [[{ members: 0, workouts_to_close: 0 }]],
  "Check 20261118140000": [[{ pg_trgm_schema: "extensions", tables_with_row_security: 2, fuzzy_index: true, visitors_read: false, members_read: true, members_write: false }]],
  "Check 20261118140010 to 20261118140014": [[595, 627], [1012, 1812], [1437, 2984], [1872, 4100], [2302, 4929]].map(([foods, portions]) => [{ foods, portions }]),
  "Smoke 20261118140014": [[{ kind: "catalog", id: "2708346", name: "Idli" }]],
  "Check 20261118180000": [[{
    team_row_security_forced: true, audit_row_security_forced: true, server_reads_team: true, members_read_audit: false,
    admin_functions: 3, owner_bypasses_row_security: true, team_members: 0, links_to_accounts: 0,
  }]],
  "Check 20261118180001": [[{
    role_rule: "CHECK ((role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'support_agent'::text, 'content_editor'::text, 'viewer'::text])))",
    role_rules: 1, set_member_checks_roles: true, functions: 5, members_can_call: false,
  }]],
  "Check 20261118180003": [["fitx_admin_daily_trends", "fitx_admin_metrics"].map((proname) => ({ proname, runs_as_owner: true, members_can_call: false, server_can_call: true }))],
  "Check 20261118180004": [["fitx_admin_revoke_user_sessions", "fitx_admin_search_users"].map((proname) => (
    { proname, runs_as_owner: true, members_can_call: false, server_can_call: true, owner_can_end_sessions: true }))],
  "Check 20261118200000": [[
    ["2644289", "Beans, kidney, dark red, canned, sodium added, sugar added, drained and rinsed"],
    ["2644290", "Beans, kidney, light red, canned, sodium added, sugar added, drained and rinsed"],
    ["2707379", "Kidney beans, NFS"], ["2707380", "Kidney beans, from dried, fat added"],
    ["2707381", "Kidney beans, from dried, no added fat"], ["2707382", "Kidney beans, from canned, fat added"],
  ].map(([id, name]) => ({ id, name, has_rajma: true }))],
  "Final 2": [["admin_login_attempts", "admin_operators", "admin_web_sessions", "ai_coach_limits", "ai_coach_usage_events", "billing_provider_events",
    "billing_reconciliation_runs", "fitx_admin_audit_logs", "fitx_member_write_budget", "fitx_rate_limits", "social_challenge_templates",
    "social_moderation_actions", "social_storage_trash"].map((relname) => ({ relname }))],
  "History 2": [byVersion([...PRODUCTION_ROWS, ...PENDING.map(historyRow)])],
};

// Queries the runbook has that production's copy cannot run, and why.
const runbookNotRun = ({ cron }) => ({
  "Later 20261118160001": "it reads the clean-up job's runs on the day after #27",
  ...(cron ? {} : { "Before 20261118160001": NO_CRON, "Check 20261118160001": NO_CRON }),
});

/** The six files that go through the SQL editor (section 0.2) and are recorded with their own Record query. */
const inSqlEditor = (name) => name.startsWith("20261118130010_") || FOOD_PARTS.includes(name);

/** Runs History 1 (an update) and counts the history rows it gave their file's number: `{ ok, rows, stderr }`. */
function historyOne(pg) {
  const result = pg.run(`with q as (\n${blockOf("History 1").sql.replace(/;\s*$/, "")}\nreturning 1\n)\nselect count(*) from q;`);
  return { ok: result.ok, rows: result.ok ? Number(result.stdout) : null, stderr: result.stderr };
}

/** The day after the newest pending file's date (yyyymmdd), the simulated day the connector applies them. */
const APPLY_DAY = (() => {
  const newest = PENDING.at(-1).slice(0, 8);
  const day = new Date(Date.UTC(Number(newest.slice(0, 4)), Number(newest.slice(4, 6)) - 1, Number(newest.slice(6, 8)) + 1));
  return day.toISOString().slice(0, 10).replaceAll("-", "");
})();

/**
 * Production's migration history, then what the runbook's sittings do to it. The earlier sittings (#1 to #56): the
 * connector records each file it applies under the time it ran, the six SQL editor files are recorded with their
 * Record queries, then History 1 gives each its number. This sitting: Start 1 and Start 8 read those 73 rows, the
 * connector records this sitting's files under their times (none: nothing is pending), then History 0 to 2. `ask`
 * runs a runbook query and keeps its result; returns whether History 1 ran both times, and how many rows each run
 * gave their file's number.
 */
function historyAsTheRunbookLeavesIt(pg, ask) {
  pg.exec(`
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
insert into supabase_migrations.schema_migrations (version, name) values
  ${PRODUCTION_HISTORY.map(([version, name]) => `('${version}', '${name}')`).join(",\n  ")};`);
  const record = (name) => {
    const index = PENDING.indexOf(name);
    const { version, name: shortName } = historyRow(name);
    // The apply day's clock, a minute per file from 10:00 UTC on the day after the newest file: never one of the
    // files' own numbers.
    const appliedAt = `${APPLY_DAY}10${String(index).padStart(2, "0")}00`;
    if (inSqlEditor(name)) ask(blockOf(`Record ${version}`), `after #${index + 1}`);
    else pg.exec(`insert into supabase_migrations.schema_migrations (version, name) values ('${appliedAt}', '${shortName}');`);
  };
  APPLIED_SINCE.forEach(record);
  const earlier = historyOne(pg);
  const today = THIS_SITTING.length > 0 ? `before #${APPLIED_SINCE.length + 1}` : "today, with nothing pending";
  ask(blockOf("Start 1"), today);
  ask(blockOf("Start 8"), today);
  THIS_SITTING.forEach(record);
  ask(blockOf("History 0"), `after #${PENDING.length}`);
  const history1 = historyOne(pg);
  ask(blockOf("History 2"), "after History 1");
  if (!earlier.ok) return { outcome: `after the earlier sittings: ${errorText(earlier.stderr)}` };
  if (!history1.ok) return { outcome: errorText(history1.stderr) };
  return { outcome: "applied", earlier: earlier.rows, thisSitting: history1.rows };
}

// What production may have saved after its copy was made (2026-11-17) and the runbook's queries on the day must catch,
// rolled back: a workout paused the way experience 2.0 pauses (paused_at and its paused total), with a set of 0
// seconds, which #2's range check refuses. Start 10 and the Before queries for #1 and #2 run on it, then #2 itself.
const DAY_OF_MEMBER = "d0000000-0000-4000-8000-0000000000d1";
const DAY_OF_WORKOUT = "d0000000-0000-4000-8000-0000000000d2";
function whatTheDayOfQueriesCatch(pg) {
  const result = pg.run(`
begin;
insert into auth.users (id, email) values ('${DAY_OF_MEMBER}', 'day-of@example.test');
insert into public.workout_sessions (id, user_id, name, started_at, paused_at, paused_duration_seconds)
  values ('${DAY_OF_WORKOUT}', '${DAY_OF_MEMBER}', 'Paused as experience 2.0 does', now() - interval '40 minutes', now() - interval '10 minutes', 300);
insert into public.workout_session_exercises (id, user_id, session_id, exercise_name, sort_order)
  values ('d0000000-0000-4000-8000-0000000000d3', '${DAY_OF_MEMBER}', '${DAY_OF_WORKOUT}', 'Plank', 0);
insert into public.workout_sets (user_id, session_exercise_id, set_number, duration_seconds)
  values ('${DAY_OF_MEMBER}', 'd0000000-0000-4000-8000-0000000000d3', 1, 0);
select translate(json_build_object('Start 10', ${rowsOf("Start 10")}, 'Before 20261115100000', ${rowsOf("Before 20261115100000")},
  'Before 20261115110000', ${rowsOf("Before 20261115110000")})::text, chr(10), ' ');
\\i '${path.join(MIGRATIONS_DIR, PENDING[1])}'
rollback;`);
  return { rows: printed(result.stdout)[0] ?? null, second: result.ok ? "applied" : errorText(result.stderr) };
}

// The fields and rules production's experience 2.0 shares with #1, #2 and #18 (with what #18 and #19 add beside
// them), and the member rows the undo must handle: paused workouts and foods with a barcode.
const SHARED_WITH_EXPERIENCE_2 = {
  columns: [
    "custom_foods.archived_at", "custom_foods.barcode", "custom_foods.origin", "custom_foods.value_basis",
    "workout_plan_exercises.target_duration_seconds", "workout_plan_exercises.target_weight_kg",
    "workout_session_exercises.target_duration_seconds", "workout_session_exercises.target_weight_kg",
    "workout_sessions.active_duration_seconds", "workout_sessions.paused_at", "workout_sessions.resumed_at",
    "workout_sets.duration_seconds",
  ],
  rules: [
    "custom_foods_barcode_check", "custom_foods_barcode_format_check", "workout_plan_exercises_target_duration_seconds_check",
    "workout_plan_exercises_target_weight_kg_check", "workout_plan_exercises_targets_nonnegative",
    "workout_session_exercises_target_duration_seconds_check", "workout_session_exercises_target_weight_kg_check",
    "workout_session_exercises_targets_nonnegative", "workout_sets_duration_seconds_check", "workout_sets_time_distance_nonnegative",
  ],
  relations: ["custom_foods_user_barcode_idx", "custom_foods_user_barcode_unique", "meal_template_items", "meal_templates", "nutrition_targets"],
};
const list = (names) => names.map((name) => `'${name}'`).join(", ");
const SHARED_NOW = `
select jsonb_build_object(
  'columns', (select coalesce(jsonb_agg(table_name || '.' || column_name order by table_name || '.' || column_name), '[]')
              from information_schema.columns where table_schema = 'public' and table_name || '.' || column_name in (${list(SHARED_WITH_EXPERIENCE_2.columns)})),
  'rules', (select coalesce(jsonb_agg(conname order by conname), '[]') from pg_constraint
            where connamespace = 'public'::regnamespace and conname in (${list(SHARED_WITH_EXPERIENCE_2.rules)})),
  'relations', (select coalesce(jsonb_agg(relname order by relname), '[]') from pg_class
                where relnamespace = 'public'::regnamespace and relname in (${list(SHARED_WITH_EXPERIENCE_2.relations)})),
  'search_foods', to_regprocedure('public.search_foods(text,text[],integer)') is not null,
  'paused_workouts', (select count(*) from public.workout_sessions where paused_at is not null),
  'foods_with_a_barcode', (select count(*) from public.custom_foods where barcode is not null)
)::text;`;

// A member as the new app leaves them before section 5's undo: a workout paused through #1's fields, a food with a
// barcode, and a food with its protein and fat left unknown (#56, release 3). The undo must leave no workout paused
// (applied again, #1 would read it as paused with no time), keep the barcode, and turn the unknown values into the 0
// the app saved for a blank before #56, so the three columns can refuse NULL again.
const UNDO_MEMBER = "a5000000-0000-4000-8000-0000000000a5";
const MEMBER_BEFORE_THE_UNDO = `
insert into auth.users (id, email) values ('${UNDO_MEMBER}', 'undo@example.test');
insert into public.workout_sessions (user_id, name, active_duration_seconds, paused_at, resumed_at)
  values ('${UNDO_MEMBER}', 'Paused in the new app', 2701, now(), null);
insert into public.custom_foods (user_id, name, barcode) values ('${UNDO_MEMBER}', 'Parle-G', '8901063011366');
insert into public.custom_foods (user_id, name, serving_size, serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
  values ('${UNDO_MEMBER}', 'Masala chai (home)', '1 cup', 150, 60, null, 8, null);`;
/** The undo member's food with unknown values (#56), and whether each of its three columns refuses NULL. */
const UNKNOWN_FOOD_NOW = `
select jsonb_build_object(
  'values', (select jsonb_build_object('protein', protein_per_100g, 'carbs', carbs_per_100g, 'fat', fat_per_100g)
             from public.custom_foods where user_id = '${UNDO_MEMBER}' and name = 'Masala chai (home)'),
  'not_null', (select jsonb_object_agg(attname, attnotnull) from pg_attribute
               where attrelid = 'public.custom_foods'::regclass and attname in ('protein_per_100g', 'carbs_per_100g', 'fat_per_100g')));`;

/** Section 5's history step for a file: the delete the runbook gives, with the file's name in its placeholder. */
const HISTORY_DELETE = readFileSync(RUNBOOK, "utf8").match(/`(delete from supabase_migrations\.schema_migrations where name = '<the file name without number>'[^`]*)`/)?.[1];
/** Undo blocks that keep their file's history row (section 5): their undo only hides rows. */
const KEEPS_HISTORY_ROW = ["Undo 20261118130040", "Undo 20261118140010 to 20261118140014"];
const CRON_VERSIONS = CRON_MIGRATIONS.map((name) => name.slice(0, 14));

/**
 * Section 5 on production's copy, last, as the owner would run it: every Undo block as the runbook lists them,
 * newest first, each followed by the history delete it asks for, and each Before undo query where it stands. The
 * fix before an undo is left out: it runs only when its Before undo query is not 0. Returns each Undo block's outcome.
 */
function undoEverything(pg, ask, cronUsable) {
  const outcomes = [];
  for (const block of RUNBOOK_BLOCKS) {
    if (block.key.startsWith("Before undo ")) ask(block, "section 5");
    if (!block.key.startsWith("Undo ")) continue;
    const version = block.key.slice("Undo ".length);
    if (!cronUsable && CRON_VERSIONS.includes(version)) {
      outcomes.push({ id: block.id, skipped: NO_CRON });
      continue;
    }
    const result = pg.run(block.sql);
    const outcome = { id: block.id, error: result.ok ? null : errorText(result.stderr), historyError: null };
    if (result.ok && !KEEPS_HISTORY_ROW.includes(block.key)) {
      const removed = pg.run(HISTORY_DELETE.replace("<the file name without number>", historyRow(PENDING.find((name) => name.startsWith(version))).name));
      if (!removed.ok) outcome.historyError = errorText(removed.stderr);
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

// A member whose archived food has the barcode of another of their foods, which #18 allows and experience 2.0's rule
// does not. The undo of #19 and #18 runs on it, with or without the runbook's fix first; rolled back.
const BARCODE_MEMBER = "b0000000-0000-4000-8000-0000000000b1";
function undoWithOneBarcodeOnTwoFoods(pg, { fix }) {
  const result = pg.run(`
begin;
insert into auth.users (id, email) values ('${BARCODE_MEMBER}', 'barcodes@example.test');
insert into public.custom_foods (id, user_id, name, barcode, archived_at) values
  ('b0000000-0000-4000-8000-0000000000f1', '${BARCODE_MEMBER}', 'Parle-G, the old pack', '8901063011366', now()),
  ('b0000000-0000-4000-8000-0000000000f2', '${BARCODE_MEMBER}', 'Parle-G', '8901063011366', null);
select translate(${rowsOf("Before undo 20261118140001")}::text, chr(10), ' ');
${fix ? `${statementsOf("Fix before undo 20261118140001")}\nselect translate(${rowsOf("Before undo 20261118140001")}::text, chr(10), ' ');` : ""}
${statementsOf("Undo 20261118140002")}
${statementsOf("Undo 20261118140001")}
select json_build_object('barcodes', (select json_agg(barcode order by id) from public.custom_foods where user_id = '${BARCODE_MEMBER}'),
  'one_food_per_barcode', to_regclass('public.custom_foods_user_barcode_unique') is not null)::text;
rollback;`);
  return { printed: printed(result.stdout), error: result.ok ? null : errorText(result.stderr) };
}

/**
 * Applies every migration that applied the first time again, in order. Each one is judged by what it moves
 * away from the fully migrated database (`migrated`); putting back what an earlier re-run changed is listed
 * apart. Returns how the database still differs from `migrated` at the end.
 */
function applyAgain(pg, status, migrated) {
  let previous = migrated;
  for (const [name, entry] of status) {
    if (!entry.first.ok) continue;
    const result = pg.runFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
    const next = pg.json(SNAPSHOT);
    entry.second = { ok: result.ok, error: result.ok ? null : errorText(result.stderr), ...diff(previous, next, migrated) };
    previous = next;
  }
  return diff(migrated, previous).moved;
}

/** The stand-in, the September migrations and production's three hand-applied changes: production today. */
function buildProductionToday(pg) {
  pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
  for (const name of SEPTEMBER) pg.applyFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
  for (const name of FIXTURES) pg.applyFile(path.join(FIXTURES_DIR, name), { singleTransaction: true });
}

function assertAllApplied(t, { status, failure }, names, fix) {
  const applied = [...status.values()].filter((entry) => entry.first.ok).length;
  for (const [name, entry] of status) if (entry.first.skipped) t.diagnostic(`not applied: ${name}: ${entry.first.skipped}`);
  if (failure) {
    const notRun = names.length - names.indexOf(failure.name) - 1;
    assert.fail(
      `${failure.name} failed after the ${applied} migrations before it applied:\n${indent(failure.error)}\n` +
        `The ${notRun} migrations after it were not applied. ${fix}`,
    );
  }
  t.diagnostic(`${applied} of ${names.length} migrations applied in order`);
}

/** Notices about objects that were already there, unless a list explains them; and list entries never seen. */
function redeclarationProblems(t, status, lists) {
  const problems = [];
  const seen = new Set();
  for (const [name, entry] of status) {
    for (const notice of entry.first.notices ?? []) {
      const list = lists.find((known) => known[name]?.notices.some((pattern) => pattern.test(notice)));
      if (!list) {
        problems.push(
          `${name}: ${notice}. An earlier migration already created it: check both definitions match, then list it in ` +
            "KNOWN_REDECLARATIONS (KNOWN_PRODUCTION_REDECLARATIONS when a hand-applied change on production made it).",
        );
        continue;
      }
      const known = list[name];
      seen.add(known.notices.find((pattern) => pattern.test(notice)));
      t.diagnostic(`${name}: ${notice} (${known.reason})`);
    }
  }
  for (const list of lists) {
    for (const [name, known] of Object.entries(list)) {
      if (!status.get(name)?.first.ok) continue;
      for (const pattern of known.notices) if (!seen.has(pattern)) problems.push(`${name} no longer prints ${pattern}: remove it from the list`);
    }
  }
  return problems;
}

/** Re-runs that failed or moved the migrated database, unless KNOWN_RERUN_PROBLEMS explains them. */
function rerunProblems(t, status, stillDiffers) {
  const problems = [];
  let clean = 0;
  for (const [name, entry] of status) {
    const { second } = entry;
    if (!second) continue;
    const known = KNOWN_RERUN_PROBLEMS[name];
    const knownError = !second.ok && known?.error?.test(second.error);
    const unexpected = second.moved.filter((line) => !known?.changes?.some((pattern) => pattern.test(line)));
    if (!second.ok && !knownError) problems.push(`${name} fails when applied a second time:\n${indent(second.error)}`);
    if (unexpected.length) problems.push(`${name} changes the migrated database when applied a second time:\n${indent(unexpected.join("\n"))}`);
    if (known && second.ok && second.moved.length === unexpected.length) problems.push(`${name} no longer shows its known re-run problem: remove it from KNOWN_RERUN_PROBLEMS`);
    if (knownError) t.diagnostic(`cannot be re-run (known): ${name}: ${second.error.split("\n")[0]}: ${known.reason}`);
    if (known?.changes && second.moved.length > unexpected.length) {
      t.diagnostic(`unsafe to re-run (known): ${name}: ${known.reason}:\n${indent(second.moved.filter((line) => !unexpected.includes(line)).join("\n"))}`);
    }
    if (second.restored.length) t.diagnostic(`${name} put back what an earlier re-run changed:\n${indent(second.restored.join("\n"))}`);
    if (second.ok && !second.moved.length && !second.restored.length) clean += 1;
  }
  t.diagnostic(`${clean} migrations re-applied with no change at all`);
  if (stillDiffers.length) t.diagnostic(`after the second run the database still differs from the migrated one:\n${indent(stillDiffers.join("\n"))}`);
  return problems;
}

/** Public tables without row level security or a policy, unless NO_POLICY_BY_DESIGN explains them. */
function rlsProblems(t, rls) {
  const problems = [];
  const names = rls.tables.map((table) => table.name);
  for (const table of rls.tables) {
    const reason = NO_POLICY_BY_DESIGN[table.name];
    if (!table.rls) problems.push(`public.${table.name}: row level security is off`);
    if (!reason && table.policies === 0) problems.push(`public.${table.name}: no policy, so the API roles reach none of its rows; add one or list the table in NO_POLICY_BY_DESIGN with the reason`);
    if (reason && table.policies > 0) problems.push(`public.${table.name} now has ${table.policies} policies: remove it from NO_POLICY_BY_DESIGN`);
    if (reason && (table.anon || table.authenticated)) problems.push(`public.${table.name} has no policy by design, yet ${table.anon ? "anon" : "authenticated"} holds privileges on it`);
  }
  for (const name of Object.keys(NO_POLICY_BY_DESIGN)) if (!names.includes(name)) problems.push(`NO_POLICY_BY_DESIGN lists public.${name}, which no migration creates`);
  // Views and materialized views skip the policies of the tables they read unless they run as the caller.
  for (const relation of rls.other_relations) {
    if (relation.kind !== "v" || !relation.security_invoker) problems.push(`public.${relation.name} (relkind ${relation.kind}) bypasses row level security: use a view with security_invoker = true`);
  }
  for (const [name, reason] of Object.entries(NO_POLICY_BY_DESIGN)) t.diagnostic(`no policy by design: public.${name}: ${reason}`);
  t.diagnostic(`${names.length} public tables checked`);
  return problems;
}

/** The files of the app, Admin and the scripts that code could live in. */
function appSourceFiles() {
  const files = [];
  for (const dir of APP_SOURCES) {
    for (const entry of readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })) {
      const file = path.join(entry.parentPath, entry.name);
      if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs|sql|json|md)$/.test(entry.name) && !/[\\/](node_modules|\.next)[\\/]/.test(file)) files.push(file);
    }
  }
  return files;
}

/**
 * Each database's end, right after every migration's first run and before anything else touched it; and what the
 * final checks (section 6.1) gave on production then.
 */
const ends = { fresh: null, production: null, sixOne: null };
/** Section 6.1: Final 1 to 3, then Start 2 again. */
const SIX_ONE = ["Final 1", "Final 2", "Final 3", "Start 2"];

/** An account that signs up after the migrations were applied, before they are applied again. */
const LATER_MEMBER = "c0000000-0000-4000-8000-000000000001";

const skip = available() ? false : "Postgres binaries (initdb, pg_ctl, psql) are not installed";

test("migration files are named <14-digit version>_<name>.sql with unique versions", () => {
  const badNames = MIGRATIONS.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
  assert.deepEqual(badNames, [], "Supabase orders and records migrations by this version prefix");
  const versions = MIGRATIONS.map((name) => name.slice(0, 14));
  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);
  assert.deepEqual(duplicates, [], "two migrations share a version: Supabase would record only one of them");
});

test("production's history is the September migrations here, then the three fixtures, byte for byte", () => {
  const entry = (name) => [name.slice(0, 14), name.slice(15, -".sql".length)];
  const history = [...SEPTEMBER.map(entry), ...FIXTURES.map(entry)].sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(history, PRODUCTION_HISTORY, "production's replica must start where production's history does");
  for (const name of FIXTURES) {
    const md5 = createHash("md5").update(readFileSync(path.join(FIXTURES_DIR, name))).digest("hex");
    assert.equal(md5, PRODUCTION_ONLY_MD5[name], `${name} differs from md5(statements[1]) of its row in production's history; copy it again, read-only`);
  }
  const versions = new Set(MIGRATIONS.map((name) => name.slice(0, 14)));
  for (const name of FIXTURES) {
    assert.ok(!versions.has(name.slice(0, 14)), `supabase/migrations now has ${name.slice(0, 14)}: production's replica would apply that version twice`);
  }
});

test("the runbook applies and records every pending migration, and only those", () => {
  const runbook = readFileSync(RUNBOOK, "utf8");
  const order = [...runbook.matchAll(/^\| (\d+) \| `(\d{14}_[a-z0-9_]+)` \|/gm)];
  assert.deepEqual(order.map((match) => Number(match[1])), PENDING.map((_, index) => index + 1), "section 2 numbers the files 1, 2, 3 and so on");
  assert.deepEqual(order.map((match) => `${match[2]}.sql`), PENDING, "section 2 lists every pending migration, in version order");
  const history = runbook.match(/-- History 1 \(writes, once\)[^]*?\) as f \(version, name\)/)?.[0] ?? "";
  const recorded = [...history.matchAll(/\('(\d{14})', '([a-z0-9_]+)'\)/g)].map((match) => `${match[1]}_${match[2]}.sql`);
  assert.deepEqual(recorded, PENDING, "History 1 gives every pending migration its own version and name");
});

test("the runbook gives each file of this sitting (with nothing pending, of the latest one) the md5 of its final text, for the staged, md5-checked apply", () => {
  const runbook = readFileSync(RUNBOOK, "utf8");
  // Each md5 section 3 states, under its file's heading (a section ends at the next heading). With nothing pending, the
  // latest sitting's files keep theirs as its record, so those are required instead.
  const stated = new Map();
  for (const [, name, body] of runbook.matchAll(/^### #\d+ `(\d{14}_[a-z0-9_]+)`[^\n]*\n([^]*?)(?=^#{2,3} |(?![^]))/gm)) {
    const md5 = body.match(/md5 of the file \(`md5 -q`\): `([0-9a-f]{32})`/)?.[1];
    if (md5) stated.set(`${name}.sql`, md5);
  }
  assert.ok(START_2_SITTING.length > 0, "this sitting, or with nothing pending the latest one, has at least one file");
  for (const name of START_2_SITTING) assert.ok(stated.has(name), `section 3 gives ${name} its md5`);
  for (const [name, md5] of stated) {
    assert.ok(PENDING.includes(name), `section 3 gives an md5 for ${name}, which is not a migration file`);
    const actual = createHash("md5").update(readFileSync(path.join(MIGRATIONS_DIR, name))).digest("hex");
    assert.equal(md5, actual, `${name}: the runbook's md5 must be the file's (md5 -q ${name})`);
  }
});

test("Start 2 checks one object of each file of this sitting, or with nothing pending of the latest sitting, in order", () => {
  assert.deepEqual(START_2_LIST.map(({ file }) => file), START_2_SITTING.map((name) => name.slice(0, 14)));
});

test("each Statements block in the runbook is exactly what its file runs, without the file's comments and blank lines", (t) => {
  // Section 3 shows a small file's statements for the owner to read (#55, #56); the session still applies the file
  // itself.
  const blocks = RUNBOOK_BLOCKS.filter((block) => /^Statements \d{14}$/.test(block.key));
  assert.ok(blocks.length > 0, "section 3 shows the statements of #55 and #56");
  for (const block of blocks) {
    const version = block.key.slice("Statements ".length);
    const name = PENDING.find((file) => file.startsWith(`${version}_`));
    assert.ok(name, `${block.id}: no migration has the version ${version}`);
    const runs = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8").split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("--"));
    assert.deepEqual(block.sql.split("\n").slice(1), runs, `${block.id} differs from ${name}: copy the file's statements again`);
    t.diagnostic(`${block.id}: ${runs.length} lines, as in ${name}`);
  }
});

test("the runbook says where production stands and what is pending, as LAST_APPLIED has it", () => {
  const runbook = readFileSync(RUNBOOK, "utf8");
  /** The text of the runbook's top bullet that starts "- **<label>", its continuation lines joined. */
  const bullet = (label) => {
    const lines = runbook.slice(Math.max(0, runbook.indexOf(`\n- **${label}`) + 1)).split("\n");
    const kept = [lines[0]];
    for (const line of lines.slice(1)) {
      if (!line.startsWith("  ")) break;
      kept.push(line);
    }
    return kept.join(" ").replace(/\s+/g, " ").replace(/^- \*\*[^*]*\*\* /, "");
  };
  const rows = PRODUCTION_HISTORY.length + APPLIED_SINCE.length;
  const last = historyRow(APPLIED_SINCE.at(-1));
  assert.equal(blockOf("Start 1").expect, `${rows} rows, from ${PRODUCTION_HISTORY[0].join(" ")} to ${last.version} ${last.name}`);
  assert.match(blockOf("History 2").expect ?? "", new RegExp(`^${PRODUCTION_HISTORY.length + PENDING.length} rows in version order`));
  const stands = bullet("Where production stands");
  assert.ok(stands.includes(`${rows} rows in its history`), `the top says production's history has ${rows} rows: ${stands}`);
  assert.ok(stands.includes(`\`${last.version}\``), `the top names the last file applied, ${last.version}`);
  const pending = bullet("What is pending");
  if (THIS_SITTING.length === 0) assert.match(pending, /^nothing\./, "with every file applied, the top says nothing is pending");
  else for (const name of [THIS_SITTING[0], THIS_SITTING.at(-1)]) assert.ok(pending.includes(`\`${name.slice(0, 14)}\``), `the top names ${name} as pending`);
});

test("nothing in the app, Admin or the scripts uses what production's hand-applied changes left behind", () => {
  const names = PRODUCTION_LEFTOVERS.flatMap((leftover) => leftover.names);
  const pattern = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const uses = [];
  for (const file of appSourceFiles()) {
    const found = new Set([...readFileSync(file, "utf8").matchAll(pattern)].map((match) => match[1]));
    if (found.size) uses.push(`${path.relative(ROOT, file)}: ${[...found].join(", ")}`);
  }
  assert.deepEqual(uses, [], "code now uses a leftover: settle it with a migration (and take it out of PRODUCTION_LEFTOVERS) first");
});

describe("every migration on a fresh Supabase-shaped database", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  /** @type {ReturnType<typeof applyInOrder>} */
  let run = { status: new Map(), failure: null };
  let rls = null;
  /** How the database differs from the fully migrated one after the second run. */
  let stillDiffers = [];
  /** LATER_MEMBER's profile flag, read before and after the second run. */
  const laterMember = { beforeSecondRun: null, afterSecondRun: null };
  const notChecked = () => run.failure && `not checked: ${run.failure.name} failed on the first run`;

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyFile(SUPABASE_STUB, { singleTransaction: true });
    run = applyInOrder(pg, MIGRATIONS, pg.pgCronUsable());
    if (run.failure) return;
    rls = pg.json(RLS);
    const snapshot = pg.json(SNAPSHOT);
    const columns = stableColumns(snapshot);
    ends.fresh = { snapshot, columns, rows: rowDigests(pg, columns) };

    // Someone signs up after the release (sign-up's trigger creates the profile), so the second run
    // meets an account that has not seen its intro film yet.
    pg.exec(`insert into auth.users (id, email) values ('${LATER_MEMBER}', 'later@example.test');`);
    const introFlag = () => pg.json(`select json_build_object('intro_completed_at', intro_completed_at) from public.profiles where id = '${LATER_MEMBER}';`);
    laterMember.beforeSecondRun = introFlag();

    // Second run: every migration again, in order.
    stillDiffers = applyAgain(pg, run.status, pg.json(SNAPSHOT));
    laterMember.afterSecondRun = introFlag();
  });

  after(() => pg?.stop());

  test("every migration applies, in order, each in one transaction", (t) => {
    assertAllApplied(t, run, MIGRATIONS,
      "If the migration is wrong for Supabase, fix it (one already applied in production is never edited: add a new migration " +
        "instead); if a Supabase project has something tests/support/supabase-stub.sql lacks, add it there.");
  });

  for (const name of CRON_MIGRATIONS) {
    test(`${name} applies (needs pg_cron)`, (t) => {
      if (run.status.get(name)?.first.skipped) return t.skip(`not applied here: ${NO_CRON}; nothing after it depends on it`);
      if (!run.status.has(name)) return t.skip(`not reached: ${run.failure?.name ?? "an earlier step"} failed first`);
      assert.equal(run.status.get(name).first.ok, true, run.status.get(name).first.error);
    });
  }

  test("no migration re-creates what an earlier one created, unless both definitions match", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = redeclarationProblems(t, run.status, [KNOWN_REDECLARATIONS]);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("every migration can be applied a second time without errors or changes", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rerunProblems(t, run.status, stillDiffers);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("applying the migrations again never marks an account as having seen its intro film", (t) => {
    if (run.failure) return t.skip(notChecked());
    assert.deepEqual(laterMember.beforeSecondRun, { intro_completed_at: null }, "a new account starts with the film unseen");
    assert.deepEqual(laterMember.afterSecondRun, { intro_completed_at: null }, "the second run must leave it null, or the account never gets its film");
  });

  test("every public table has row level security on and at least one policy", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rlsProblems(t, rls);
    assert.ok(problems.length === 0, problems.join("\n"));
  });
});

// 20261117090000 adds profiles.intro_completed_at and marks the accounts that already exist as having seen
// the film (it used to play on every visit). Only the step that adds the column may do that: run again,
// a backfill would take the film away from everyone who signed up since. 20261117100000 adds the same
// column (its grant names it) and never backfills.
describe("the intro film flag on a database that already has accounts", { skip }, () => {
  const FLAG = "20261117090000_fitx_profiles_intro_flag.sql";
  const PRIVILEGES = "20261117100000_fitx_profiles_column_privileges.sql";
  /** @type {LocalPostgres} */
  let pg;
  const apply = (name) => pg.applyFile(path.join(MIGRATIONS_DIR, name), { singleTransaction: true });
  // Per account email: the flag, and whether it equals the profile's creation time.
  const flags = () => pg.json(`
    select json_object_agg(email, json_build_object('seen', intro_completed_at, 'at_creation', intro_completed_at = created_at))
    from public.profiles;`);

  before(() => {
    pg = new LocalPostgres().start();
    pg.applyMigrations({ before: FLAG.slice(0, 14) });
    pg.exec(`insert into auth.users (id, email) values ('e0000000-0000-4000-8000-000000000001', 'early@example.test');`);
  });

  after(() => pg?.stop());

  test("accounts that exist when the column is added count as having seen the film; later ones never do", () => {
    apply(FLAG);
    apply(PRIVILEGES);
    pg.exec(`insert into auth.users (id, email) values ('e0000000-0000-4000-8000-000000000002', 'later@example.test');`);
    const first = flags();
    assert.equal(first["early@example.test"].at_creation, true, "an account from before the migration counts as having seen it since it was created");
    assert.deepEqual(first["later@example.test"], { seen: null, at_creation: null });
    apply(FLAG);
    apply(PRIVILEGES);
    assert.deepEqual(flags(), first, "applying both again changes no account");
  });

  test("when 20261117100000 adds the column first, neither migration marks anyone", () => {
    pg.exec(`alter table public.profiles drop column intro_completed_at;`);
    apply(PRIVILEGES);
    apply(FLAG);
    assert.deepEqual(Object.values(flags()).map((flag) => flag.seen), [null, null]);
  });
});

describe("every pending migration on a copy of production's database", { skip }, () => {
  /** @type {LocalPostgres} */
  let pg;
  /** @type {ReturnType<typeof applyInOrder>} */
  let run = { status: new Map(), failure: null };
  let rls = null;
  let stillDiffers = [];
  /** Production's rows reduced to the fresh database's stable columns, so the two compare. */
  let rowsAsFresh = null;
  /** Production before the first pending migration. */
  let today = null;
  /** What the runbook's queries and steps give on production's copy (see `before`). */
  const runbook = {
    /** Per block id, each time the query ran: when, and its rows or error. */
    results: new Map(),
    context: { cron: false, cronAvailable: false },
    dayOf: null,
    backup: null,
    history1: null,
    /** SHARED_NOW before #1, after the 37 files and their second run, with a member's rows, after section 5. */
    shared: {},
    /** The exercise catalogue's rows before #1 and after section 5. */
    catalogue: {},
    barcodes: {},
    undo: [],
    /** #56's Check right before #56 (section 3 says what it gives then). */
    checkBeforeUnknownMacros: null,
    /** UNKNOWN_FOOD_NOW with the undo member's rows, and after section 5. */
    unknownFood: {},
  };
  const notChecked = () => run.failure && `not checked: ${run.failure.name} failed on the first run`;

  before(() => {
    pg = new LocalPostgres().start();
    buildProductionToday(pg);
    today = pg.json(SNAPSHOT);
    const cron = pg.pgCronUsable();
    /** Runs a runbook query and keeps its result under the block's id, with when it ran. */
    const ask = (block, at) => {
      const result = runbookQuery(pg, block);
      runbook.results.set(block.id, [...(runbook.results.get(block.id) ?? []), { at, ...result }]);
      return result;
    };
    const number = (name) => `#${PENDING.indexOf(name) + 1}`;
    const catalogue = { "public.exercise_library": Object.keys(today.column).filter((key) => key.startsWith("public.exercise_library.")).map((key) => key.split(".")[2]) };
    runbook.shared.today = pg.json(SHARED_NOW);
    runbook.catalogue.today = rowDigests(pg, catalogue);
    // Section 1 on the day: the Start queries (Start 1 and 8 read the history table, which this copy only gets
    // with the history steps below), and what they and the Before queries for #1 and #2 catch, rolled back.
    // Start 2 runs before the first file of its sitting (START_2_SITTING: with nothing pending, the latest sitting's,
    // #56).
    for (const block of RUNBOOK_BLOCKS) if (/^Start \d+$/.test(block.key) && !["Start 1", "Start 2", "Start 8"].includes(block.key)) ask(block, "before #1");
    runbook.dayOf = whatTheDayOfQueriesCatch(pg);
    // Each file with its Before queries first and its Checks and Smoke after; the optional backup copy before #12.
    run = applyInOrder(pg, PENDING, cron, {
      beforeFile: (name) => {
        if (name === START_2_SITTING[0]) ask(blockOf("Start 2"), `before ${number(name)}`);
        for (const block of RUNBOOK_BLOCKS) if (block.key === `Before ${name.slice(0, 14)}`) ask(block, `before ${number(name)}`);
        if (name.startsWith("20261118130010_")) runbook.backup = pg.run(blockOf("Backup 20261118130010").sql);
        // Not through `ask`: the session runs it before #56 only if it chooses to; its Expect line is for after.
        if (name === UNKNOWN_MACROS) runbook.checkBeforeUnknownMacros = runbookQuery(pg, blockOf(`Check ${name.slice(0, 14)}`));
      },
      afterFile: (name) => {
        const version = name.slice(0, 14);
        for (const block of RUNBOOK_BLOCKS) {
          const range = block.key.match(/^Check (\d{14}) to (\d{14})$/);
          if (block.key === `Check ${version}` || block.key === `Smoke ${version}` || (range && range[1] <= version && version <= range[2])) {
            ask(block, `after ${number(name)}`);
          }
        }
      },
    });
    runbook.context = { cron, cronAvailable: pg.json("select to_json(exists (select 1 from pg_available_extensions where name = 'pg_cron'))::text;") };
    if (run.failure) return;
    rls = pg.json(RLS);
    const snapshot = pg.json(SNAPSHOT);
    const columns = stableColumns(snapshot);
    ends.production = { snapshot, columns, rows: rowDigests(pg, columns) };
    if (ends.fresh) rowsAsFresh = rowDigests(pg, ends.fresh.columns);
    // Section 6.1 after the last file, kept for the food-last run to compare with.
    ends.sixOne = Object.fromEntries(SIX_ONE.map((id) => [id, ask(blockOf(id), "after #37")]));
    // Second run: every pending migration again, in order. The September migrations and the hand-applied
    // changes are in production's history, so nothing runs them again.
    stillDiffers = applyAgain(pg, run.status, snapshot);
    runbook.shared.end = pg.json(SHARED_NOW);
    runbook.history1 = historyAsTheRunbookLeavesIt(pg, ask);
    runbook.barcodes = { withoutFix: undoWithOneBarcodeOnTwoFoods(pg, { fix: false }), withFix: undoWithOneBarcodeOnTwoFoods(pg, { fix: true }) };
    // Section 5, last: a member's paused workout and barcode food, then every undo, then the history and catalogue.
    pg.exec(MEMBER_BEFORE_THE_UNDO);
    runbook.shared.member = pg.json(SHARED_NOW);
    runbook.unknownFood.member = pg.json(UNKNOWN_FOOD_NOW);
    runbook.undo = undoEverything(pg, ask, cron);
    runbook.shared.undone = pg.json(SHARED_NOW);
    runbook.unknownFood.undone = pg.json(UNKNOWN_FOOD_NOW);
    ask(blockOf("Start 1"), "after section 5");
    runbook.catalogue.undone = rowDigests(pg, catalogue);
  });

  after(() => pg?.stop());

  test("every pending migration applies on production's copy, in order, each in one transaction", (t) => {
    assertAllApplied(t, run, PENDING,
      "If production has something the copy lacks, add it to tests/integration/fixtures/production-drift only as production's " +
        "history recorded it; otherwise make the migration work on both databases.");
  });

  test("no pending migration re-creates what an earlier one or a hand-applied change created, unless both definitions match", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = redeclarationProblems(t, run.status, [KNOWN_REDECLARATIONS, KNOWN_PRODUCTION_REDECLARATIONS]);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("every pending migration can be applied a second time on production's copy without errors or changes", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rerunProblems(t, run.status, stillDiffers);
    assert.deepEqual(stillDiffers, [], "after the second run, production's copy must be as the first run left it");
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("this sitting's files apply twice on production's copy, and the second run changes nothing (section 3)", (t) => {
    if (run.failure) return t.skip(notChecked());
    if (THIS_SITTING.length === 0) return t.skip("nothing is pending");
    for (const name of THIS_SITTING) {
      assert.equal(KNOWN_RERUN_PROBLEMS[name], undefined, `${name} is this sitting's file: the runbook says a second run changes nothing`);
      const { first, second } = run.status.get(name) ?? {};
      assert.equal(first?.ok, true, `${name} applies the first time`);
      assert.deepEqual({ ok: second?.ok, error: second?.error, moved: second?.moved }, { ok: true, error: null, moved: [] }, `${name}, applied a second time`);
      t.diagnostic(`${name}: applied twice; the second run moved nothing`);
    }
  });

  test("#56's Check, run right before #56, gives what section 3 says it gives then", (t) => {
    if (!runbook.checkBeforeUnknownMacros && run.failure) return t.skip(`not checked: ${run.failure.name} failed before ${UNKNOWN_MACROS}`);
    const said = readFileSync(RUNBOOK, "utf8").match(/^Before #56 it gives `([^`]+)`/m)?.[1];
    assert.ok(said, "section 3 (#56) says what its Check gives before #56");
    const { rows, error } = runbook.checkBeforeUnknownMacros ?? { error: `${UNKNOWN_MACROS} was not reached` };
    assert.equal(error, undefined, `Check 20261126100000 failed before #56: ${error}`);
    assert.ok(saysExactly(said, rows), `before #56 the Check gives ${JSON.stringify(rows)}, but section 3 says ${said}`);
  });

  test("what #51's file moves when it runs again by mistake, #52's and then #55's files, run again after it, put back (section 0.1)", (t) => {
    if (run.failure) return t.skip(notChecked());
    // In the second run #51's file runs while #52 to #55 are in place, as a mistaken run on production would. The
    // runbook's remedy names only #52 and #55, so they must put back all of it, the reports' grants by #55.
    const second = (version) => run.status.get(PENDING.find((name) => name.startsWith(`${version}_`)))?.second;
    /** "changed function public.f(a integer): definition ..." -> "function public.f(a integer)" */
    const objects = (lines) => lines.map((line) => line.replace(/^(?:added|removed|changed) /, "").split(": ")[0]);
    const moved = objects(second("20261123100060").moved);
    const putBack = { reports: new Set(objects(second("20261125100000").restored)), rest: new Set(objects(second("20261124100000").restored)) };
    const onReports = (object) => /^\w+ public\.social_reports(\.|$)/.test(object);
    assert.ok(moved.some(onReports) && moved.some((object) => object.startsWith("function ")),
      `#51's file moves the reports' grants and part 2's functions: ${moved.join(", ")}`);
    const left = moved.filter((object) => !putBack[onReports(object) ? "reports" : "rest"].has(object));
    assert.deepEqual(left, [], "#55's file puts back the reports' grants and #52's everything else, so no other file needs to run again");
    t.diagnostic(`#51's file moves ${moved.length} objects: #52's file puts back ${moved.filter((object) => !onReports(object)).length}, #55's ${moved.filter(onReports).length}`);
  });

  test("every public table on production's copy has row level security on and at least one policy", (t) => {
    if (run.failure) return t.skip(notChecked());
    const problems = rlsProblems(t, rls);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("production ends exactly like a fresh database, apart from its hand-applied changes' leftovers", (t) => {
    if (run.failure) return t.skip(notChecked());
    if (!ends.fresh) return t.skip("not checked: the fresh database did not finish its first run");
    const { onlyFirst: onlyFresh, onlySecond: onlyProduction, changed } = compareEnds(
      { ...ends.fresh.snapshot, data: ends.fresh.rows },
      { ...ends.production.snapshot, data: rowsAsFresh },
    );
    const leftover = (key) => PRODUCTION_LEFTOVERS.find((entry) => entry.keys.test(key));
    const problems = [
      ...onlyFresh.map((key) => `${key}: a pending migration makes it on a fresh database but not on production (did it skip an object of the same name?)`),
      ...changed.map((line) => `${line} (fresh -> production): a pending migration ends differently on production`),
      ...onlyProduction.filter((key) => !leftover(key)).map((key) =>
        `${key}: only on production. If a hand-applied change made it and nothing uses it, list it in PRODUCTION_LEFTOVERS with the reason; if a pending migration should make or remove it, fix that migration`),
    ];
    for (const entry of PRODUCTION_LEFTOVERS) {
      const keys = onlyProduction.filter((key) => entry.keys.test(key));
      if (keys.length === 0) problems.push(`PRODUCTION_LEFTOVERS lists ${entry.what}, but production no longer differs there: remove the entry`);
      else t.diagnostic(`left for the owner: ${entry.what} (${keys.length} ${keys.length === 1 ? "object" : "objects"})`);
    }
    // A check added NOT VALID was never run against the rows already there; the leftovers' must have been since.
    for (const key of onlyProduction.filter((name) => name.startsWith("constraint "))) {
      if (!ends.production.snapshot.constraint[key.slice("constraint ".length)].validated) problems.push(`${key} is still NOT VALID on production`);
    }
    t.diagnostic(`${Object.keys(ends.fresh.rows).length} tables' rows and ${Object.keys(ends.fresh.snapshot.function ?? {}).length} functions compared`);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("the pending migrations leave those leftovers as they found them, apart from checking experience 2.0's three workout checks and 20261121100040's lock-down", (t) => {
    if (run.failure) return t.skip(notChecked());
    /** Each leftover object, keyed "<section> <key>". */
    const leftovers = (snapshot) => Object.fromEntries(Object.entries(snapshot).flatMap(([section, objects]) =>
      Object.entries(objects ?? {}).map(([key, value]) => [`${section} ${key}`, value])
        .filter(([object]) => PRODUCTION_LEFTOVERS.some((entry) => entry.keys.test(object)))));
    const before = leftovers(today);
    const end = leftovers(ends.production.snapshot);
    // 20261115110000 validates those three: the definition loses its NOT VALID and the check is marked validated.
    const validated = (a, b) => a?.validated === false && b?.validated === true && a.definition === `${b.definition} NOT VALID`;
    // 20261121100040 takes the API roles' rights away: from the four tables both lose every privilege, and signed-out
    // visitors lose get_activity_share. Nothing else about them may change, and no other right may go or come.
    const lockedDown = (object, a, b) => {
      const roles = object.startsWith("relation ") ? ["anon", "authenticated"] : object.startsWith("function ") ? ["anon"] : [];
      if (!roles.length || !a?.acl || !b) return false;
      const ofRoles = (entry) => roles.some((role) => entry.startsWith(`${role}=`));
      return roles.every((role) => a.acl.some((entry) => entry.startsWith(`${role}=`)))
        && same({ ...a, acl: a.acl.filter((entry) => !ofRoles(entry)) }, b);
    };
    const moved = [];
    let checked = 0;
    let locked = 0;
    for (const object of [...new Set([...Object.keys(before), ...Object.keys(end)])].sort()) {
      if (!(object in end)) moved.push(`${object}: removed`);
      else if (!(object in before)) moved.push(`${object}: added`);
      else if (validated(before[object], end[object])) checked += 1;
      else if (lockedDown(object, before[object], end[object])) locked += 1;
      else if (!same(before[object], end[object])) moved.push(`${object}: ${describeChange(before[object], end[object])}`);
    }
    assert.deepEqual(moved, [], "the leftovers are the owner's to decide about: no pending migration may change them beyond the lock-down");
    assert.equal(checked, 3, "the three checks experience 2.0 added NOT VALID are validated");
    assert.equal(locked, 5, "20261121100040 locks down the four tables and get_activity_share");
    t.diagnostic(`${Object.keys(before).length} leftover objects compared`);
  });

  test("each runbook query that shows a result gives what the runbook expects, when the runbook runs it", (t) => {
    if (run.failure) return t.skip(notChecked());
    const shown = RUNBOOK_BLOCKS.filter((block) => SHOWS_A_RESULT.test(block.key));
    const notRun = runbookNotRun(runbook.context);
    const problems = Object.keys(RUNBOOK_PINNED).filter((id) => !shown.some((block) => block.id === id)).map((id) => `RUNBOOK_PINNED has ${id}, which the runbook no longer has`);
    let compared = 0;
    for (const block of shown) {
      const runs = runbook.results.get(block.id) ?? [];
      if (notRun[block.id]) {
        if (runs.length) problems.push(`${block.id} ran here: take it out of runbookNotRun`);
        else t.diagnostic(`not run here: ${block.id}: ${notRun[block.id]}`);
        continue;
      }
      if (!runs.length) problems.push(`${block.id} never ran: run it when the runbook does, or say in runbookNotRun why it cannot run here`);
      const pinned = RUNBOOK_PINNED[block.id];
      if (pinned && pinned.length !== runs.length) problems.push(`${block.id} ran ${runs.length} times; RUNBOOK_PINNED holds ${pinned.length} results for it`);
      runs.forEach(({ at, rows, error }, index) => {
        compared += 1;
        if (error) return problems.push(`${block.id} (${at}) failed:\n${indent(error)}`);
        const want = typeof pinned?.[index] === "function" ? pinned[index](rows, runbook.context) : pinned?.[index];
        if (want === undefined && !saysExactly(block.expect, rows)) {
          problems.push(`${block.id} (${at}) gives ${JSON.stringify(rows)}, but its Expect line says ${JSON.stringify(block.expect)}`);
        } else if (want !== undefined && !isDeepStrictEqual(rows, want)) {
          problems.push(`${block.id} (${at}) gives ${JSON.stringify(rows)}; RUNBOOK_PINNED holds ${JSON.stringify(want)}`);
        } else if (want !== undefined && saysExactly(block.expect, rows)) {
          problems.push(`${block.id} (${at}): its Expect line already says ${JSON.stringify(block.expect)}; take it out of RUNBOOK_PINNED`);
        }
      });
    }
    t.diagnostic(`${compared} results of ${shown.length} runbook queries compared`);
    assert.ok(problems.length === 0, problems.join("\n"));
  });

  test("on the day, Start 10 and the Before queries for #1 and #2 catch what production may have saved since its copy, and #2 stops", () => {
    const { rows, second } = runbook.dayOf;
    assert.deepEqual(rows["Start 10"], [{
      rows_in_the_five_tables: 0, custom_foods_with_a_barcode: 0, admin_team_members: 0, admin_audit_rows: 0,
      workouts_with_experience_2_pauses: 1, rows_with_distances: 0, custom_foods_with_extra_fields: 0, exercises_with_extra_fields: 0,
    }], "Start 10 counts the workout paused the way experience 2.0 pauses");
    assert.deepEqual(rows["Before 20261115100000"].map(({ id, hours_since_start }) => ({ id, hours_since_start })), [{ id: DAY_OF_WORKOUT, hours_since_start: 0.7 }],
      "#1's Before query lists the open workout and the hours since it was started");
    assert.deepEqual(rows["Before 20261115110000"], [{ planned_exercises: 0, live_exercises: 0, sets: 1 }], "#2's Before query counts the set of 0 seconds");
    assert.match(second, /check constraint "workout_sets_duration_seconds_check" of relation "workout_sets" is violated by some row/, "#2 then stops, as section 4 says");
  });

  test("section 5 runs every Undo block, newest first, and gives back the catalogue and what production shares with experience 2.0", (t) => {
    if (run.failure) return t.skip(notChecked());
    assert.ok(runbook.backup?.ok, `Backup 20261118130010 failed before #12: ${runbook.backup && errorText(runbook.backup.stderr)}`);
    const problems = [];
    for (const { id, skipped, error, historyError } of runbook.undo) {
      if (skipped) t.diagnostic(`not run here: ${id}: ${skipped}`);
      else if (error) problems.push(`${id} failed:\n${indent(error)}`);
      else if (historyError) problems.push(`${id}: its history delete failed:\n${indent(historyError)}`);
    }
    assert.ok(problems.length === 0, problems.join("\n"));
    t.diagnostic(`${runbook.undo.filter((outcome) => !outcome.skipped).length} Undo blocks run`);
    assert.deepEqual(runbook.catalogue.undone, runbook.catalogue.today, "with the Backup, the undo of #12 and #11 gives the exercise catalogue back as it was before #1");
    const { today, end, member, undone } = runbook.shared;
    const experience2 = {
      columns: [
        "custom_foods.barcode", "workout_plan_exercises.target_duration_seconds", "workout_plan_exercises.target_weight_kg",
        "workout_session_exercises.target_duration_seconds", "workout_session_exercises.target_weight_kg",
        "workout_sessions.paused_at", "workout_sets.duration_seconds",
      ],
      rules: ["custom_foods_barcode_format_check", "workout_plan_exercises_targets_nonnegative", "workout_session_exercises_targets_nonnegative", "workout_sets_time_distance_nonnegative"],
      relations: ["custom_foods_user_barcode_unique"],
      search_foods: false,
      paused_workouts: 0,
      foods_with_a_barcode: 0,
    };
    assert.deepEqual(today, experience2, "before #1: experience 2.0's fields, its checks and its two barcode rules");
    assert.deepEqual(end, {
      columns: SHARED_WITH_EXPERIENCE_2.columns,
      rules: SHARED_WITH_EXPERIENCE_2.rules.filter((name) => name !== "custom_foods_barcode_format_check"),
      relations: SHARED_WITH_EXPERIENCE_2.relations.filter((name) => name !== "custom_foods_user_barcode_unique"),
      search_foods: true,
      paused_workouts: 0,
      foods_with_a_barcode: 0,
    }, "after the 37 files: #18's barcode rules in place of experience 2.0's");
    assert.deepEqual(member, { ...end, paused_workouts: 1, foods_with_a_barcode: 1 }, "a member has paused a workout and saved a food with a barcode");
    assert.deepEqual(undone, { ...experience2, rules: ["custom_foods_barcode_check", ...experience2.rules.slice(1)], foods_with_a_barcode: 1 },
      "after section 5: what experience 2.0 had, its one food per barcode included, #18's barcode check in place of its own, no workout left paused, the member's barcode kept");
  });

  test("section 5's undo of #56 turns a member's unknown protein, carbs or fat into 0 and the three columns refuse NULL again", (t) => {
    if (run.failure) return t.skip(notChecked());
    const { member, undone } = runbook.unknownFood;
    const allThree = (value) => ({ protein_per_100g: value, carbs_per_100g: value, fat_per_100g: value });
    assert.deepEqual(member, { values: { protein: null, carbs: 8, fat: null }, not_null: allThree(false) }, "with #56 in place a member saved a food with protein and fat unknown");
    assert.deepEqual(undone, { values: { protein: 0, carbs: 8, fat: 0 }, not_null: allThree(true) },
      "after section 5 the unknowns are 0, what the app saved for a blank before #56, and the rule is back as the September file made it");
  });

  test("the undo of #18 stops while a member has one barcode on two foods, and goes through after the runbook's fix", (t) => {
    if (run.failure) return t.skip(notChecked());
    const { withoutFix, withFix } = runbook.barcodes;
    assert.deepEqual(withoutFix.printed, [[{ barcodes_on_two_foods: 1 }]], "its Before undo query finds the barcode");
    assert.match(withoutFix.error ?? "", /could not create unique index "custom_foods_user_barcode_unique"/, "without the fix the undo stops, in one transaction");
    assert.equal(withFix.error, null, "with the fix the undo goes through");
    assert.deepEqual(withFix.printed, [
      [{ barcodes_on_two_foods: 1 }],
      [{ barcodes_on_two_foods: 0 }],
      { barcodes: [null, "8901063011366"], one_food_per_barcode: true },
    ], "the fix takes the barcode off the archived food only, and experience 2.0's rule comes back");
  });

  test("History 1 runs once the files of each sitting are recorded, next to production's 17 rows", (t) => {
    if (run.failure) return t.skip(notChecked());
    assert.equal(runbook.history1.outcome, "applied", "History 1 gives every pending file its own number (Start 1, History 0 and 2 are compared above)");
    // It renumbers only the rows the connector recorded under a time: the earlier sittings' (the SQL editor's six files
    // are recorded under their own numbers), then this sitting's, none while nothing is pending (section 6.3).
    assert.equal(runbook.history1.earlier, APPLIED_SINCE.filter((name) => !inSqlEditor(name)).length, "after the earlier sittings");
    assert.equal(runbook.history1.thisSitting, THIS_SITTING.filter((name) => !inSqlEditor(name)).length, "after this sitting");
  });
});

// The five food parts (about 150 KB each, through the SQL editor) can wait until after every other pending
// migration and the new app's deploy. Nothing after them needs their rows except 20261118200000, which adds
// search words to six foods from part 01 and so moves with them; meanwhile the app's food search answers from
// its built-in list and the member's own foods (tests/nutrition/search-route.test.ts: "an empty catalogue").
describe("the food parts and 20261118200000 applied last on production's copy", { skip }, () => {
  const LAST = [...FOOD_PARTS, RAJMA];
  const EARLIER = PENDING.filter((name) => !LAST.includes(name));
  const MEMBER = "f0000000-0000-4000-8000-0000000000f1";
  const asMember = (sub) => `set local role authenticated;
select set_config('request.jwt.claims', '${JSON.stringify({ sub, role: "authenticated" })}', true) \\g /dev/null`;
  // A member uses Nutrition while the catalogue is still empty: saves a food, logs a USDA food from the app's
  // built-in list (meals keep its FoodData Central id, which the catalogue uses too) and searches. Rolled back.
  const MEANWHILE = `
begin;
insert into auth.users (id, email) values ('${MEMBER}', 'meanwhile@example.test');
${asMember(MEMBER)}
insert into public.custom_foods (user_id, name, serving_size, serving_grams, calories_per_100g) values ('${MEMBER}', 'Idli (homemade)', '1 piece', 40, 130);
insert into public.meals (user_id, meal, food_name, source, provider_id, quantity_grams, calories)
  values ('${MEMBER}', 'Breakfast', 'Idli', 'USDA FoodData Central', '2708346', 120, 156);
select jsonb_build_object(
  'catalogue_probe', (select coalesce(jsonb_agg(id), '[]') from (select id from public.food_catalog limit 1) f),
  'search', (select coalesce(jsonb_agg(jsonb_build_array(kind, name, recent_count, fuzzy)), '[]')
             from public.search_foods('idli', array['idli'], 120)),
  'meals_logged', (select count(*) from public.meals)
)::text;
rollback;`;
  const rajmaWords = () => pg.json(`
    select coalesce(json_object_agg(id, keywords @> array['rajma', 'rajmah'] order by id), '{}')::text from public.food_catalog
    where id in (${RAJMA_FOODS.map((id) => `'${id}'`).join(", ")});`);

  /** @type {LocalPostgres} */
  let pg;
  /** @type {ReturnType<typeof applyInOrder>} */
  let earlier = { status: new Map(), failure: null };
  /** @type {ReturnType<typeof applyInOrder>} */
  let last = { status: new Map(), failure: null };
  let meanwhile = null;
  /** Section 6.1 right after #36, with the food parts and #37 still to come. */
  let sixOne = null;
  const words = { beforeRajma: null, afterRajma: null };
  let searches = null;
  let end = null;
  const failed = () => earlier.failure ?? last.failure;

  before(() => {
    pg = new LocalPostgres().start();
    buildProductionToday(pg);
    const cronUsable = pg.pgCronUsable();
    earlier = applyInOrder(pg, EARLIER, cronUsable);
    if (earlier.failure) return;
    sixOne = Object.fromEntries(SIX_ONE.map((id) => [id, runbookQuery(pg, blockOf(id))]));
    meanwhile = pg.json(MEANWHILE);
    last = applyInOrder(pg, FOOD_PARTS, cronUsable);
    if (last.failure) return;
    words.beforeRajma = rajmaWords();
    const rajma = applyInOrder(pg, [RAJMA], cronUsable);
    for (const [name, entry] of rajma.status) last.status.set(name, entry);
    if (rajma.failure) {
      last.failure = rajma.failure;
      return;
    }
    words.afterRajma = rajmaWords();
    // The runbook's own search checks, as a made-up member: after #24 and after #37.
    searches = { smoke: runbookQuery(pg, blockOf("Smoke 20261118140014")).rows, rajma: runbookQuery(pg, blockOf("Check 20261118200000")).rows };
    const snapshot = pg.json(SNAPSHOT);
    end = { snapshot, rows: ends.production ? rowDigests(pg, ends.production.columns) : null };
  });

  after(() => pg?.stop());

  test("every other pending migration applies before the food parts, in order, each in one transaction", (t) => {
    assertAllApplied(t, earlier, EARLIER, "A migration that needs the food parts' rows cannot come before them: keep it after them in the runbook.");
    assertAllApplied(t, last, LAST, "The food parts and 20261118200000 must also apply after every other pending migration.");
  });

  test("with the food parts waiting, the final checks (section 6.1) give right after #36 what they give after #37 in version order", (t) => {
    if (earlier.failure) return t.skip(`not checked: ${earlier.failure.name} failed`);
    if (!ends.sixOne) return t.skip("not checked: production's copy did not finish its first run");
    assert.deepEqual(sixOne, ends.sixOne, "so 6.1 can come before the deploy, as section 2.1 says");
  });

  test("meanwhile food search answers with the member's own foods, and the catalogue reads as not loaded", (t) => {
    if (failed()) return t.skip(`not checked: ${failed().name} failed`);
    assert.deepEqual(meanwhile, {
      // Empty: the search route then answers from the app's built-in list instead of reporting no match.
      catalogue_probe: [],
      search: [["custom", "Idli (homemade)", 0, false]],
      meals_logged: 1,
    });
  });

  test("20261118200000 comes after the food parts: their six kidney-bean foods get the rajma words only from it", (t) => {
    if (failed()) return t.skip(`not checked: ${failed().name} failed`);
    assert.equal(RAJMA_FOODS.length, 6, `the six foods are read from ${RAJMA}`);
    assert.deepEqual(words.beforeRajma, Object.fromEntries(RAJMA_FOODS.map((id) => [id, false])), "the food parts add the six foods without the words");
    assert.deepEqual(words.afterRajma, Object.fromEntries(RAJMA_FOODS.map((id) => [id, true])));
    assert.deepEqual(searches.smoke[0], { kind: "catalog", id: "2708346", name: "Idli" }, "the runbook's Smoke 20261118140014: Idli first");
    assert.deepEqual(searches.rajma.map((row) => [row.id, row.has_rajma]), RAJMA_FOODS.map((id) => [id, true]), "the runbook's Check 20261118200000");
  });

  test("the end is exactly production's with every pending migration in version order", (t) => {
    if (failed()) return t.skip(`not checked: ${failed().name} failed`);
    if (!ends.production) return t.skip("not checked: production's copy did not finish its first run");
    const { onlyFirst, onlySecond, changed } = compareEnds(
      { ...ends.production.snapshot, data: ends.production.rows },
      { ...end.snapshot, data: end.rows },
    );
    const lines = [...onlyFirst.map((key) => `${key}: only in version order`), ...onlySecond.map((key) => `${key}: only with the food parts last`), ...changed];
    assert.deepEqual(lines, [], "applying the food parts and 20261118200000 last must end exactly as applying everything in version order");
    t.diagnostic(`${Object.keys(end.rows).length} tables' rows compared, the food catalogue's included`);
  });
});
