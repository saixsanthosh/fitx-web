# Platform database runbook (Phases 1 to 11)

This runbook applies every pending database change to the production Supabase project, one file at a
time. It is written for the FITX owner. You do not need to know SQL. "The session" below means the Claude
session that has the Supabase connector: it runs the queries and applies the files, and it never applies
anything without your OK for that file.

- **What is pending:** the 36 files from `20261115100000` to `20261118190000` in `supabase/migrations` on
  the branch `claude/train`. That folder is the source of truth. Production already has the 14 files from
  September 2026 and none of these.
- **Older runbooks:** `docs/runbooks/phase1-database.md` covered the first five files for release 2. This
  runbook includes them, so use this one. `docs/runbooks/billing-razorpay.md` covers Razorpay after #36.

## 0. How each step works

For each file, in the order of section 2:

1. The session shows you the file's summary from section 3, and the result of its "Before" query if it has
   one. The summary says what changes, what members notice, and any existing data it changes.
2. You read it and say OK. One OK covers one file.
3. The session applies that one file with the connector's `apply_migration`. It names the call after the file
   without its number and without `.sql`, for example `fitx_workout_session_pause_timing`. Six large files go
   through the SQL editor instead (section 0.2).
4. The session reloads the app's API, so new tables and functions answer at once:

   ```sql
   -- Reload: run after every file
   notify pgrst, 'reload schema';
   ```

5. The session runs the file's Check query and compares the result with "Expect". If it matches, go on to
   the next file. If it does not, or the file failed, stop and follow section 4.

### 0.1 Rules

- One file per step. Never two files in one call, never part of a file.
- Only these 36 files, only from `claude/train`. Never a copy from another branch or worktree, and never
  the old Admin draft `admin/supabase/migrations/20261116000000_…` (it is gone from `claude/train`).
- Never run a September file again. `20260924162506` would put back its old profile rules and functions,
  undoing later security fixes such as #4.
- The Start, Before, Check, Smoke, Later and Final queries only read. The only writes are the files
  themselves and the steps marked "writes", and each of those needs your OK too.
- Pick a quiet time. Do all 36 in one sitting if you can, then deploy the new app (section 6.4) the same
  day. If you need two sittings, stop after #11 and do #12 to #36 on the day you deploy: #12 changes muscle
  names that the live app's automatic workout builder still uses.
- The live app keeps working throughout. Only two files change something it uses: #12 (above) and #9 (goal
  totals, see #9). The new app checks for each file and works without the ones not applied yet.

### 0.2 The six large files: SQL editor

`#12` (397 KB) and the five food parts `#20` to `#24` (137 to 153 KB each) are too large to pass through the
connector reliably. For each of them:

1. The session copies the file to your clipboard (on this Mac: `pbcopy < supabase/migrations/<file>`). You
   can also open the file in the repository and copy all of it.
2. Supabase Dashboard → SQL Editor → New query. Paste, then Run. If the editor warns about a "destructive
   operation", choose to run it anyway: the file updates rows on purpose.
3. Wait for "Success. No rows returned". The editor runs the whole file as one unit: if it fails, nothing
   from it stays.
4. Tell the session. It records the file in the migration history (the "Record" query in the file's section,
   which writes one row) and runs the Check.

## 1. Before starting

### 1.1 Take or confirm a backup

Do this on the day, before #1.

- Supabase Dashboard → Database → Backups. If it lists daily backups, note the time of the newest one. If it
  lists none (the Free plan has none), make your own copy as below.
- Your own copy, on your Mac in Terminal (`pg_dump` comes with PostgreSQL, which this Mac has through
  Homebrew). Supabase Dashboard → Connect → copy the "Session pooler" connection string. Put your database
  password into it yourself; never paste the password into a chat. Then run:

  ```bash
  pg_dump "<the connection string>" --format=custom --schema=public --file="fitx-before-platform-migrations.dump"
  ```

  The files below change only the `public` schema (plus one storage bucket and one scheduled job), so this
  copy covers them. Keep it until the new app has run for a few weeks. It holds members' data: keep it private.
- #12 has an extra, optional backup copy of its own (section 3, #12).

### 1.2 What is already applied

```sql
-- Start 1: the migration history. Expect: 14 rows, from 20260924162506 initial_fitx_schema to 20260930180717 free_exercise_db_part_09
select version, name from supabase_migrations.schema_migrations order by version;
```

Expected rows: `20260924162506`, `20260924164105`, `20260924170604`, `20260924171527`, `20260924174525`, then
the nine `free_exercise_db_part_01` to `_09` rows from `20260930180637` to `20260930180717`. If there are
other rows, or the numbers differ from the file names, stop and compare them with section 2 first.

### 1.3 Nothing from these files is in the database yet

```sql
-- Start 2: changes from the 36 pending files that are already there. Expect: no rows
select m.file, m.object
from (values
  ('20261115100000', 'column', 'workout_sessions.active_duration_seconds'),
  ('20261115110000', 'column', 'workout_sets.duration_seconds'),
  ('20261117090000', 'column', 'profiles.intro_completed_at'),
  ('20261117100000', 'policy', 'profiles.profiles_update_own'),
  ('20261117110000', 'table', 'fitx_rate_limits'),
  ('20261118100000', 'column', 'user_preferences.theme'),
  ('20261118110000', 'column', 'user_preferences.diet_type'),
  ('20261118120000', 'column', 'planner_events.local_date'),
  ('20261118120001', 'column', 'goals.period'),
  ('20261118120002', 'column', 'user_preferences.dashboard_layout'),
  ('20261118130000', 'table', 'equipment'),
  ('20261118130020', 'table', 'exercise_media'),
  ('20261118130030', 'table', 'training_programmes'),
  ('20261118130050', 'function', 'fitx_save_workout_plan(jsonb,jsonb)'),
  ('20261118140000', 'table', 'food_catalog'),
  ('20261118140001', 'table', 'meal_templates'),
  ('20261118140002', 'function', 'search_foods(text,text[],integer)'),
  ('20261118150000', 'table', 'ai_coach_threads'),
  ('20261118160000', 'table', 'activities'),
  ('20261118170008', 'column', 'workout_sets.rep_source'),
  ('20261118180000', 'table', 'fitx_admin_members'),
  ('20261118180001', 'function', 'fitx_admin_actor_can(uuid,text)'),
  ('20261118180002', 'function', 'fitx_admin_log_event(uuid,text,text,text,jsonb)'),
  ('20261118180003', 'function', 'fitx_admin_metrics()'),
  ('20261118180004', 'function', 'fitx_admin_search_users(text,integer,integer)'),
  ('20261118180005', 'table', 'support_requests'),
  ('20261118180006', 'table', 'announcements'),
  ('20261118190000', 'table', 'billing_plans')
) as m (file, kind, object)
where case m.kind
  when 'table' then to_regclass('public.' || m.object) is not null
  when 'function' then to_regprocedure('public.' || m.object) is not null
  when 'column' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                             and c.table_name = split_part(m.object, '.', 1) and c.column_name = split_part(m.object, '.', 2))
  when 'policy' then exists (select 1 from pg_policies p where p.schemaname = 'public'
                             and p.tablename = split_part(m.object, '.', 1) and p.policyname = split_part(m.object, '.', 2))
end
order by m.file;
```

Each row means that change is already in the database without being in the history, for example pasted
into the SQL editor once. Stop and tell the session. One known case is fine: if the only row is
`20261118180000 fitx_admin_members`, the old Admin draft was applied by hand earlier. `#29` is written for
that case, so go on.

### 1.4 What the Admin files need (Phase 10 checks)

The Admin functions will belong to the role that applies the files. They read tables with forced row level
security, so that role must bypass row level security. "Sign out everywhere" deletes sign-in sessions.

```sql
-- Start 3: the role that applies the files, and the owner of the existing tables. Expect: postgres, f, t, postgres
select current_user as applying_role, r.rolsuper, r.rolbypassrls,
  (select tableowner from pg_tables where schemaname = 'public' and tablename = 'profiles') as owner_of_existing_tables
from pg_roles r where r.rolname = current_user;
```

```sql
-- Start 4: that role can end sign-in sessions. Expect: t
select has_table_privilege(current_user, 'auth.sessions', 'DELETE') as can_end_sessions;
```

- `rolbypassrls` is `f`: apply everything except #29 to #35. Tell the session; Admin would see no team
  members and could sign nobody in.
- `can_end_sessions` is `f`: you can still apply everything. Admin's "Sign out everywhere" will report that
  Supabase refused, until this is fixed. Tell the session.
- `applying_role` or `owner_of_existing_tables` is not `postgres`: stop and tell the session. The connector
  may be in read-only mode, and a file cannot replace a function that another role owns.

### 1.5 Extensions and search path

```sql
-- Start 5: the two extensions the files use. Expect: two rows, pg_cron and pg_trgm (installed or not)
select a.name, a.default_version, a.installed_version, e.extnamespace::regnamespace as installed_in
from pg_available_extensions a left join pg_extension e on e.extname = a.name
where a.name in ('pg_cron', 'pg_trgm') order by a.name;
```

