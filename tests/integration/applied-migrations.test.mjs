// Production has every migration up to 20261124100020_fitx_admin_explore.sql applied (#1 to #41 from master b13134b
// on 2026-11-20; #42 to #45 from master 25a2836 on 2026-11-21; #46 to #51 from master 8db1bc9 on 2026-11-23; #52 to
// #54 from master 71d75b9 on 2026-11-24).
// Those files are history: editing one changes nothing in production, but a new project, the tests and the runbook
// would then build a database production does not have. A fix to an applied file is always a new migration.
// This pins the md5 of each one, taken from `git show <that commit>:<path> | md5 -q` (the file's bytes), and fails when a
// file is changed, renamed or removed. Add a file here only once production has it applied, from the commit that
// shipped it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
/** The newest migration production has applied; every file up to it is pinned below. */
const LAST_APPLIED = "20261124100020_fitx_admin_explore.sql";

const APPLIED = {
  "20260924162506_initial_fitx_schema.sql": "e7ccf0adbbd1960315320eac64fdcfee",
  "20260924164105_harden_trigger_function_privileges.sql": "6ff801848d0ccd78002474e8ec6ace53",
  "20260924170604_fitx_v1_core_product.sql": "74e344d8d3e341bc7cc28a05880e4369",
  "20260924171527_fitx_preferences_water_goal.sql": "bcc2c0cc0fdee8138f4c7c5a953e487d",
  "20260924174525_fitx_foreign_key_indexes.sql": "ce1e7ce02c70650d0fd469b60d778065",
  "20260930180637_free_exercise_db_part_01.sql": "30a6ad738cd1e0f12ede941dd245df9c",
  "20260930180649_free_exercise_db_part_02.sql": "c6aeac8e6d5e15dec1ad039263427987",
  "20260930180652_free_exercise_db_part_03.sql": "c343a051171bf91d26b14c3c53ced459",
  "20260930180655_free_exercise_db_part_04.sql": "bf220f60500e4e0f9033eb97bccad846",
  "20260930180659_free_exercise_db_part_05.sql": "8eb2c5f93d45bf1487e3c61018255ae5",
  "20260930180706_free_exercise_db_part_06.sql": "28be9a93085b74b2b239b5bbc2417ff8",
  "20260930180709_free_exercise_db_part_07.sql": "15eabe4bf4d7c309d08bc7a816bf7452",
  "20260930180714_free_exercise_db_part_08.sql": "57e79674c13b3327bb9eb75d87de5e61",
  "20260930180717_free_exercise_db_part_09.sql": "7eab8bd8b081dfbc6746a05a895badc4",
  "20261115100000_fitx_workout_session_pause_timing.sql": "91ac35f455f272d6d73ce11c9432b68e",
  "20261115110000_fitx_workout_prescription_targets.sql": "61076d471cdbefbab2ac7131a614796b",
  "20261117090000_fitx_profiles_intro_flag.sql": "01fe329cd6403d546165f66857262bfa",
  "20261117100000_fitx_profiles_column_privileges.sql": "f92d12a79f4e371d23706e238bf5b19d",
  "20261117110000_fitx_food_search_quota.sql": "eb9dcc52d46cbf85b50ef02e893f56a2",
  "20261118100000_fitx_user_preferences_theme.sql": "f980a08f471429ac6ca07b8f0d052f4f",
  "20261118110000_fitx_profile_v2.sql": "4909b861b86009554ec293cb82e06b28",
  "20261118120000_fitx_planner_todo_store.sql": "6b86146ddcc95f9300f547d73f254ea0",
  "20261118120001_fitx_goals_v2.sql": "00300c47fc8f1ccb287eb92ad919cc70",
  "20261118120002_fitx_home_summary.sql": "619620a5376122ea632ab6bf9898d2ca",
  "20261118130000_fitx_training_catalog_schema.sql": "59ba445f8f2bfeeeb7a1cd5465a95c25",
  "20261118130010_fitx_exercise_catalog_cleanup.sql": "77f20f680ecb154212f967306466e122",
  "20261118130020_fitx_exercise_media.sql": "2cbb5199674b685c613207e438375316",
  "20261118130030_fitx_training_programmes.sql": "8a053a7e1068579ffc44380c8d504117",
  "20261118130040_fitx_training_programmes_seed.sql": "2784afeced1ace7e2d9bb826092f9a2c",
  "20261118130050_fitx_workout_rpcs.sql": "258ea860528901e6d41d5bfaf2a3c56e",
  "20261118140000_fitx_food_catalog.sql": "4c81db12ccf50c29f3d30a31869ecb31",
  "20261118140001_fitx_nutrition_user_data.sql": "7a8167a29337954deb3dade083e39a77",
  "20261118140002_fitx_search_foods.sql": "54236983808db7f5107e53dbcd20e944",
  "20261118140010_fitx_food_catalog_seed_part_01.sql": "04d352a5ac1ca163575a3213d96f7426",
  "20261118140011_fitx_food_catalog_seed_part_02.sql": "35b3a208f6daa59c2afbc6f3fcc79ace",
  "20261118140012_fitx_food_catalog_seed_part_03.sql": "af4b998b26caae4b24cc9b40d2251e25",
  "20261118140013_fitx_food_catalog_seed_part_04.sql": "6692fcf491497c35449e455fd964ab3c",
  "20261118140014_fitx_food_catalog_seed_part_05.sql": "c95d73910e2094a0055ce91f75841365",
  "20261118150000_fitx_ai_coach.sql": "bc246cfd29fcd328a27169539cfd784a",
  "20261118160000_fitx_activity_tracking.sql": "fe7743e15a70c1ab9db261258e69ff01",
  "20261118160001_fitx_activity_retention_schedule.sql": "8b4fba6f4518d9a3469a8e16101a1255",
  "20261118170008_fitx_workout_sets_rep_source.sql": "e4fc8c44722e8dbc406213dc3d853792",
  "20261118180000_fitx_admin_control_plane.sql": "7f3558fabde7964092bd8dbd93a27e86",
  "20261118180001_fitx_admin_roles.sql": "214a6ca88433b8219c52a5cad0571f79",
  "20261118180002_fitx_admin_audit_log.sql": "03c2570e6203a137f65820d164b8322d",
  "20261118180003_fitx_admin_metrics.sql": "30e5c73a9dec32543b9dd6314f7f9143",
  "20261118180004_fitx_admin_people.sql": "ec9bdbef96a43e2babb053e640d4a85c",
  "20261118180005_fitx_support.sql": "4906996167286b57e66db5e78c9eb5dd",
  "20261118180006_fitx_announcements.sql": "6c43e621c122109ccce3c76818c805f7",
  "20261118190000_fitx_billing_razorpay.sql": "8955a7d6863f4fb058f0ea880f11668d",
  "20261118200000_fitx_food_catalog_rajma_keywords.sql": "de0a90221e3546b4c90869ea1f5e3647",
  "20261119100000_fitx_activity_sources.sql": "17abb40e36bd593804924236ec96c59e",
  "20261119100010_fitx_exercise_notes.sql": "9e84efdbb1db4405790da3f5c423d2c5",
  "20261119100020_fitx_exercise_favorites.sql": "7ff1d88dccf884abc78d4fa9c426a684",
  "20261120100000_fitx_onboarding_v3.sql": "dbbd86be9f21968784427562655957f3",
  // Applied on 2026-11-21 from master 25a2836 (md5(statements[1]) in production's history matched each).
  "20261121100030_fitx_admin_v2.sql": "d5dd69375e363acef0c61bd31148a4b2",
  "20261121100033_fitx_admin_ops.sql": "31a18cff37daad6478480c2bfc9e58d5",
  "20261121100036_fitx_admin_content.sql": "53e6d1703ca15f175990dc407012deb3",
  "20261121100040_fitx_security_hardening.sql": "8719fb099283520ed3edb316df2c4ab3",
  // Applied on 2026-11-23 from master 8db1bc9 (each file's full text checked against its md5 before it ran, and
  // recorded as its history row's statements; #49 and #50 ran without their standalone begin; and commit; lines).
  "20261123100000_fitx_shell_prefs.sql": "565f674c78971fe9c079c05d929562b5",
  "20261123100010_fitx_onboarding_v4.sql": "3cdf32de2e861e69a4a3c63e1810025b",
  "20261123100020_fitx_workout_setup.sql": "651ed7e94a268819551a1e4606faafdd",
  "20261123100040_fitx_nutrition_v2.sql": "c3472cb62699af425b77d0d09f384af3",
  "20261123100050_fitx_coach_activity_v2.sql": "639bf70c6932c5650fe15440406c8a28",
  "20261123100060_fitx_social_v1.sql": "b1697e9d7428e4776be2b6d5487dafd6",
  // Applied on 2026-11-24 from master 71d75b9, before release 2a (each file's full text checked against its md5 before
  // it ran, and recorded as its history row's statements; none of the three has standalone begin; or commit; lines).
  "20261124100000_fitx_social_v2_core.sql": "ed9473c19c4a587f5201fb0a79710b4f",
  "20261124100010_fitx_social_v2_groups.sql": "1f99d234d1c8a84ebbd22e75e3c687e8",
  "20261124100020_fitx_admin_explore.sql": "f7f4ac66f26b38899191b95347eb83b2",
};

const md5 = (name) => createHash("md5").update(readFileSync(path.join(MIGRATIONS_DIR, name))).digest("hex");

test("every migration production has applied is still here, byte for byte", () => {
  const problems = [];
  for (const [name, pinned] of Object.entries(APPLIED)) {
    if (!existsSync(path.join(MIGRATIONS_DIR, name))) problems.push(`${name} is missing: production has it applied; put it back unchanged (git show 71d75b9:supabase/migrations/${name})`);
    else if (md5(name) !== pinned) {
      problems.push(`${name} was edited (md5 ${md5(name)}, production's file is ${pinned}): production already ran it, so restore it and put the change in a new migration`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every file up to the last applied one is pinned, so none can slip in among the applied files", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql") && name <= LAST_APPLIED).sort();
  const unpinned = files.filter((name) => !(name in APPLIED));
  assert.deepEqual(unpinned, [], `these files sort among the applied ones but production never ran them; give them a version after ${LAST_APPLIED.slice(0, 14)}`);
  assert.equal(Object.keys(APPLIED).length, 68, "14 September migrations and the 54 files of 20261115100000 to 20261124100020");
  assert.equal(Object.keys(APPLIED).sort().at(-1), LAST_APPLIED);
});