- `pg_trgm` (fuzzy text search, #17): fine whether or not it is installed. #17 installs it in `extensions`
  when it is missing.
- `pg_cron` (scheduled jobs, #27): it must be listed. You switch it on just before #27 (section 3, #27).

```sql
-- Start 6: where the database finds extension functions. Expect: a list that includes extensions, such as "$user", public, extensions
select current_setting('search_path') as search_path;
```

If `extensions` is missing, tell the session before #17: its index needs it.

### 1.6 Table sizes

```sql
-- Start 7: the largest tables. Expect: small numbers before launch
select relname as table_name, n_live_tup as rows from pg_stat_user_tables
where schemaname = 'public' order by n_live_tup desc limit 10;
```

Some files lock a table for a moment while they add a column or check every row. With tables this small,
each lock lasts about a second at most, and members' requests simply wait for it.

### 1.7 The history table

```sql
-- Start 8: columns of the migration history. Expect: version (not nullable) and name; any other column nullable
select column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' order by ordinal_position;
```

The "Record" queries for the large files write `version` and `name` only. If another column is not
nullable, tell the session before #12.

## 2. Apply order

Apply in this order, which is the order of the file numbers. After every file, the session runs the
reload from section 0, step 4 (`notify pgrst, 'reload schema';`). "Re-runnable: yes" means running the file
again, for example after a failure, is safe. Two exceptions after a success: #7 (do not run it again) and
#12 (not later on, once Admin is in use).

| # | File | What it does | Additive · re-runnable | Needs | Unlocks | Special handling |
|---|---|---|---|---|---|---|
| 1 | `20261115100000_fitx_workout_session_pause_timing` | Adds pause and resume times to workout sessions. | Additive · yes | September files | Pause and resume that survive a reload | |
| 2 | `20261115110000_fitx_workout_prescription_targets` | Adds weight and time targets to planned and live exercises, and seconds to sets. | Additive · yes | | Weight targets, timed holds | |
| 3 | `20261117090000_fitx_profiles_intro_flag` | Adds "intro film started" to profiles; marks every existing account as having seen it. | Additive, fills every profile once · yes | | Intro film once per new account | Before #4. Updates every profile row. |
| 4 | `20261117100000_fitx_profiles_column_privileges` | Members read their own profile and edit only 13 fields; signed-out visitors lose access. | Takes privileges away · yes | #3 (adds its column itself if missing) | Plan, XP and streaks can't be changed from the browser | Apply #7 in the same sitting. Undo SQL in section 5. |
| 5 | `20261117110000_fitx_food_search_quota` | Limits food searches per account: 30 a minute, 500 a day. | Additive · yes | | Food search limit | |
| 6 | `20261118100000_fitx_user_preferences_theme` | Saves the theme choice on the account. | Additive · yes | | Theme follows the account | |
| 7 | `20261118110000_fitx_profile_v2` | Adds diet, food rules, cuisines, budget, limitations and units; weight gain and loss goals; profile repair. | Additive, fills diet fields · after a success, do not run again | #4 | Profile v2, onboarding v2, coach inputs | Soon after #4. |
| 8 | `20261118120000_fitx_planner_todo_store` | The planner becomes the To-Do store: day, done time, order, goal link; start time optional. | Mostly additive, fills every planner row's day · yes | September files | To-Do list; ticking off the planned workout | Locks the planner for a moment. |
| 9 | `20261118120001_fitx_goals_v2` | Daily and weekly goals, progress from logs, corrections; resets manual totals to their entries. | Additive, recomputes totals once · yes | #8 | Goals v2 | Deploy the new app soon after. |
| 10 | `20261118120002_fitx_home_summary` | Saved Home layout; today's numbers in one request. | Additive · yes | #8 | Home dashboard v2 | |
| 11 | `20261118130000_fitx_training_catalog_schema` | Catalogue columns, 23 equipment types, Home and Gym equipment lists. | Additive · yes | | Equipment lists, catalogue filters | |
| 12 | `20261118130010_fitx_exercise_catalog_cleanup` | Rewrites the 898 exercises, hides 15 duplicates, re-points saved rows to the kept exercise. | Rewrites reference data and some member rows · yes, but not later on (it would hide the 15 duplicates again) | #11 | Curated catalogue, timed holds | SQL editor (0.2). Optional backup copy first. Deploy the same day. |
| 13 | `20261118130020_fitx_exercise_media` | Exercise photo table, public `exercise-media` bucket, 1,782 photo rows. | Additive · yes | #12 | Exercise photos | Before #12 it adds no photos. |
| 14 | `20261118130030_fitx_training_programmes` | Programmes, programme days, enrolments. | Additive · yes | | Programmes | |
| 15 | `20261118130040_fitx_training_programmes_seed` | Publishes 7 programmes with 28 days. | Reference data · yes | #14 | Programme library | |
| 16 | `20261118130050_fitx_workout_rpcs` | Save, start and finish a workout in one step; one open workout per member. | Additive, closes duplicate open workouts · yes | #2, #8, #14 | Reliable save, start and finish | |
| 17 | `20261118140000_fitx_food_catalog` | Turns on pg_trgm; food catalogue and portion tables. | Additive · yes | `extensions` on the search path (Start 6) | Food catalogue | |
| 18 | `20261118140001_fitx_nutrition_user_data` | Barcode and photo custom foods, saved meals and routines, own targets. | Additive · yes | | My foods v2, routines, targets | |
| 19 | `20261118140002_fitx_search_foods` | Database food search with a typo fallback. | Additive · yes | #17, #18 | Ranked food search | Coming before the food parts is fine (section 3). Apply #20 to #24 in the same sitting. |
| 20 | `20261118140010_fitx_food_catalog_seed_part_01` | Adds 595 foods with 627 portions. | Reference data, adds only missing foods · yes | #17 | The catalogue's foods | SQL editor (0.2). |
| 21 | `20261118140011_fitx_food_catalog_seed_part_02` | Adds 417 foods with 1,185 portions. | Same · yes | #17 | | SQL editor. |
| 22 | `20261118140012_fitx_food_catalog_seed_part_03` | Adds 425 foods with 1,172 portions. | Same · yes | #17 | | SQL editor. |
| 23 | `20261118140013_fitx_food_catalog_seed_part_04` | Adds 435 foods with 1,116 portions. | Same · yes | #17 | | SQL editor. |
| 24 | `20261118140014_fitx_food_catalog_seed_part_05` | Adds 430 foods with 829 portions. | Same · yes | #17 | | SQL editor. |
| 25 | `20261118150000_fitx_ai_coach` | Coach consent, conversations, proposals, safety notes, 24-hour limits. | Additive · yes | #7 | AI coach | Needs an AI key (section 7). Reloads the API itself. |
| 26 | `20261118160000_fitx_activity_tracking` | GPS activities and their points, daily limits, the prune function. | Additive · yes | | Activity tracking | |
| 27 | `20261118160001_fitx_activity_retention_schedule` | Daily job that deletes detailed GPS points older than 90 days. | Scheduled deletion · yes | #26, pg_cron | Keeps the 90-day promise in the app | Switch pg_cron on in the Dashboard first. |
| 28 | `20261118170008_fitx_workout_sets_rep_source` | Labels a set's reps as typed or counted by the camera. | Additive · yes | | Camera form coach label | |
| 29 | `20261118180000_fitx_admin_control_plane` | Admin team list, audit log, first Admin functions. | Additive · yes | Start 3: `rolbypassrls` = `t` | Admin sign-in | Then the first super-admin (section 6.5). |
| 30 | `20261118180001_fitx_admin_roles` | Five Admin roles and one permission check. | Widens a rule, replaces 2 functions · yes | #29 | Roles, access by email | |
| 31 | `20261118180002_fitx_admin_audit_log` | The audit log becomes permanent and append-only. | Takes privileges away, permanent · yes | #29 | Audit screen, People actions | Cannot be undone, by design. |
| 32 | `20261118180003_fitx_admin_metrics` | Exact metrics and daily trends (counts only). | Additive · yes | #29, #30 | Admin Overview and Reports | |
| 33 | `20261118180004_fitx_admin_people` | People search and "Sign out everywhere". | Additive · yes | #29, #30; Start 4 for "Sign out everywhere" | People screen | |
| 34 | `20261118180005_fitx_support` | Help requests and replies, with limits; support queue. | Additive · yes | #29, #30 | /help form, support queue | |
| 35 | `20261118180006_fitx_announcements` | Announcements and dismissals. | Additive · yes | #29, #30 | Announcement banner | |
| 36 | `20261118190000_fitx_billing_razorpay` | Billing tables and functions; seeds no plan. | Additive · yes | After #29 to #35 (Admin's billing page uses their roles) | Premium subscriptions, later | Nothing is sold until Razorpay is set up. |

## 3. Each file: summary and check

Expected values are in the order of the query's columns: `t` is true, `f` is false. A Check that runs a
moment after members used the app can show slightly different counts; the session says why.

### #1 `20261115100000_fitx_workout_session_pause_timing`

Workout sessions get three new fields: active time so far, when the current stretch started, and when the
session was paused. Existing sessions start at 0 seconds. Members: a paused workout keeps its time after a
reload.

```sql
-- Check 20261115100000: expect 3
select count(*) as pause_columns from information_schema.columns
where table_schema = 'public' and table_name = 'workout_sessions'
  and column_name in ('active_duration_seconds', 'resumed_at', 'paused_at');
```

### #2 `20261115110000_fitx_workout_prescription_targets`

Planned and live workout exercises get an optional target weight (kg) and target time (seconds), and each
logged set gets an optional time. Each has a range check. Existing rows stay empty. Members: weight targets
and timed holds such as a plank.

```sql
-- Check 20261115110000: expect 5, 5
select
  (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (
     ('workout_plan_exercises', 'target_weight_kg'), ('workout_plan_exercises', 'target_duration_seconds'),
     ('workout_session_exercises', 'target_weight_kg'), ('workout_session_exercises', 'target_duration_seconds'),
     ('workout_sets', 'duration_seconds'))) as target_columns,
  (select count(*) from pg_constraint where conname in (
     'workout_plan_exercises_target_weight_kg_check', 'workout_plan_exercises_target_duration_seconds_check',
     'workout_session_exercises_target_weight_kg_check', 'workout_session_exercises_target_duration_seconds_check',
     'workout_sets_duration_seconds_check')) as target_checks;
```

### #3 `20261117090000_fitx_profiles_intro_flag`

Profiles get "intro film started". Every account that exists now is marked as having seen the film, because
it used to play on every visit. Only accounts created from now on see the one-time film. This updates every
profile row once, so each profile's "updated" time changes too. Apply it before #4. A second run changes
nothing.

```sql
-- Before 20261117090000: accounts that will be marked as having seen the film
select count(*) as accounts from public.profiles;
```

```sql
-- Check 20261117090000: expect accounts = the Before count, film_not_started = 0 (or only accounts created since)
select count(*) as accounts, count(*) filter (where intro_completed_at is null) as film_not_started
from public.profiles;
```

### #4 `20261117100000_fitx_profiles_column_privileges`

Members can read their own profile and change only the 13 fields the app edits: name, photo, gender, age,
height, weight, target weight, experience, workout place, goals, onboarded, intro film and updated time.
Plan, level, XP, streaks and email can no longer be changed from the browser, so nobody can give themselves
Premium that way. Signed-out visitors lose all access to profiles. For new sign-ups, names are capped at 120
characters and only `https` photo links are kept. Apply #7 in the same sitting: until #7 is in, the new app
cannot recreate a member's missing profile row. Undo SQL is in section 5.

```sql
-- Check 20261117100000: expect t, f, f, f, t, f, profiles_select_own,profiles_update_own, 13, search_path=""
select
  has_table_privilege('authenticated', 'public.profiles', 'SELECT') as members_read,
  has_table_privilege('authenticated', 'public.profiles', 'INSERT') as members_insert,
  has_table_privilege('authenticated', 'public.profiles', 'DELETE') as members_delete,
  has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE') as members_change_plan,
  has_column_privilege('authenticated', 'public.profiles', 'intro_completed_at', 'UPDATE') as members_change_intro,
  has_table_privilege('anon', 'public.profiles', 'SELECT') as visitors_read,
  (select string_agg(polname, ',' order by polname) from pg_policy where polrelid = 'public.profiles'::regclass) as policies,
  (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles'
     and grantee = 'authenticated' and privilege_type = 'UPDATE') as editable_columns,
  (select array_to_string(proconfig, ', ') from pg_proc where oid = 'public.handle_new_user()'::regprocedure) as sign_up_function_settings;
```

### #5 `20261117110000_fitx_food_search_quota`

Adds a per-account food search limit: 30 searches a minute and 500 a day. The day resets at 00:00 UTC
(05:30 in India). It protects the shared Open Food Facts and USDA quotas. Only one database function reads
or writes the counters.

```sql
-- Check 20261117110000: expect t, t, f, t, f
select to_regclass('public.fitx_rate_limits') is not null as table_exists,
  (select relrowsecurity from pg_class where oid = to_regclass('public.fitx_rate_limits')) as row_security_on,
  has_table_privilege('authenticated', 'public.fitx_rate_limits', 'SELECT') as members_read_counters,
  has_function_privilege('authenticated', 'public.fitx_take_food_search_quota()', 'EXECUTE') as members_can_search,
  has_function_privilege('anon', 'public.fitx_take_food_search_quota()', 'EXECUTE') as visitors_can_call;
```

### #6 `20261118100000_fitx_user_preferences_theme`

Each member's preferences get the theme (light, dark or system) and the time it was chosen. Both start
empty, on purpose: once the new app is live, a member's next visit saves the theme their device already
uses to the account, so nobody's choice is overwritten.

```sql
-- Check 20261118100000: expect 2, CHECK ((theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text]))), 0
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences'
     and column_name in ('theme', 'theme_updated_at') and is_nullable = 'YES' and column_default is null) as new_columns,
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.user_preferences'::regclass
     and conname = 'user_preferences_theme_check') as theme_rule,
  (select count(*) from public.user_preferences where theme is not null) as themes_saved;
```

### #7 `20261118110000_fitx_profile_v2`

Adds the Profile v2 fields: diet type, food rules, cuisines, foods the member avoids, food budget (level and
monthly amount in rupees), injuries or limitations, and height and weight units (cm and kg by default).
"Weight gain" and "weight loss" become valid goals. Diet type and food rules are filled in from the labels
the first onboarding saved ("Vegetarian", "Halal" and so on); the old labels stay where they are. Adds a
function that recreates a missing profile row for the signed-in member. Apply it soon after #4. After it
succeeded, do not run it again: a second run can bring back a food rule that a member has removed since.

```sql
-- Before 20261118110000: rows whose diet type and food rules will be filled in
select
  count(*) filter (where dietary_preferences && array['Vegan', 'vegan', 'Vegetarian', 'vegetarian', 'Eggetarian', 'eggetarian',
    'Non-vegetarian', 'non-vegetarian', 'Non vegetarian', 'Both', 'both']::text[]) as diets_to_fill,
  count(*) filter (where dietary_preferences && array['Halal', 'Pescatarian', 'Low carb', 'halal', 'pescatarian', 'low carb']::text[]) as food_rules_to_fill
from public.user_preferences;
```

```sql
-- Check 20261118110000: expect 9, 1, t, t, search_path="", t, f, then diets_filled and food_rules_filled equal to the Before counts
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences' and column_name in
     ('diet_type', 'food_rules', 'cuisines', 'food_dislikes', 'food_budget_level', 'monthly_food_budget_inr',
      'limitations', 'height_unit', 'weight_unit')) as new_columns,
  (select count(*) from pg_constraint where conrelid = 'public.user_preferences'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%primary_goal%') as goal_rules,
  (select pg_get_constraintdef(oid) ilike '%weight_gain%weight_loss%' from pg_constraint
    where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_primary_goal_check') as new_goals_allowed,
  (select prosecdef from pg_proc where oid = to_regprocedure('public.fitx_ensure_profile()')) as repair_runs_as_owner,
  (select array_to_string(proconfig, ', ') from pg_proc where oid = to_regprocedure('public.fitx_ensure_profile()')) as repair_settings,
  has_function_privilege('authenticated', 'public.fitx_ensure_profile()', 'EXECUTE') as members_can_repair,
  has_function_privilege('anon', 'public.fitx_ensure_profile()', 'EXECUTE') as visitors_can_repair,
  (select count(*) from public.user_preferences where diet_type is not null) as diets_filled,
  (select count(*) from public.user_preferences where food_rules <> '{}') as food_rules_filled;
```

### #8 `20261118120000_fitx_planner_todo_store`

The planner becomes the one store for To-Dos and the schedule. Each item gets its calendar day (from its
start time, in the member's saved time zone), a done time, a position within the day and an optional goal.
The start time becomes optional, so a To-Do can have no time. "Task" becomes an item type. A workout session
can point at the planner item it was started from. Existing items keep their ids, times and status. The
planner and workout sessions are locked for a moment while it runs.

```sql
-- Before 20261118120000: planner items that get a day; saved time zones the server does not know (those days use UTC); descriptions over 1,000 characters (expect 0)
select (select count(*) from public.planner_events) as planner_items,
  (select count(*) from public.user_preferences up where not exists (
     select 1 from pg_timezone_names t where t.name = up.timezone)) as unknown_time_zones,
  (select count(*) from public.planner_events where char_length(description) > 1000) as long_descriptions;
```

If `long_descriptions` is not 0, tell the session: those items could no longer be edited until shortened.

```sql
-- Check 20261118120000: expect 4, YES, 0, planner_events_a_day_sent,planner_events_defaults,planner_events_touch, 1, 6
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'planner_events'
     and column_name in ('local_date', 'completed_at', 'sort_order', 'goal_id')) as new_columns,
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'planner_events'
     and column_name = 'starts_at') as start_time_optional,
  (select count(*) from public.planner_events where local_date is null) as items_without_day,
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.planner_events'::regclass and not tgisinternal) as triggers,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'workout_sessions'
     and column_name = 'planner_event_id') as session_link,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fitx_safe_timezone',
     'fitx_user_timezone', 'fitx_reorder_todo', 'fitx_complete_workout_event', 'fitx_planner_events_defaults',
     'fitx_planner_events_day_sent')) as functions;
```

### #9 `20261118120001_fitx_goals_v2`

Goals get a period (daily, weekly or long-term), a direction (reach it, come down to it, or stay under it),
a starting value and a completed time. Progress can come from what members already log: food, water,
workouts, weigh-ins and linked To-Dos. A manual goal's total is now kept by the database: it is set once to
the sum of the goal's logged entries, so a total that drifted from its entries changes. Entries may be
negative, to correct a mistake. The live Goals page still writes totals itself, which gives the same result
unless a member logs from two tabs, so deploy the new app soon after.

```sql
-- Before 20261118120001: manual goal totals that will change
select count(*) as totals_that_change from public.goals g where g.metric = 'manual'
  and g.current_value is distinct from greatest(0, coalesce(
    (select sum(e.amount) from public.goal_progress_entries e where e.goal_id = g.id and e.user_id = g.user_id), 0));
```

```sql
-- Before 20261118120001: goal types in use. Expect: only manual (any other could no longer be edited)
select metric, count(*) as goals from public.goals group by metric order by 2 desc;
```

```sql
-- Check 20261118120001: expect 4, goal_progress_entries_sync,goals_before_write,goals_touch, CHECK ((amount <> (0)::numeric)), 0, t
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'goals'
     and column_name in ('period', 'direction', 'baseline_value', 'completed_at')) as new_columns,
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid in ('public.goals'::regclass, 'public.goal_progress_entries'::regclass) and not tgisinternal) as triggers,
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.goal_progress_entries'::regclass
     and conname = 'goal_progress_entries_amount_check') as entry_rule,
  (select count(*) from public.goals g where g.metric = 'manual' and g.current_value is distinct from greatest(0,
     coalesce(g.baseline_value, 0) + coalesce((select sum(e.amount) from public.goal_progress_entries e
       where e.goal_id = g.id and e.user_id = g.user_id), 0))) as totals_out_of_step,
  to_regprocedure('public.fitx_goal_progress(date,text)') is not null as progress_function;
```

### #10 `20261118120002_fitx_home_summary`

Each member's preferences get a saved Home widget layout (empty means the default layout). Adds one function
that adds up today's numbers for Home in a single request.

```sql
-- Check 20261118120002: expect jsonb, t, t, f
select
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences'
     and column_name = 'dashboard_layout') as layout_column,
  to_regprocedure('public.fitx_today_summary(date,text)') is not null as summary_function,
  has_function_privilege('authenticated', 'public.fitx_today_summary(date,text)', 'EXECUTE') as members_can_call,
  has_function_privilege('anon', 'public.fitx_today_summary(date,text)', 'EXECUTE') as visitors_can_call;
```

### #11 `20261118130000_fitx_training_catalog_schema`

The exercise catalogue gets nine new columns: category, mechanic, muscle group, equipment needed, reps or
time, default time, source, "merged into" and a version. Adds a list of 23 equipment types that anyone can
read, and each member's Home and Gym equipment lists (owner only). #12 fills the new columns.

```sql
-- Check 20261118130000: expect 9, 23, t, user_equipment_profiles_owner for authenticated
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'exercise_library' and column_name in
     ('category', 'mechanic', 'muscle_group', 'required_equipment', 'prescription_type', 'default_duration_seconds',
      'source_ref', 'merged_into', 'catalog_version')) as catalogue_columns,
  (select count(*) from public.equipment) as equipment_types,
  (select relrowsecurity from pg_class where oid = 'public.user_equipment_profiles'::regclass) as equipment_lists_private,
  (select string_agg(policyname || ' for ' || array_to_string(roles, ','), '; ') from pg_policies
    where schemaname = 'public' and tablename = 'user_equipment_profiles') as who_reaches_the_lists;
```

### #12 `20261118130010_fitx_exercise_catalog_cleanup` (SQL editor)

Rewrites the curated fields of all 898 exercises: muscle, category, sets, reps, rest, equipment, places
(home or gym; "outdoor" is removed from the 11 exercises that had it) and alternatives. Hides the 15
imported exercises that duplicate a FITX starter exercise, and points members' saved plans, workout history
and personal records at the starter exercise instead. Exercise names on those rows stay as they are. It keeps
no copy of the old values, so take the optional backup copy below first. The live app's automatic workout
builder still matches the old muscle names ("back", "core") and "outdoor", so deploy the new app the same
day. Apply it through the SQL editor (section 0.2). Do not run it again later on: a second run would hide
the 15 duplicates again if someone shows one of them in Admin.

```sql
-- Before 20261118130010: member rows that will point at the starter exercise instead of a duplicate
select
  (select count(*) from public.workout_plan_exercises where exercise_id = any (d.ids)) as plan_rows,
  (select count(*) from public.workout_session_exercises where exercise_id = any (d.ids)) as history_rows,
  (select count(*) from public.personal_records where exercise_id = any (d.ids)) as record_rows
from (select array['free-exercise-db-Barbell_Bench_Press_-_Medium_Grip', 'free-exercise-db-Barbell_Hip_Thrust',
  'free-exercise-db-Barbell_Squat', 'free-exercise-db-Bent_Over_Barbell_Row', 'free-exercise-db-Bodyweight_Walking_Lunge',
  'free-exercise-db-Butt_Lift_Bridge', 'free-exercise-db-Dumbbell_Bicep_Curl', 'free-exercise-db-Lateral_Raise_-_With_Bands',
  'free-exercise-db-Plank', 'free-exercise-db-Pullups', 'free-exercise-db-Pushups', 'free-exercise-db-Seated_Cable_Rows',
  'free-exercise-db-Side_Lateral_Raise', 'free-exercise-db-Standing_Dumbbell_Triceps_Extension',
  'free-exercise-db-Wide-Grip_Lat_Pulldown']::text[] as ids) d;
```

Optional, but recommended: a copy of everything this file changes, in a private schema that the app's API
cannot reach. Section 5 uses it to undo #12. Drop it a few weeks after launch
(`drop schema fitx_backup cascade;`).

```sql
-- Backup 20261118130010 (optional, writes): copies of the catalogue and of the exercise links in members' rows
create schema if not exists fitx_backup;
create table if not exists fitx_backup.exercise_library_before_cleanup as table public.exercise_library;
create table if not exists fitx_backup.exercise_links_before_cleanup as
  select 'workout_plan_exercises'::text as source, id, exercise_id from public.workout_plan_exercises
  union all select 'workout_session_exercises', id, exercise_id from public.workout_session_exercises
  union all select 'personal_records', id, exercise_id from public.personal_records;
```

```sql
-- Record 20261118130010 (writes, after the SQL editor run)
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118130010', 'fitx_exercise_catalog_cleanup') on conflict (version) do nothing;
```

```sql
-- Check 20261118130010: expect 898, 898, 15, 0, 0, 0
select count(*) as exercises,
  count(*) filter (where catalog_version = 1) as curated,
  count(*) filter (where merged_into is not null) as merged_duplicates,
  count(*) filter (where merged_into is not null and is_active) as duplicates_still_visible,
  count(*) filter (where 'outdoor' = any (locations)) as outdoor_tagged,
  (select count(*) from public.workout_plan_exercises p join public.exercise_library e on e.id = p.exercise_id where e.merged_into is not null)
  + (select count(*) from public.workout_session_exercises s join public.exercise_library e on e.id = s.exercise_id where e.merged_into is not null)
  + (select count(*) from public.personal_records r join public.exercise_library e on e.id = r.exercise_id where e.merged_into is not null)
    as member_rows_on_duplicates
from public.exercise_library;
```

### #13 `20261118130020_fitx_exercise_media`

Adds the exercise photo table (anyone can see the photos of visible exercises), a public storage bucket
`exercise-media`, and 1,782 photo rows: two for each of the 891 exercises that have Free Exercise DB
pictures, pointing at those pictures on GitHub. Copying the pictures into FITX's own bucket is a separate,
optional step later (section 7).

```sql
-- Check 20261118130020: expect 1782, 1782, t
select (select count(*) from public.exercise_media where kind = 'still') as photo_rows,
  (select 2 * count(*) from public.exercise_library where source_ref ~ '^[A-Za-z0-9_-]+$') as expected_photo_rows,
  (select public from storage.buckets where id = 'exercise-media') as bucket_public;
```

### #14 `20261118130030_fitx_training_programmes`

Adds training programmes and their days (anyone can read published ones) and members' enrolments (owner
only, one active enrolment each). A workout plan can belong to an enrolment.

```sql
-- Check 20261118130030: expect 3, 2, t, programme_enrolments_owner
select (select count(*) from pg_class where oid in (to_regclass('public.training_programmes'),
          to_regclass('public.training_programme_days'), to_regclass('public.programme_enrolments')) and relrowsecurity) as tables_with_row_security,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'workout_plans'
     and column_name in ('programme_enrolment_id', 'programme_day_index')) as plan_columns,
  to_regclass('public.programme_enrolments_one_active') is not null as one_active_enrolment,
  (select string_agg(polname, ',') from pg_policy where polrelid = 'public.programme_enrolments'::regclass) as enrolment_policies;
```

### #15 `20261118130040_fitx_training_programmes_seed`

Publishes 7 programmes with 28 days in all: `ppl-3`, `ppl-6`, `upper-lower-4`, `full-body-3`, `bro-split-5`,
`home-bodyweight-3` and `home-dumbbell-4`. A second run updates them in place and leaves a programme you
unpublished later unpublished.

```sql
-- Check 20261118130040: expect 7, 28
select (select count(*) from public.training_programmes where status = 'published') as published_programmes,
       (select count(*) from public.training_programme_days) as programme_days;
```

### #16 `20261118130050_fitx_workout_rpcs`

Adds three functions that save a plan, start a workout and finish a workout, each in one step, so a dropped
connection never leaves half a workout behind. Allows one workout in progress per member: if a member has
several open, the older ones are closed as "abandoned" and the newest stays open. Finishing a workout ticks
off its planner item and moves a programme to its next day.

```sql
-- Before 20261118130050: members with more than one open workout, and the workouts that will be closed
select count(*) as members, coalesce(sum(open_workouts - 1), 0) as workouts_to_close
from (select count(*) as open_workouts from public.workout_sessions where status = 'in_progress'
      group by user_id having count(*) > 1) d;
```

```sql
-- Check 20261118130050: expect t, 0, 3, t, f
select to_regclass('public.workout_sessions_one_in_progress') is not null as one_open_workout_rule,
  (select count(*) from (select user_id from public.workout_sessions where status = 'in_progress'
     group by user_id having count(*) > 1) d) as members_with_two_open,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and not prosecdef and proname in
     ('fitx_save_workout_plan', 'fitx_start_workout_session', 'fitx_finish_workout_session')) as functions_with_members_rights,
  to_regprocedure('public.fitx_start_workout_session(uuid,uuid)') is not null as start_knows_planner_item,
  has_function_privilege('anon', 'public.fitx_start_workout_session(uuid,uuid)', 'EXECUTE') as visitors_can_call;
```

### #17 `20261118140000_fitx_food_catalog`

Turns on `pg_trgm` (fuzzy text matching) in the `extensions` schema, if it is not on yet. Adds FITX's food
catalogue and household portions. Signed-in members can read active foods; nobody can write them through the
app's API. The catalogue stays empty until #20 to #24.

```sql
-- Check 20261118140000: expect extensions (or where pg_trgm already was), 2, t, f, t, f
select (select extnamespace::regnamespace::text from pg_extension where extname = 'pg_trgm') as pg_trgm_schema,
  (select count(*) from pg_class where oid in (to_regclass('public.food_catalog'), to_regclass('public.food_portions'))
     and relrowsecurity) as tables_with_row_security,
  to_regclass('public.food_catalog_search_trgm_idx') is not null as fuzzy_index,
  has_table_privilege('anon', 'public.food_catalog', 'SELECT') as visitors_read,
  has_table_privilege('authenticated', 'public.food_catalog', 'SELECT') as members_read,
  has_table_privilege('authenticated', 'public.food_catalog', 'INSERT') as members_write;
```

### #18 `20261118140001_fitx_nutrition_user_data`

Custom foods get a barcode, a photo, where they came from (typed, scanned or added by the AI coach), how the
values were obtained, a source and an archive date. Adds saved meals, daily routines and members' own daily
targets (owner only). Logged meals and custom foods keep their "updated" time from now on.

```sql
-- Check 20261118140001: expect 8, 3, custom_foods_touch_updated_at,meals_touch_updated_at, f
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'custom_foods' and column_name in
     ('barcode', 'origin', 'value_basis', 'image_path', 'image_url', 'image_attribution', 'source_ref', 'archived_at')) as new_columns,
  (select count(*) from pg_class where oid in (to_regclass('public.meal_templates'), to_regclass('public.meal_template_items'),
     to_regclass('public.nutrition_targets')) and relrowsecurity) as tables_with_row_security,
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid in ('public.custom_foods'::regclass, 'public.meals'::regclass) and not tgisinternal) as updated_time_triggers,
  has_table_privilege('anon', 'public.meal_templates', 'SELECT') as visitors_read;
```

### #19 `20261118140002_fitx_search_foods`

Adds the database food search. It returns catalogue foods and the member's own foods that contain every typed
word, how often the member logged each one in the last 60 days, and close spellings when nothing matches. It
runs with the member's own rights. Its number puts it before the five food parts, and that is fine: until the
parts are in, the app fills in from its built-in food list. Apply #20 to #24 in the same sitting.

```sql
-- Check 20261118140002: expect f, search_path=pg_catalog, public, extensions, t, f
select p.prosecdef as runs_as_owner, array_to_string(p.proconfig, ', ') as settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as members_can_search,
  has_function_privilege('anon', p.oid, 'EXECUTE') as visitors_can_search
from pg_proc p where p.oid = to_regprocedure('public.search_foods(text,text[],integer)');
```

### #20 to #24 `20261118140010` to `20261118140014`: food parts 01 to 05 (SQL editor)

Together they add 2,302 foods from USDA FoodData Central (public domain) with 4,929 household portions:
595, 417, 425, 435 and 430 foods per part. Each part adds only the foods that are not there yet, with their
portions. A second run changes nothing and never undoes a later correction. Apply each through the SQL
editor (section 0.2), then record it:

```sql
-- Record 20261118140010 (writes, after the SQL editor run)
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140010', 'fitx_food_catalog_seed_part_01') on conflict (version) do nothing;
```

```sql
-- Record 20261118140011 (writes, after the SQL editor run)
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140011', 'fitx_food_catalog_seed_part_02') on conflict (version) do nothing;
```

```sql
-- Record 20261118140012 (writes, after the SQL editor run)
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140012', 'fitx_food_catalog_seed_part_03') on conflict (version) do nothing;
```

```sql
-- Record 20261118140013 (writes, after the SQL editor run)
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140013', 'fitx_food_catalog_seed_part_04') on conflict (version) do nothing;
```

```sql
-- Record 20261118140014 (writes, after the SQL editor run)
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140014', 'fitx_food_catalog_seed_part_05') on conflict (version) do nothing;
```

```sql
-- Check 20261118140010 to 20261118140014: foods and portions so far. Expect after part 01: 595, 627; 02: 1012, 1812; 03: 1437, 2984; 04: 1872, 4100; 05: 2302, 4929
select (select count(*) from public.food_catalog) as foods, (select count(*) from public.food_portions) as portions;
```

After part 05, a search as a made-up member (nothing is saved):

```sql
-- Smoke 20261118140014: expect the first row to be catalog, 2708346, Idli
with member as materialized (
  select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true) as claims
)
select f.kind, f.id, f.name from member, lateral public.search_foods('idli', array['idli'], 3) as f;
```

### #25 `20261118150000_fitx_ai_coach`

Adds the AI coach's tables: consent (including "Use my FITX data", off unless the member turns it on),
conversations, messages, proposed actions, safety notes (topic and time only) and limits of 30 chat
messages and 6 plans per member in any 24 hours. Members reach only their own rows, and nobody can raise
their own limit. The coach stays off until an AI key is set (section 7). The file reloads the API itself.

```sql
-- Check 20261118150000: expect 7, t, 5, chat=30,plan=6, f, f, t
with t as (select oid, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
           and relname like 'ai\_coach\_%')
select (select count(*) from t) as tables, (select bool_and(relrowsecurity) from t) as all_row_security,
  (select count(*) from pg_policy where polrelid in (select oid from t)) as policies,
  (select string_agg(kind || '=' || daily_limit, ',' order by kind) from public.ai_coach_limits) as limits,
  has_function_privilege('anon', 'public.ai_coach_take_quota(text)', 'EXECUTE') as visitors_can_call,
  has_table_privilege('authenticated', 'public.ai_coach_usage_events', 'SELECT') as members_read_usage,
  (select prosecdef from pg_proc where oid = 'public.ai_coach_delete_my_data()'::regprocedure) as delete_runs_as_owner;
```

### #26 `20261118160000_fitx_activity_tracking`

Adds GPS activities (walks, runs and rides) and their detailed points, owner only. Each account can add at
most 50 activities and 1,000 point chunks a day. Adds the function that deletes the detailed points of
activities that ended more than 90 days ago; only the server and the database can run it.

```sql
-- Check 20261118160000: expect 2, f, f, t, fitx_activities_daily_limit,fitx_activity_chunks_limit
select (select count(*) from pg_class where oid in (to_regclass('public.activities'), to_regclass('public.activity_track_chunks'))
          and relrowsecurity) as tables_with_row_security,
  has_table_privilege('anon', 'public.activities', 'SELECT') as visitors_read,
  has_function_privilege('authenticated', 'public.fitx_prune_activity_track_chunks(integer)', 'EXECUTE') as members_can_prune,
  has_function_privilege('service_role', 'public.fitx_prune_activity_track_chunks(integer)', 'EXECUTE') as server_can_prune,
  (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid in ('public.activities'::regclass,
     'public.activity_track_chunks'::regclass) and not tgisinternal) as daily_limits;
```

### #27 `20261118160001_fitx_activity_retention_schedule`

Schedules a daily clean-up at 03:23 UTC (08:53 in India). It deletes the detailed GPS points of activities
that ended more than 90 days ago. The activity summaries and their simple route lines stay. The app already
tells members that detailed points are kept for 90 days. The deletion is permanent, by design.

First switch pg_cron on: Supabase Dashboard → Integrations → Cron → Enable (on older dashboards: Database →
Extensions → `pg_cron` → Enable). Then:

```sql
-- Before 20261118160001: pg_cron is on and this role can schedule jobs. Expect: a version number, t
select (select extversion from pg_extension where extname = 'pg_cron') as pg_cron_version,
  case when to_regprocedure('cron.schedule(text,text,text)') is not null
       then has_function_privilege(to_regprocedure('cron.schedule(text,text,text)'), 'EXECUTE') end as can_schedule;
```

```sql
-- Check 20261118160001: expect one row: fitx-prune-activity-track-chunks, 23 3 * * *, select public.fitx_prune_activity_track_chunks(90), t
select jobname, schedule, command, active from cron.job where jobname = 'fitx-prune-activity-track-chunks';
```

The day after, once 03:23 UTC has passed:

```sql
-- Later 20261118160001: the job's last runs. Expect: status succeeded
select status, return_message, start_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'fitx-prune-activity-track-chunks')
order by start_time desc limit 3;
```

### #28 `20261118170008_fitx_workout_sets_rep_source`

Each logged set gets a label: typed by hand, or counted by the camera form coach and confirmed by the member.
Older sets stay empty. Only the label is stored, never video, pictures or body positions.

```sql
-- Check 20261118170008: expect YES, CHECK (((rep_source IS NULL) OR (rep_source = ANY (ARRAY['manual'::text, 'camera'::text]))))
select (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'workout_sets'
          and column_name = 'rep_source') as label_optional,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'workout_sets_rep_source_check') as label_rule;
```

### #29 `20261118180000_fitx_admin_control_plane`

Adds the Admin team list (each team member can read only their own row) and the Admin audit log, and the first
Admin functions: overview counts, add or change a team member, show or hide an exercise. Only the server's
secret key can run them. It adds nobody to the team; the first super-admin is a separate step afterwards
(section 6.5). Needs Start 3 to show `rolbypassrls` = `t`.

```sql
-- Check 20261118180000: expect t, t, t, f, 3, t, 0 (or the members the old draft had)
select (select relforcerowsecurity from pg_class where oid = to_regclass('public.fitx_admin_members')) as team_row_security_forced,
  (select relforcerowsecurity from pg_class where oid = to_regclass('public.fitx_admin_audit_logs')) as audit_row_security_forced,
  has_table_privilege('service_role', 'public.fitx_admin_members', 'SELECT') as server_reads_team,
  has_table_privilege('authenticated', 'public.fitx_admin_audit_logs', 'SELECT') as members_read_audit,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and proname in
     ('fitx_admin_overview_metrics', 'fitx_admin_set_member', 'fitx_admin_set_exercise_active')) as admin_functions,
  (select r.rolbypassrls from pg_roles r join pg_proc p on p.proowner = r.oid
    where p.oid = 'public.fitx_admin_overview_metrics()'::regprocedure) as owner_bypasses_row_security,
  (select count(*) from public.fitx_admin_members) as team_members;
```

### #30 `20261118180001_fitx_admin_roles`

Five Admin roles: super-admin, admin, support agent, content editor and viewer. One permission check that
every Admin function uses. Adds granting access by email, the team list with emails, and an email lookup for
the audit and support screens. Server key only.

```sql
-- Check 20261118180001: expect the rule listing the five roles, 1, t, 5, f
select (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.fitx_admin_members'::regclass
          and conname = 'fitx_admin_members_role_check') as role_rule,
  (select count(*) from pg_constraint where conrelid = 'public.fitx_admin_members'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%role%') as role_rules,
  position('fitx_admin_actor_can' in (select prosrc from pg_proc
     where oid = 'public.fitx_admin_set_member(uuid,uuid,text,boolean)'::regprocedure)) > 0 as set_member_checks_roles,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fitx_admin_role_permissions',
     'fitx_admin_actor_can', 'fitx_admin_find_user_by_email', 'fitx_admin_list_members', 'fitx_admin_user_emails')) as functions,
  has_function_privilege('authenticated', 'public.fitx_admin_actor_can(uuid,text)', 'EXECUTE') as members_can_call;
```

### #31 `20261118180002_fitx_admin_audit_log`

Makes the Admin audit log permanent: rows can only be added, never changed or deleted, not even with the
secret key or by the database owner. A deleted account's ID stays on the rows about it (no email and no
health data). Adds the function Admin uses to record sign-ins and other events. This cannot be undone, by
design.

```sql
-- Check 20261118180002: expect f, f, t, fitx_admin_audit_logs_append_only_rows,fitx_admin_audit_logs_append_only_truncate, 0, t
select has_table_privilege('service_role', 'public.fitx_admin_audit_logs', 'UPDATE') as server_can_change,
  has_table_privilege('service_role', 'public.fitx_admin_audit_logs', 'DELETE') as server_can_delete,
  has_table_privilege('service_role', 'public.fitx_admin_audit_logs', 'INSERT') as server_can_add,
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.fitx_admin_audit_logs'::regclass and not tgisinternal) as guards,
  (select count(*) from pg_constraint where conrelid = 'public.fitx_admin_audit_logs'::regclass and contype = 'f') as links_to_accounts,
  to_regprocedure('public.fitx_admin_log_event(uuid,text,text,text,jsonb)') is not null as log_function;
```

### #32 `20261118180003_fitx_admin_metrics`

Adds Admin's metrics (accounts, sign-ins, active members, workouts and meals) and daily trends by India time.
Counts only, server key only.

```sql
-- Check 20261118180003: expect two rows, fitx_admin_daily_trends and fitx_admin_metrics, each t, f, t
select p.proname, p.prosecdef as runs_as_owner,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as members_can_call,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as server_can_call
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fitx_admin_metrics', 'fitx_admin_daily_trends')
order by 1;
```

### #33 `20261118180004_fitx_admin_people`

Adds People search (by part of an email or an account ID) and "Sign out everywhere", which ends every
sign-in session of an account. Account details only, never health data. Server key only.

```sql
-- Check 20261118180004: expect two rows, fitx_admin_revoke_user_sessions and fitx_admin_search_users, each t, f, t, t
select p.proname, p.prosecdef as runs_as_owner,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as members_can_call,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as server_can_call,
  has_table_privilege(p.proowner, 'auth.sessions', 'DELETE') as owner_can_end_sessions
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('fitx_admin_search_users', 'fitx_admin_revoke_user_sessions')
order by 1;
```

### #34 `20261118180005_fitx_support`

Adds Help requests and replies. Members open requests and reply only through limited functions (3 requests
an hour and 10 a day, 10 replies an hour) and read only their own threads. Staff-only fields (priority,
assignee, staff account IDs) stay hidden from them. Admin replies and status changes go into the audit log,
without the message text.

```sql
-- Check 20261118180005: expect 2, t, f, f, f, f, t, f
select (select count(*) from pg_class where oid in (to_regclass('public.support_requests'), to_regclass('public.support_messages'))
          and relrowsecurity) as tables_with_row_security,
  has_column_privilege('authenticated', 'public.support_requests', 'subject', 'SELECT') as members_read_subject,
  has_column_privilege('authenticated', 'public.support_requests', 'priority', 'SELECT') as members_read_priority,
  has_column_privilege('authenticated', 'public.support_requests', 'assigned_to', 'SELECT') as members_read_assignee,
  has_table_privilege('authenticated', 'public.support_requests', 'INSERT') as members_write_directly,
  has_table_privilege('service_role', 'public.support_requests', 'INSERT') as server_writes_directly,
  has_function_privilege('authenticated', 'public.fitx_submit_support_request(text,text,text,text)', 'EXECUTE') as members_can_ask,
  has_function_privilege('anon', 'public.fitx_submit_support_request(text,text,text,text)', 'EXECUTE') as visitors_can_ask;
```

### #35 `20261118180006_fitx_announcements`

Adds announcements, written in Admin and shown to signed-in members while they are live, and each member's
dismissals. Editing a live announcement needs an extra confirmation. Every change goes into the audit log.

```sql
-- Check 20261118180006: expect 2, f, f, t, t, 3
select (select count(*) from pg_class where oid in (to_regclass('public.announcements'), to_regclass('public.announcement_dismissals'))
          and relrowsecurity) as tables_with_row_security,
  has_column_privilege('authenticated', 'public.announcements', 'created_by', 'SELECT') as members_read_author,
  has_table_privilege('authenticated', 'public.announcements', 'INSERT') as members_write,
  has_table_privilege('authenticated', 'public.announcement_dismissals', 'INSERT') as members_dismiss,
  to_regprocedure('public.fitx_admin_save_announcement(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean)')
    is not null as live_edits_need_confirmation,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fitx_admin_save_announcement',
     'fitx_admin_set_announcement_status', 'fitx_admin_announcement_dismissals')) as admin_functions;
```

### #36 `20261118190000_fitx_billing_razorpay`

Adds the billing tables (plans, subscriptions, payments, refunds, Razorpay events and nightly checks) and
their functions. Members read only their own records and the plans on sale. Only the server's functions
write, and only from what Razorpay reported. Premium comes from `has_premium()`, which looks at paid periods,
never at the profile's plan field. No plan is added, so nothing is sold until you set up Razorpay
(`docs/runbooks/billing-razorpay.md`).

```sql
-- Check 20261118190000: expect 6, f, f, f, t, f, f, 0, f
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity and relname in
          ('billing_plans', 'billing_subscriptions', 'billing_payments', 'billing_refunds', 'billing_provider_events',
           'billing_reconciliation_runs')) as tables_with_row_security,
  has_table_privilege('service_role', 'public.billing_payments', 'INSERT') as server_writes_directly,
  has_table_privilege('authenticated', 'public.billing_provider_events', 'SELECT') as members_read_events,
  has_table_privilege('anon', 'public.billing_plans', 'SELECT') as visitors_read_plans,
  has_function_privilege('authenticated', 'public.has_premium(uuid)', 'EXECUTE') as members_ask_premium,
  has_function_privilege('anon', 'public.has_premium(uuid)', 'EXECUTE') as visitors_ask_premium,
  has_function_privilege('authenticated', 'public.billing_apply_event(jsonb)', 'EXECUTE') as members_record_payments,
  (select count(*) from public.billing_plans) as plans,
  public.has_premium('00000000-0000-0000-0000-000000000000') as nobody_has_premium;
```

## 4. If a migration fails part-way

1. **Stop.** Do not apply the next file. The live app keeps working, and the new app waits for each file.
2. **Keep the error.** The session shows the exact message. Nothing needs to be done in a hurry.
3. **See what stayed.** The session runs the file's Check query and Start 1 (the history).
   - These files wrap themselves in one transaction, so when they fail nothing of them stays: #4, #7, #8,
     #9, #10, #25, #26 and #36.
   - The connector and the SQL editor also normally run a whole file as one unit. If the Check shows part of
     a file in place anyway, that is still safe: every file here can be run again over whatever part stayed.
   - If the history has a row for the file but the Check does not match, tell the session; do not delete the
     row yet.
4. **Fix the cause, then run the same file again**, with your OK. A run after a failure is always safe,
   including #7. Then run its Check and go on.

Causes the session can recognise:

| Message contains | File | What to do |
|---|---|---|
| `canceling statement due to lock timeout`, `deadlock detected` | any | A member's request held the table. Run the file again a minute later. |
| `operator class "gin_trgm_ops" does not exist` | #17 | The search path lacks `extensions` (Start 6). Tell the session; do not edit the file. |
| `could not create unique index "workout_sessions_one_in_progress"` | #16 | A member opened a second workout during the run. Run the file again. |
| `extension "pg_cron" is not available`, `permission denied to create extension`, `schema "cron" does not exist` | #27 | pg_cron is not on. Switch it on in the Dashboard (section 3, #27), then run the file again. |
| `violates check constraint` | #7, #8, #9 | Existing rows break a rebuilt rule. These files run as one transaction, so nothing stayed. Tell the session; it finds the rows with a read-only query. |
| any other `permission denied` | any | The connector is not acting as `postgres` (Start 3), or is read-only. Stop and fix the connector first. |
| The SQL editor stops or times out | #12, #20 to #24 | The file ran as one unit, so nothing stayed. Run it again. If it keeps failing, run it yourself in Terminal, in the repository folder, with the connection string from section 1.1: `psql "<the connection string>" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/<file>`. Then tell the session. |

If a file was applied but its Check does not match, do not undo it straight away. Tell the session. Most
differences have a reason (for example, a member signed up during the run).

## 5. Undoing a file

Undo only when something is broken, and only after talking to the session. Undo the most recent files
first: never undo a file while a later file that needs it is still in place (the "Needs" column in section
2). After an undo, remove that file's row from the history, so the record matches the database:
`delete from supabase_migrations.schema_migrations where name = '<the file name without number>';`

Anything a member saved in a dropped table or column is lost. When a file only adds a feature, switching the
feature off in the app is usually better than an undo.

| # | How to undo, or why it cannot simply be undone |
|---|---|
| 36 | Only while no real payment exists: SQL below. Once Razorpay has charged anyone, never drop these tables; they are the money trail. To stop selling, set every plan's `is_active` to false. |
| 35, 34 | SQL below. Drops announcements, Help requests and replies. |
| 33, 32 | SQL below. Drops functions only; Admin falls back to its older screens. |
| 31 | Cannot be undone, by design: the audit log is permanent. |
| 30, 29 | Not undone once anyone used Admin: the team list and audit log hold the record. To switch Admin off, set every member inactive on the Access screen, or empty `FITX_ADMIN_ALLOWED_EMAILS` on the admin project and redeploy. |
| 28 | SQL below. Drops the camera label. |
| 27 | SQL below: stops the daily job. Points it already deleted are gone, by design. |
| 26 | Undo #27 first. SQL below. Drops all recorded activities. |
| 25 | Better: set `AI_COACH_ENABLED=false` (section 7). SQL below drops all coach conversations, consents and the safety notes that keep the 30-day pause. |
| 20 to 24 | SQL below hides the whole catalogue (search falls back to the built-in list); setting it back to `true` shows it again. Meals already logged keep their own copies. |
| 19 | SQL below. The app falls back to its built-in food list. |
| 18 | SQL below. Drops saved meals, routines, own targets, and custom foods' barcodes, photos and origin. |
| 17 | Undo #19 to #24 first. SQL below. `pg_trgm` stays on (harmless). |
| 16 | SQL below. Workouts it closed as abandoned stay closed. |
| 15 | SQL below unpublishes the programmes. Members already enrolled keep theirs. |
| 14 | Undo #16 first. SQL below. Drops enrolments; plans made from programmes stay as plain plans. |
| 13 | SQL below drops the photo table. Delete the `exercise-media` bucket in Dashboard → Storage, not with SQL. |
| 12 | Only with the backup copy from section 3, #12: SQL below. Without it, the old values exist only in the full backup (section 1.1). |
| 11 | Undo #13 first, and #12 if you have its backup copy. SQL below. Drops members' equipment lists. |
| 10 | SQL below. Drops saved Home layouts. |
| 9 | Cannot simply be undone: the old manual totals are not kept, and correction entries can be negative, which the old rule refused. Older app code works with it in place. Fix forward with a new migration. |
| 8 | Cannot simply be undone: To-Dos without a time have no start time, which the old table required, and "task" items break the old type rule. Older app code works with it in place. Fix forward. |
| 7 | SQL below, only if nothing was saved in the new fields yet. The wider goal rule stays: restoring it needs every weight gain or loss goal changed first. Without #7, a member's missing profile row cannot be repaired. |
| 6 | SQL below. Saved themes stay on members' devices. |
| 5 | SQL below. Searches become unlimited again. |
| 4 | SQL below: brings back the old profile policy and member rights. Signed-out visitors stay without access, and the safer sign-up function stays. |
| 3 | SQL below. The app then treats every account as having seen the film. |
| 2 | Undo #16 first. SQL below. Drops weight and time targets and set times. |
| 1 | SQL below. Drops saved pause times. |

```sql
-- Undo 20261118190000 (writes; only while no real payment exists)
begin;
drop function if exists public.billing_admin_refunds(text, integer, integer), public.billing_admin_payments(text, text, integer, integer),
  public.billing_admin_subscriptions(text, integer, integer), public.billing_admin_overview(text),
  public.billing_record_reconciliation(jsonb), public.billing_reconcile_candidates(text, integer),
  public.billing_record_checkout(uuid, uuid, text, text, text, integer), public.billing_apply_event(jsonb),
  public.billing_subscription_rank(text), public.billing_refund_rank(text), public.billing_payment_rank(text),
  public.has_premium(uuid), public.billing_grants_access(text, timestamptz);
drop table if exists public.billing_reconciliation_runs, public.billing_provider_events, public.billing_refunds,
  public.billing_payments, public.billing_subscriptions, public.billing_plans;
commit;
```

```sql
-- Undo 20261118180006 (writes)
begin;
drop function if exists public.fitx_admin_announcement_dismissals(uuid[]), public.fitx_admin_set_announcement_status(uuid, uuid, text),
  public.fitx_admin_save_announcement(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean);
drop table if exists public.announcement_dismissals, public.announcements;
commit;
```

```sql
-- Undo 20261118180005 (writes)
begin;
drop function if exists public.fitx_admin_support_counts(), public.fitx_admin_support_reply(uuid, uuid, text, text),
  public.fitx_admin_support_update(uuid, uuid, text, text, uuid, timestamptz),
  public.fitx_reply_support_request(uuid, text), public.fitx_submit_support_request(text, text, text, text);
drop table if exists public.support_messages, public.support_requests;
commit;
```

```sql
-- Undo 20261118180004 (writes)
drop function if exists public.fitx_admin_revoke_user_sessions(uuid, uuid, text), public.fitx_admin_search_users(text, integer, integer);
```

```sql
-- Undo 20261118180003 (writes)
drop function if exists public.fitx_admin_daily_trends(integer), public.fitx_admin_metrics();
```

```sql
-- Undo 20261118170008 (writes)
alter table public.workout_sets drop column if exists rep_source;
```

```sql
-- Undo 20261118160001 (writes)
select cron.unschedule('fitx-prune-activity-track-chunks');
```

```sql
-- Undo 20261118160000 (writes; undo 20261118160001 first)
begin;
drop table if exists public.activity_track_chunks, public.activities;
drop function if exists public.fitx_prune_activity_track_chunks(integer), public.fitx_activities_daily_limit(),
  public.fitx_activity_chunks_limit();
commit;
```

```sql
-- Undo 20261118150000 (writes)
begin;
drop function if exists public.ai_coach_delete_my_data(), public.ai_coach_apply_action(uuid), public.ai_coach_quota_status(),
  public.ai_coach_release_quota(uuid), public.ai_coach_take_quota(text);
drop table if exists public.ai_coach_actions, public.ai_coach_messages, public.ai_coach_threads, public.ai_coach_safety_notes,
  public.ai_coach_consents, public.ai_coach_usage_events, public.ai_coach_limits;
commit;
```

```sql
-- Undo 20261118140010 to 20261118140014 (writes): hide every catalogue food
update public.food_catalog set is_active = false where is_active;
```

```sql
-- Undo 20261118140002 (writes)
drop function if exists public.search_foods(text, text[], integer);
```

```sql
-- Undo 20261118140001 (writes)
begin;
drop table if exists public.meal_template_items, public.meal_templates, public.nutrition_targets;
drop trigger if exists custom_foods_touch_updated_at on public.custom_foods;
drop trigger if exists meals_touch_updated_at on public.meals;
alter table public.custom_foods drop column if exists barcode, drop column if exists origin, drop column if exists value_basis,
  drop column if exists image_path, drop column if exists image_url, drop column if exists image_attribution,
  drop column if exists source_ref, drop column if exists archived_at;
commit;
```

```sql
-- Undo 20261118140000 (writes; undo 20261118140002 first)
begin;
drop table if exists public.food_portions, public.food_catalog;
drop function if exists public.food_catalog_before_write();
commit;
```

```sql
-- Undo 20261118130050 (writes)
begin;
drop function if exists public.fitx_finish_workout_session(uuid, integer, text), public.fitx_start_workout_session(uuid, uuid),
  public.fitx_save_workout_plan(jsonb, jsonb);
drop index if exists public.workout_sessions_one_in_progress;
commit;
```

```sql
-- Undo 20261118130040 (writes): unpublish the programmes
update public.training_programmes set status = 'draft', updated_at = now() where status = 'published';
```

```sql
-- Undo 20261118130030 (writes; undo 20261118130050 first)
begin;
alter table public.workout_plans drop column if exists programme_enrolment_id, drop column if exists programme_day_index;
drop table if exists public.programme_enrolments, public.training_programme_days, public.training_programmes;
commit;
```

```sql
-- Undo 20261118130020 (writes): then delete the exercise-media bucket in Dashboard → Storage
drop table if exists public.exercise_media;
```

```sql
-- Undo 20261118130010 (writes; only with the copies from "Backup 20261118130010"; undo 20261118130020 first)
begin;
update public.exercise_library e set
  primary_muscle = b.primary_muscle, category = b.category, mechanic = b.mechanic, muscle_group = b.muscle_group,
  prescription_type = b.prescription_type, default_duration_seconds = b.default_duration_seconds,
  recommended_sets = b.recommended_sets, reps_min = b.reps_min, reps_max = b.reps_max, rest_seconds = b.rest_seconds,
  required_equipment = b.required_equipment, locations = b.locations, alternatives = b.alternatives,
  source_ref = b.source_ref, merged_into = b.merged_into, is_active = b.is_active, catalog_version = b.catalog_version
from fitx_backup.exercise_library_before_cleanup b
where b.id = e.id;
update public.workout_plan_exercises t set exercise_id = b.exercise_id from fitx_backup.exercise_links_before_cleanup b
where b.source = 'workout_plan_exercises' and b.id = t.id and t.exercise_id is distinct from b.exercise_id;
update public.workout_session_exercises t set exercise_id = b.exercise_id from fitx_backup.exercise_links_before_cleanup b
where b.source = 'workout_session_exercises' and b.id = t.id and t.exercise_id is distinct from b.exercise_id;
update public.personal_records t set exercise_id = b.exercise_id from fitx_backup.exercise_links_before_cleanup b
where b.source = 'personal_records' and b.id = t.id and t.exercise_id is distinct from b.exercise_id;
commit;
```

```sql
-- Undo 20261118130000 (writes; undo 20261118130020 first, and 20261118130010 if you have its backup copy)
begin;
drop table if exists public.user_equipment_profiles, public.equipment;
alter table public.exercise_library drop column if exists category, drop column if exists mechanic,
  drop column if exists muscle_group, drop column if exists required_equipment, drop column if exists prescription_type,
  drop column if exists default_duration_seconds, drop column if exists source_ref, drop column if exists merged_into,
  drop column if exists catalog_version;
commit;
```

```sql
-- Undo 20261118120002 (writes)
begin;
drop function if exists public.fitx_today_summary(date, text);
alter table public.user_preferences drop column if exists dashboard_layout;
commit;
```

```sql
-- Undo 20261118110000 (writes; only if nothing was saved in the new fields)
begin;
alter table public.user_preferences drop column if exists diet_type, drop column if exists food_rules,
  drop column if exists cuisines, drop column if exists food_dislikes, drop column if exists food_budget_level,
  drop column if exists monthly_food_budget_inr, drop column if exists limitations, drop column if exists height_unit,
  drop column if exists weight_unit;
drop function if exists public.fitx_ensure_profile();
commit;
```

```sql
-- Undo 20261118100000 (writes)
alter table public.user_preferences drop column if exists theme, drop column if exists theme_updated_at;
```

```sql
-- Undo 20261117110000 (writes)
begin;
drop function if exists public.fitx_take_food_search_quota();
drop table if exists public.fitx_rate_limits;
commit;
```

```sql
-- Undo 20261117100000 (writes)
begin;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
grant select, insert, update, delete on table public.profiles to authenticated;
commit;
```

```sql
-- Undo 20261117090000 (writes)
alter table public.profiles drop column if exists intro_completed_at;
```

```sql
-- Undo 20261115110000 (writes; undo 20261118130050 first)
begin;
alter table public.workout_plan_exercises drop column if exists target_weight_kg, drop column if exists target_duration_seconds;
alter table public.workout_session_exercises drop column if exists target_weight_kg, drop column if exists target_duration_seconds;
alter table public.workout_sets drop column if exists duration_seconds;
commit;
```

```sql
-- Undo 20261115100000 (writes)
alter table public.workout_sessions drop column if exists active_duration_seconds, drop column if exists resumed_at,
  drop column if exists paused_at;
```

## 6. After the last file

### 6.1 Final checks

```sql
-- Final 1: public tables without row level security. Expect: no rows
select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity;
```

```sql
-- Final 2: tables with row level security but no policy. Expect exactly these six, on purpose: ai_coach_limits, ai_coach_usage_events, billing_provider_events, billing_reconciliation_runs, fitx_admin_audit_logs, fitx_rate_limits
select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 1;
```

```sql
-- Final 3: functions that run as their owner but have no fixed search path, or that signed-out visitors can call. Expect: no rows
select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as visitors_can_call
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as s (setting) where s.setting like 'search_path=%'));
```

Then run Start 2 again: now it lists all 28 rows.

The six tables in Final 2 are reached only by database functions or the server key, which is why they have
no policy. Supabase Dashboard → Advisors → Security Advisor flags them as "RLS Enabled No Policy"; that is
expected. Tell the session about any other new finding.

### 6.2 Food search smoke test

Already done after #24. If it did not show Idli first, tell the session before the deploy.

### 6.3 Make the migration history match the files

The connector records each file under the time it ran, not under the file's number. The September files in
the repository already carry the numbers production recorded, so the history and the folder match today.
To keep it that way, give each new row its file's number once, after the last file. It writes to the
history table only.

```sql
-- History 1 (writes, once): give each new history row its file's number
update supabase_migrations.schema_migrations h
set version = f.version
from (values
  ('20261115100000', 'fitx_workout_session_pause_timing'), ('20261115110000', 'fitx_workout_prescription_targets'),
  ('20261117090000', 'fitx_profiles_intro_flag'), ('20261117100000', 'fitx_profiles_column_privileges'),
  ('20261117110000', 'fitx_food_search_quota'), ('20261118100000', 'fitx_user_preferences_theme'),
  ('20261118110000', 'fitx_profile_v2'), ('20261118120000', 'fitx_planner_todo_store'),
  ('20261118120001', 'fitx_goals_v2'), ('20261118120002', 'fitx_home_summary'),
  ('20261118130000', 'fitx_training_catalog_schema'), ('20261118130010', 'fitx_exercise_catalog_cleanup'),
  ('20261118130020', 'fitx_exercise_media'), ('20261118130030', 'fitx_training_programmes'),
  ('20261118130040', 'fitx_training_programmes_seed'), ('20261118130050', 'fitx_workout_rpcs'),
  ('20261118140000', 'fitx_food_catalog'), ('20261118140001', 'fitx_nutrition_user_data'),
  ('20261118140002', 'fitx_search_foods'), ('20261118140010', 'fitx_food_catalog_seed_part_01'),
  ('20261118140011', 'fitx_food_catalog_seed_part_02'), ('20261118140012', 'fitx_food_catalog_seed_part_03'),
  ('20261118140013', 'fitx_food_catalog_seed_part_04'), ('20261118140014', 'fitx_food_catalog_seed_part_05'),
  ('20261118150000', 'fitx_ai_coach'), ('20261118160000', 'fitx_activity_tracking'),
  ('20261118160001', 'fitx_activity_retention_schedule'), ('20261118170008', 'fitx_workout_sets_rep_source'),
  ('20261118180000', 'fitx_admin_control_plane'), ('20261118180001', 'fitx_admin_roles'),
  ('20261118180002', 'fitx_admin_audit_log'), ('20261118180003', 'fitx_admin_metrics'),
  ('20261118180004', 'fitx_admin_people'), ('20261118180005', 'fitx_support'),
  ('20261118180006', 'fitx_announcements'), ('20261118190000', 'fitx_billing_razorpay')
) as f (version, name)
where h.name = f.name and h.version <> f.version
  and not exists (select 1 from supabase_migrations.schema_migrations x where x.version = f.version);
```

```sql
-- History 2: expect 50 rows: the 14 September ones, then the 36 files of section 2 with the same numbers and names
select version, name from supabase_migrations.schema_migrations order by version;
```

If the Supabase CLI is ever used with this project, this keeps `supabase db push` from trying to run these
files again. (`supabase migration repair --status applied <number>` does the same job, one file at a time.)

### 6.4 Deploy the new app

Set the variables in section 7 first. Then ship the new app (the `claude/train` code) to production as
planned. Both Vercel projects build from the same repository: the FITX site (`fitnessx`) and Admin
(`admin`). If Admin's build is skipped because of its path filter, redeploy it as in `admin/README.md`,
step 5.

### 6.5 First super-admin

After #29 to #35 and the Admin deploy, follow `admin/README.md` → "First super-admin": sign in to FITX once
with your Google account, then the session runs that SQL with your email, after your OK. Then sign in at the
Admin address and set up your authenticator app.

## 7. Environment variables and owner steps

Set these in Vercel → the project → Settings → Environment Variables. Never put a secret in a variable whose
name starts with `NEXT_PUBLIC_`: those are sent to every browser. Mark secrets "Sensitive" and set them for
Production only, because Preview builds use the same Supabase project. Each deployment keeps the
variables it was built with, so redeploy after any change. This runbook names the variables; it never
contains their values.

| Feature (files) | Project | Variable or step | Notes |
|---|---|---|---|
| Account deletion in the app; billing records (#36) | `fitnessx` | `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret keys. Until it is set, in-app account deletion stays off and the page offers email instead. |
| Barcode and packaged-food lookups (#18) | `fitnessx` | `OPEN_FOOD_FACTS_USER_AGENT` | `FITX/1.0 (<your support email>)`. Open Food Facts asks every app for a contact. |
| Food search, optional | `fitnessx` | `USDA_API_KEY` | A free api.data.gov key: live USDA search when FITX's own catalogue finds fewer than 8 foods. |
| AI coach (#25) | `fitnessx` | `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` | Any one switches the coach on; more keys give more free capacity. Free tiers only: an AI Studio project without billing, the Groq Free plan, an OpenRouter key without credits. "Use my FITX data" and plans need Groq or OpenRouter. |
| AI coach | `fitnessx` | `AI_COACH_ENABLED` | `false` pauses every AI feature at once. Leave unset otherwise. |
| AI coach | `fitnessx` | `AI_GEMINI_WITH_MEMBER_DATA` | Leave unset unless you accept it: on Gemini's free tier Google may use prompts and people at Google may read them. Unset, Gemini only gets questions without the member's data. |
| AI coach | `fitnessx` | `AI_ALLOW_PAID` | Leave unset. It would allow paid models. |
| Activity (#26, #27) | Supabase | Switch on pg_cron | Before #27 (section 3, #27). No variables needed. Optional: `NEXT_PUBLIC_ACTIVITY_MAP_STYLE_LIGHT` and `_DARK` replace the free OpenFreeMap maps. |
| Exercise photos (#13), optional later | this Mac | `scripts/catalog/mirror-media.mjs` | Copies the photos into the `exercise-media` bucket so they stop loading from GitHub. You run it with the secret key in your own Terminal; see the script's header. |
| Admin (#29 to #35) | `admin` | Domain `fitnessx-admin.vercel.app` | Vercel → admin project → Settings → Domains → Add, for Production. If the name is taken, pick another free `.vercel.app` name and use it everywhere below. |
| Admin | `admin` | `ADMIN_SITE_URL` | `https://fitnessx-admin.vercel.app` (it replaces `https://admin-one-blond.vercel.app`). |
| Admin | `admin` | `SUPABASE_SECRET_KEY` | The same kind of key as above; you can create a separate one named `fitx-admin`. Sensitive, Production only. |
| Admin | `admin` | `FITX_ADMIN_ALLOWED_EMAILS` | The Google email or emails allowed into Admin, separated by commas. |
| Admin | `admin` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Check they are already there. |
| Admin | Supabase | Sign-in settings | Authentication → URL Configuration → Redirect URLs: add `https://fitnessx-admin.vercel.app/auth/callback`. Check that Google sign-in and Authenticator app (TOTP) are enabled. |
| Admin, optional | `admin` | `FITX_ADMIN_PASSWORD_RESET_EMAILS` | `on` only after the "Password reset emails" steps in `admin/README.md`. |
| Premium subscriptions (#36), later | `fitnessx` | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CRON_SECRET`, `BILLING_TEST_EMAILS` | Only after your billing decisions, the Razorpay account and test mode. Follow `docs/runbooks/billing-razorpay.md`, which also adds the nightly check to `vercel.json`. |

Already set and unchanged: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the older
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and `NEXT_PUBLIC_SITE_URL` on `fitnessx`.

`admin/README.md` → "Finish the Admin setup" has every Admin step in order, including what to do if sign-in
does not work and the choice between one Google account or two.
