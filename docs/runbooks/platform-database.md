# Platform database runbook (Phases 1 to 11, the Admin redesign and the "next level" waves 1 and 2)

This runbook applies every pending database change to the production Supabase project, one file at a
time. It is written for the FITX owner. You do not need to know SQL. "The session" below means the Claude
session that has the Supabase connector: it runs the queries and applies the files, and it never applies
anything without your OK for that file.

- **Where production stands (2026-11-25):** it has the 14 files from September 2026, the three changes applied
  to it by hand that have no file in `supabase/migrations` (section 1.8), and all 55 files of section 2, #1 to #55
  (`20261115100000` to `20261125100000`), applied on 2026-11-17, 2026-11-18, 2026-11-20, 2026-11-21, 2026-11-23,
  2026-11-24 and 2026-11-25 and recorded under their own numbers: 72 rows in its history. Those 55 are done; never
  apply one again. The 2026-11-23 sitting applied #46 to #51 (the "next level" job's wave 1) and the 2026-11-24
  sitting #52 to #54 (wave 2: Explore part 2 core, Explore's groups and Admin's Explore section, before release 2a
  was deployed), both with the staged, md5-checked method of section 0.1 (#52 to #54 in 26 parts): every Check gave
  its Expect line and Final 1 to 3 passed, and on 2026-11-24 the hourly jobs `fitx-social-hourly` and
  `fitx-challenge-hourly` were scheduled. #49 and #50 ran without their standalone `begin;` and `commit;` lines,
  which that method leaves out; #52 to #54 have none, so they ran exactly as written. The history rows of both
  sittings hold each file's full text. The 2026-11-25 sitting applied #55 (release 2c: members still read their own
  Explore reports, but no longer the evidence FITX stores with them) whole, with the connector's `apply_migration`
  (section 0, step 3): its history row holds the file's full text (`md5(statements[1])` is the md5 in section 3,
  #55), its Check gave its Expect line, History 0 gave no rows, History 1 gave the row #55's number, Final 1 to 3
  passed, and Start 2 then listed its one row.
- **What is pending:** nothing. Every file in `supabase/migrations` is applied in production; that folder, on
  `master`, is the source of truth (#55's file reaches `master` with release 2c). Sections 2 and 3 still list all
  55 files, so each summary, Check and Undo block stays next to its file.
- **The next sitting:** a later change to the database is always a new file, numbered after #55, never an edit to an
  applied one (`tests/integration/applied-migrations.test.mjs` holds each applied file's md5). It gets its row in
  section 2 and in History 1 (6.3), its section in section 3 with its md5, and its object in Start 2, which until
  then keeps the 2026-11-25 sitting's list as its record. The sitting is then section 1 (Start 1 to 4, 1.1's backup,
  and Start 5 when a file schedules a job: 1.5), its files in order (section 3), then section 6.3 and 6.1. Start 6
  to 10 belong to the first sitting, before #1; they are kept as its record and need not be run again.
- **Other runbook:** `docs/runbooks/billing-razorpay.md` covers Razorpay after #36.

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
- Only pending files (none now), and only from `master`. Never #1 to #55 again: production has them, and #7 must
  never run a second time. #51 must never run again either, except as the last step of #52's undo (section 5); #55
  is undone before #52, so nothing runs again after #51 there. Run by mistake while #52 and #55 are in place, #51
  would put back part 1's Explore functions and read policies over #52's, and members' read of every column of
  their reports over #55's (#52 and then #55, run again after it, restore both). Never #42 or #43 again: they would
  put back the 21-permission role table and the five-switch settings save (#54, run again, restores both).
  Never a copy from another
  branch or worktree, never the old Admin draft `admin/supabase/migrations/20261116000000_…` (it is gone from the
  repository), and never the files in `tests/integration/fixtures/production-drift`: they are test copies of the three changes
  production already has (section 1.8).
- Never run a September file again. `20260924162506` would put back its old profile rules and functions,
  undoing later security fixes such as #4.
- The Start, Before, Check, Smoke, Later and Final queries only read. The only writes are the files
  themselves and the steps marked "writes", and each of those needs your OK too.
- Pick a quiet time. Apply a sitting's files, then deploy the app that needs them (section 6.4) the same day, as on
  2026-11-24: #52, #53 and #54, then release 2a. #55 (2026-11-25) needed no deploy: the app works the same before
  and after it.
- The live app keeps working throughout. On 2026-11-24, #52 added Explore part 2's tables and columns and rewrote part
  1's Explore functions and three read policies in place, under the same names and arguments, so wave 1's Explore
  (live since 2026-11-23) kept working after it; it deleted no row. #53 and #54 added only functions and two indexes
  (and, on production, the hourly challenge job); they changed no row. On 2026-11-25, #55 took away only members'
  read of two columns of their reports, which the app never reads; it changed no row. The app checks for each file
  and works without the ones not applied yet.
- #52 (149 KB), #53 (70 KB) and #54 (47 KB) were larger than the files the connector took reliably. The session sent
  each with the staged, md5-checked method it used for #42 to #51 (each part stored and compared, then the whole file
  checked against its md5, run once and recorded under its own number; section 3 gives each file's md5). A large file
  in a later sitting goes the same way, or through the SQL editor (section 0.2), recorded with the same Record query
  as #12, with that file's number and name. #55 was small (3 KB): the connector's `apply_migration` took it whole
  (section 0, step 3), the session checked its history row against the md5 in section 3 (#55), and History 1 gave
  the row its number. A small file in a later sitting goes the same way.

### 0.2 The six large files: SQL editor

`#12` (397 KB) and the five food parts `#20` to `#24` (137 to 153 KB each) are too large to pass through the
connector reliably. For each of them:

1. The session copies the file to your clipboard (on this Mac: `pbcopy < supabase/migrations/<file>`). You
   can also open the file in the repository and copy all of it.
2. Supabase Dashboard → SQL Editor → New query. Paste, then Run. If the editor warns about a "destructive
   operation", choose to run it anyway: #12 updates rows on purpose, and each food part empties and then drops
   only its own temporary table, `fitx_food_seed`.
3. Wait for "Success. No rows returned". The editor runs the whole file as one unit: if it fails, nothing
   from it stays.
4. Tell the session. It records the file in the migration history (the "Record" query in the file's section,
   which writes one row and shows the file's number) and runs the Check. If the Record shows no row, that number
   was already in the history: the connector records each file it applies under the second it ran (section
   6.3), and on 18 November 2026 that second can be one of these numbers. Stop, run Start 1 and tell the session
   before going on.

## 1. Before starting

### 1.1 Take or confirm a backup

Do this on the day, before the first file of the sitting (on 2026-11-25, before #55; on 2026-11-24, before #52).

- Supabase Dashboard → Database → Backups. If it lists daily backups, note the time of the newest one. If it
  lists none (the Free plan has none), make your own copy as below.
- Your own copy, on your Mac in Terminal (`pg_dump` comes with PostgreSQL, which this Mac has through
  Homebrew). Supabase Dashboard → Connect → copy the "Session pooler" connection string. Put your database
  password into it yourself; never paste the password into a chat. Then run:

  ```bash
  pg_dump "<the connection string>" --format=custom --schema=public --file="fitx-before-platform-migrations.dump"
  ```

  The files below change only the `public` schema (plus the `pg_trgm` and `pg_cron` extensions, one storage
  bucket and one scheduled job), so this copy covers the data they change. Keep it until the new app has run for
  a few weeks. It holds members' data: keep it private.
- #12 has an extra, optional backup copy of its own (section 3, #12).

### 1.2 What is already applied

```sql
-- Start 1: the migration history. Expect: 72 rows, from 20260924162506 initial_fitx_schema to 20261125100000 fitx_social_reports_column_privileges
select version, name from supabase_migrations.schema_migrations order by version;
```

Expected rows, in version order: the 14 September files (`20260924162506` to `20260930180717`), the three
changes applied by hand (section 1.8: `20261002172610 fitx_experience_2_0`, `20261002172706
fitx_share_access_and_index` and `20261116093902 fitx_admin_control_plane`, which comes between #2 and #3), and #1
to #55 of section 2, each under its file's number and name (History 1 ran after each earlier sitting; #42 to #54
were recorded under their own numbers when they were applied, and History 1 gave #55's row its number on
2026-11-25). The last row is `20261125100000 fitx_social_reports_column_privileges`. If there are other rows, a
row with a time instead of a file's number, or a row for a file of the sitting about to start, stop and compare
them with section 2 first.

### 1.3 What from these files is in the database already

```sql
-- Start 2: changes from the sitting's files that are already there. Expect (before #55, on 2026-11-25): no rows
select m.file, m.object
from (values
  ('20261125100000', 'revoked', 'social_reports.evidence')
) as m (file, kind, object)
where case m.kind
  when 'table' then to_regclass('public.' || m.object) is not null
  when 'function' then to_regprocedure('public.' || m.object) is not null
  when 'column' then exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                             and c.table_name = split_part(m.object, '.', 1) and c.column_name = split_part(m.object, '.', 2))
  when 'policy' then exists (select 1 from pg_policies p where p.schemaname = 'public'
                             and p.tablename = split_part(m.object, '.', 1) and p.policyname = split_part(m.object, '.', 2))
  when 'revoked' then not has_column_privilege('authenticated', 'public.' || split_part(m.object, '.', 1),
                                               split_part(m.object, '.', 2), 'SELECT')
end
order by m.file;
```

Each row would mean that change is already in the database without its file being in the history: stop and
tell the session. A `revoked` row is a read members no longer have: here, of the evidence column of
`social_reports` (#55). (Before #1, on 2026-11-17, this query listed all 45 files and showed the two that
production's hand-applied changes had made, section 1.8; #2 and #29 were written for them.)

The list above is the 2026-11-25 sitting's, #55's one change, kept as its record: it gave no rows before #55, and
after it (section 6.1) it listed that row, as it does when run today, because #55 is applied. The 2026-11-24
sitting's list was #52's table `social_stories`, #53's function `fitx_social_send_message(uuid,text,uuid,uuid)` and
#54's function `fitx_admin_explore_meter()`, and it gave no rows before #52. Before the next sitting the session
replaces the list with one object from each of that sitting's files.

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

- `rolbypassrls` is `f`: apply everything except #29 to #35 and #42 to #44. Tell the session; Admin would see no
  team members or operators and could sign nobody in.
- `can_end_sessions` is `f`: you can still apply everything. Admin's "Sign out everywhere" will report that
  Supabase refused, until this is fixed. Tell the session.
- `applying_role` or `owner_of_existing_tables` is not `postgres`: stop and tell the session. The connector
  may be in read-only mode, and a file cannot replace a function that another role owns.

### 1.5 Extensions and search path

Start 5 and 6 were for the first sitting (before #17 and #27, both applied). Start 5 mattered again on 2026-11-24:
**pg_cron had to be on before #52 and #53**, because each schedules a job (`fitx-social-hourly` and
`fitx-challenge-hourly`). It has been on since #27 (2026-11-18), and both jobs were scheduled. A later file that
schedules a job needs it in the same way: if Start 5 shows no `installed_version` for `pg_cron`, switch it on as in
section 3, #27, before that file. Without it such a file still applies, skips its job, and must be run again once
it is on (as section 3 says for #52 and #53).

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

If `extensions` is missing, tell the session before #17: its index needs it. (Production shows
`"\$user", public, extensions`, with a backslash; that is fine.)

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
nullable, tell the session before a file goes through the SQL editor.

### 1.8 Three changes production has that are not in the files

First sitting only: Start 9 and Start 10 describe production before #1 and are kept as its record.

Production's history (Start 1) has three rows that no file in `supabase/migrations` matches. They were
applied by hand, outside this repository. Exact copies, checked against the history, are in
`tests/integration/fixtures/production-drift` for the tests; never apply them.

| History row | What it made |
|---|---|
| `20261002172610 fitx_experience_2_0` | Five tables: `exercise_favorites`, `food_favorites`, `outdoor_activities`, `activity_shares` and `user_release_reads`. The function `get_activity_share(text)`. Fields on existing tables: five on `exercise_library`, four on `custom_foods` (`barcode` among them), `paused_at` and two more on `workout_sessions`, target weight, time and distance on planned and live exercises, time and distance on sets. Three checks on those workout fields that were never run against the rows already there ("NOT VALID"), and two barcode rules. |
| `20261002172706 fitx_share_access_and_index` | Only signed-out visitors may call `get_activity_share`; one index. |
| `20261116093902 fitx_admin_control_plane` | The old Admin draft ("Prepared for review only"): the Admin team list, the Admin audit log and three Admin functions. |

Five of the 45 files meet what these made, and are written for it:

- #1 finds `paused_at` and adds the other two pause fields.
- #2 finds all five of its fields, in which the live app already saves targets and set times. It adds its five
  range checks and runs experience 2.0's three checks against the saved rows. Run its Before query first.
- #18 finds `custom_foods.barcode` and replaces its two barcode rules with its own.
- #29 keeps the draft's two tables and drops the draft's link from the audit log to accounts. #30 replaces
  the draft's role rule and functions.
- #40 finds `exercise_favorites`, its index, its owner-only policy and its grants exactly as experience 2.0
  made them, and adopts them unchanged: FITX now keeps saved exercises there.

Every other file does exactly what it does on a new project. `tests/integration/migrations.test.mjs` applies
all 45 to a copy of production's database made from those copies, twice, and checks that it ends exactly like a
new project apart from what stays (below) and the order of fields: in the six tables experience 2.0 added fields
to, production lists its fields before the ones these files add. Nothing in FITX depends on that order. (Production
also has an event trigger, `ensure_rls`, that switches row level security on for each new public table, from
before the first migration. Every file switches it on itself, so the trigger changes nothing here.)

```sql
-- Start 9: what the three changes made, before #1. Expect (before #1, as on 2026-11-17): 7, 20, 4, 2, 1, 3, 1
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in
     ('exercise_favorites', 'food_favorites', 'outdoor_activities', 'activity_shares', 'user_release_reads',
      'fitx_admin_members', 'fitx_admin_audit_logs')) as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (
     ('exercise_library', 'aliases'), ('exercise_library', 'tags'), ('exercise_library', 'form_cues'),
     ('exercise_library', 'common_mistakes'), ('exercise_library', 'breathing'),
     ('custom_foods', 'barcode'), ('custom_foods', 'additional_nutrients'), ('custom_foods', 'ingredients'),
     ('custom_foods', 'allergens'), ('workout_sessions', 'paused_at'), ('workout_sessions', 'paused_duration_seconds'),
     ('workout_sessions', 'rest_timer_ends_at'), ('workout_plan_exercises', 'target_weight_kg'),
     ('workout_plan_exercises', 'target_duration_seconds'), ('workout_plan_exercises', 'target_distance_meters'),
     ('workout_session_exercises', 'target_weight_kg'), ('workout_session_exercises', 'target_duration_seconds'),
     ('workout_session_exercises', 'target_distance_meters'), ('workout_sets', 'duration_seconds'),
     ('workout_sets', 'distance_meters'))) as fields,
  (select count(*) from pg_constraint where conname in ('workout_plan_exercises_targets_nonnegative',
     'workout_session_exercises_targets_nonnegative', 'workout_sets_time_distance_nonnegative') and not convalidated)
  + (select count(*) from pg_constraint where conname = 'custom_foods_barcode_format_check') as rules,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace
     and relname in ('custom_foods_user_barcode_unique', 'exercise_favorites_exercise_idx')) as indexes,
  (select count(*) from pg_proc where oid = to_regprocedure('public.get_activity_share(text)')) as share_function,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
     ('fitx_admin_overview_metrics', 'fitx_admin_set_member', 'fitx_admin_set_exercise_active')) as admin_functions,
  (select count(*) from pg_constraint where conrelid = to_regclass('public.fitx_admin_audit_logs')
     and contype = 'f') as audit_log_links_to_accounts;
```

```sql
-- Start 10: what was saved in what they made. Expect (as on 2026-11-17): 0, 0, 0, 0, 0, 0, 0, 0
select
  (select count(*) from public.exercise_favorites) + (select count(*) from public.food_favorites)
    + (select count(*) from public.outdoor_activities) + (select count(*) from public.activity_shares)
    + (select count(*) from public.user_release_reads) as rows_in_the_five_tables,
  (select count(*) from public.custom_foods where barcode is not null) as custom_foods_with_a_barcode,
  (select count(*) from public.fitx_admin_members) as admin_team_members,
  (select count(*) from public.fitx_admin_audit_logs) as admin_audit_rows,
  (select count(*) from public.workout_sessions where paused_at is not null or paused_duration_seconds <> 0
     or rest_timer_ends_at is not null) as workouts_with_experience_2_pauses,
  (select count(*) from public.workout_plan_exercises where target_distance_meters is not null)
    + (select count(*) from public.workout_session_exercises where target_distance_meters is not null)
    + (select count(*) from public.workout_sets where distance_meters is not null) as rows_with_distances,
  (select count(*) from public.custom_foods where additional_nutrients <> '{}' or ingredients is not null
     or allergens is not null) as custom_foods_with_extra_fields,
  (select count(*) from public.exercise_library where aliases <> '{}' or tags <> '{}' or form_cues <> '{}'
     or common_mistakes <> '{}' or breathing is not null) as exercises_with_extra_fields;
```

If Start 9 shows anything else, stop and tell the session: production has changed since the tests' copy was
made. If `workouts_with_experience_2_pauses` in Start 10 is not 0, stop before #1 and tell the session:
something has paused workouts the way experience 2.0 does, and #1 reads those fields differently, so such a
workout would show the wrong time, or 00:00:00 while paused. If any other count in Start 10 is not 0, tell the
session; the files still apply, but it changes the decision below.

**What stays, and what #45 does about it.** After all 45 files, production still has four of experience 2.0's five
tables (#40 adopts the fifth, `exercise_favorites`), `get_activity_share(text)`, five extra fields on exercises, three on
custom foods, five on the workout tables (distances, a paused total and a rest timer) and its three workout checks.
Nothing in FITX uses any of it. Before #45 two things were open:

- Signed-out visitors could call `get_activity_share`. It returns whatever route a share row holds to anyone with
  its token. FITX's own sharing makes the share picture on the phone and keeps no share links.
- Signed-in members could write their own rows into the four tables through the API. "Download my data" leaves
  those tables out, and the 90-day clean-up of GPS points does not cover `outdoor_activities`.

#45 (the security review, phase 15) locks them down: signed-out visitors lose the function, and members and visitors
lose every right on the four tables, so only the server key reaches them. Nothing is deleted; the tables, the fields
and any rows stay, and Final 3 then lists no function. Removing them for good is still your choice: a later migration
that stops if any of the four tables has rows or any of the extra fields it drops holds a value, as Start 10 counts
them, then drops the function, the tables and the extra fields. The session writes it, tests it on the copy, and
applies it with your OK.

## 2. Apply order

Apply in this order, which is the order of the file numbers. After every file, the session runs the
reload from section 0, step 4 (`notify pgrst, 'reload schema';`). "Re-runnable: yes" means running the file
again, for example after a failure, is safe. Two exceptions after a success: #7 (do not run it again) and
#12 (not later on, once Admin is in use).

| # | File | What it does | Additive · re-runnable | Needs | Unlocks | Special handling |
|---|---|---|---|---|---|---|
| 1 | `20261115100000_fitx_workout_session_pause_timing` | Adds pause and resume times to workout sessions. | Additive · yes | September files | Pause and resume that survive a reload | Before query first: open workouts. On production `paused_at` is there already (1.8). |
| 2 | `20261115110000_fitx_workout_prescription_targets` | Adds weight and time targets to planned and live exercises, and seconds to sets. | Additive · yes | | Weight targets, timed holds | Before query first. On production the fields are there already and it adds their checks (1.8). |
| 3 | `20261117090000_fitx_profiles_intro_flag` | Adds "intro film started" to profiles; marks every existing account as having seen it. | Additive, fills every profile once · yes | | Intro film once per new account | Before #4. Updates every profile row. |
| 4 | `20261117100000_fitx_profiles_column_privileges` | Members read their own profile and edit only 13 fields; signed-out visitors lose access. | Takes privileges away · yes | #3 (adds its column itself if missing) | Plan, XP and streaks can't be changed from the browser | Apply #7 in the same sitting. Undo SQL in section 5. |
| 5 | `20261117110000_fitx_food_search_quota` | Limits food searches per account: 30 a minute, 500 a day. | Additive · yes | | Food search limit | |
| 6 | `20261118100000_fitx_user_preferences_theme` | Saves the theme choice on the account. | Additive · yes | | Theme follows the account | |
| 7 | `20261118110000_fitx_profile_v2` | Adds diet, food rules, cuisines, budget, limitations and units; weight gain and loss goals; profile repair. | Additive, fills diet fields · after a success, do not run again | | Profile v2, onboarding v2, coach inputs | Soon after #4. |
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
| 18 | `20261118140001_fitx_nutrition_user_data` | Barcode and photo custom foods, saved meals and routines, own targets. | Additive; on production replaces two older barcode rules · yes | | My foods v2, routines, targets | On production `barcode` is there already (1.8). |
| 19 | `20261118140002_fitx_search_foods` | Database food search with a typo fallback. | Additive · yes | #17, #18 | Ranked food search | Coming before the food parts is fine (section 3). |
| 20 | `20261118140010_fitx_food_catalog_seed_part_01` | Adds 595 foods with 627 portions. | Reference data, adds only missing foods · yes | #17 | The catalogue's foods | SQL editor (0.2). #20 to #24 may wait (2.1). |
| 21 | `20261118140011_fitx_food_catalog_seed_part_02` | Adds 417 foods with 1,185 portions. | Same · yes | #17 | | SQL editor. |
| 22 | `20261118140012_fitx_food_catalog_seed_part_03` | Adds 425 foods with 1,172 portions. | Same · yes | #17 | | SQL editor. |
| 23 | `20261118140013_fitx_food_catalog_seed_part_04` | Adds 435 foods with 1,116 portions. | Same · yes | #17 | | SQL editor. |
| 24 | `20261118140014_fitx_food_catalog_seed_part_05` | Adds 430 foods with 829 portions. | Same · yes | #17 | | SQL editor. |
| 25 | `20261118150000_fitx_ai_coach` | Coach consent, conversations, proposals, safety notes, 24-hour limits. | Additive · yes | | AI coach | Needs an AI key (section 7). Reloads the API itself. |
| 26 | `20261118160000_fitx_activity_tracking` | GPS activities and their points, daily limits, the prune function. | Additive · yes | | Activity tracking | |
| 27 | `20261118160001_fitx_activity_retention_schedule` | Daily job that deletes detailed GPS points older than 90 days. | Scheduled deletion · yes | #26; pg_cron listed in Start 5 | Keeps the 90-day promise in the app | Switch pg_cron on in the Dashboard first. |
| 28 | `20261118170008_fitx_workout_sets_rep_source` | Labels a set's reps as typed or counted by the camera. | Additive · yes | | Camera form coach label | |
| 29 | `20261118180000_fitx_admin_control_plane` | Admin team list, audit log, first Admin functions. | Additive; on production drops the old draft's link to accounts · yes | Start 3: `rolbypassrls` = `t` | Admin sign-in | On production the draft's tables are there already (1.8). First super-admin after #35 and the Admin deploy (section 6.5). |
| 30 | `20261118180001_fitx_admin_roles` | Five Admin roles and one permission check. | Widens a rule, replaces 2 functions · yes | #29 | Roles, access by email | |
| 31 | `20261118180002_fitx_admin_audit_log` | The audit log becomes permanent and append-only. | Takes privileges away, permanent · yes | #29 | Audit screen, People actions | Cannot be undone, by design. |
| 32 | `20261118180003_fitx_admin_metrics` | Exact metrics and daily trends (counts only). | Additive · yes | #29 | Admin Overview and Reports | |
| 33 | `20261118180004_fitx_admin_people` | People search and "Sign out everywhere". | Additive · yes | #29, #30; Start 4 for "Sign out everywhere" | People screen | |
| 34 | `20261118180005_fitx_support` | Help requests and replies, with limits; support queue. | Additive · yes | #29, #30 | /help form, support queue | |
| 35 | `20261118180006_fitx_announcements` | Announcements and dismissals. | Additive · yes | #29, #30 | Announcement banner | |
| 36 | `20261118190000_fitx_billing_razorpay` | Billing tables and functions; seeds no plan. | Additive · yes | | Premium subscriptions, later | Best after #29 to #35: Admin's billing page uses their roles (the database does not need them). Nothing is sold until Razorpay is set up. |
| 37 | `20261118200000_fitx_food_catalog_rajma_keywords` | Search words "rajma" and "rajmah" for the six kidney-bean foods. | Changes 6 catalogue rows · yes | #17; its foods come from #20 | "rajma" in food search | After #24, also when the food parts wait (2.1). |
| 38 | `20261119100000_fitx_activity_sources` | Labels where each activity came from: recorded with FITX, or imported from a GPX, TCX or FIT file (format, the device the file names, import time). | Additive · yes | #26 | Activity imports (/activity/import), source labels | Until it is applied the import page says imports switch on after the update; everything else works. |
| 39 | `20261119100010_fitx_exercise_notes` | Members' private notes on exercises: one per exercise, up to 500 characters. | Additive · yes | #11 | "Your note" on exercise pages | Until it is applied the exercise page hides the note box. |
| 40 | `20261119100020_fitx_exercise_favorites` | Adopts experience 2.0's saved-exercises table (owner only) as a file. | Additive · yes | #11 | Saved exercises in the account, on every device and in "Download my data" | On production it changes nothing (1.8). Until it is applied on a new project, saved exercises stay on the device. |
| 41 | `20261120100000_fitx_onboarding_v3` | Date of birth (age follows it), the maintain-weight goal, where meals come from and the nutrition goal. | Additive · yes | #4, #7 | The three setup pages: date of birth, Maintain weight, food preference and nutrition goal | Until it is applied setup asks the date of birth but saves only the age, offers Maintain weight greyed out and leaves out food preference and nutrition goal. |
| 42 | `20261121100030_fitx_admin_v2` | Username and password sign-in for Admin operators, database sessions, sign-in limits, operator versions of every Admin write function. | Additive · yes | #29 to #35 | Admin /login and every Admin write | Until it is applied Admin refuses every sign-in and logs the missing migration; the FITX app is unaffected. Replaces the role table of #30 (21 permissions). |
| 43 | `20261121100033_fitx_admin_ops` | Platform settings (feature switches, maintenance notice, website information), notices to chosen accounts, the Complaint category and unread tracking for Help requests, account search v2, Dashboard and Security summaries; the Dashboard's active counts and trend also count a walk, run or ride (it replaces #32's two functions). | Additive · marks older Help requests read · yes | #42; #26, #32, #34, #35 and #36 | Admin Settings, Notifications, Support inbox and Security; the app's /unavailable page, notices and maintenance banner | Until it is applied the app keeps every feature on, and those Admin screens say they need this update. Before an undo, move complaint rows to another category (section 5). |
| 44 | `20261121100036_fitx_admin_content` | No table. Type and size limits on `exercise-media`, a public `food-media` bucket, operator functions to edit exercises and their media, publish programmes, edit foods, portions, photos and categories, add and edit subscription plans (never prices), and read report counts. | Additive · yes | #42; #13, #14, #17, #26 and #36 | Admin Workouts, Nutrition, Subscriptions and Reports | Before it is applied those screens say they need this update; Admin Overview is unaffected. Its `food-media` bucket is deleted in Dashboard → Storage, not with SQL. |
| 45 | `20261121100040_fitx_security_hardening` | The security review: signed-out visitors lose experience 2.0's share function and members its four unused tables; workouts are no longer broadcast; members' photo uploads and how much each member can write an hour and a day get limits; members can join published programmes only. | Takes privileges away, adds limits · yes | The tables it limits: September files, #8, #11, #14, #18, #25, #26, #35, #39, #40 |  Phase 15 hardening | No change members notice: the limits are far above normal use. Until it is applied, the app works as before. |
| 46 | `20261123100000_fitx_shell_prefs` | The "Floating AI Coach button" setting on the account (`user_preferences.coach_launcher`, on by default). | Additive · yes | September files | Settings → "Floating AI Coach button" saved to the account, on every device | Until it is applied the switch says it applies on this device only. |
| 47 | `20261123100010_fitx_onboarding_v4` | Home's quote of the day: a library of 372 quotes, the quote each member was shown on each day, and the function that picks it. | Additive · yes | #45 (its write limits) | The same quote on every device, never repeated while unseen ones remain; in "Download my data" | Large (50 KB): section 0.1. Until it is applied Home keeps the quote history in the browser. |
| 48 | `20261123100020_fitx_workout_setup` | The Workouts first-time setup: when it was finished and the demonstration model (male or female); a model and a caption on exercise media for wave 2. | Additive, fills `workout_setup_at` for onboarded members (once, when the column is added) and for members with an equipment list · yes | #11, #13 | Workouts setup asked once, the model choice saved | Until it is applied the setup counts as done for members with an equipment list, and the model follows the profile's sex. |
| 49 | `20261123100040_fitx_nutrition_v2` | The Nutrition first-time setup: when it was answered. | Additive, fills `nutrition_setup_at` for members with a diet saved · yes | #7 | Nutrition setup asked once | Until it is applied the setup counts as done when a diet is saved. |
| 50 | `20261123100050_fitx_coach_activity_v2` | Seven more Activity sports (hike, trail run, mountain bike, e-bike, wheelchair, inline skate, paddle) and each activity's best efforts. | Additive (a wider sport rule in place of the old one) · yes | #26 | The new sports on Record and import; best efforts saved with each activity | Until it is applied the app offers walk, run and ride only and works best efforts out on the activity page. Before an undo, delete or change activities of the new sports (section 5). |
| 51 | `20261123100060_fitx_social_v1` | Explore, part 1: profiles, follows and follow requests, photo posts, hashtags, likes, saves, comments, blocks, restrictions, reports and notifications (15 tables), 57 functions, the private `social-media` bucket with 3 storage policies, rate counters and write limits. | Additive · yes | #45 (its write limits) | Explore | Large (90 KB): section 0.1. Until it is applied Explore says it needs the next update; everything else works as before. Its bucket is emptied and deleted in Dashboard → Storage, not with SQL (section 5). |
| 52 | `20261124100000_fitx_social_v2_core` | Explore, part 2 core: stories (with views and likes), member sanctions, the storage trash, conversations and messages, communities and members, challenges (templates, entries, badges) and the moderation record (15 tables); moderation states on posts and comments; item-level visibility, sanctions, age bands and the Explore switch enforced in the database; report evidence; video posts; the bucket also takes `video/mp4`; the hourly clean-up job `fitx-social-hourly`; Realtime inbox pings; an index for the project's daily video plays. 25 new functions, 36 of #51's rewritten under the same names and arguments, the notification settings save from 5 to 9 parameters. | Additive (one relaxed rule: a notification may name no member) · yes | #51; #41 (date of birth), #42 (operator links), #43 (the Explore switch), #45 (its write limits); #27's pg_cron for the hourly job (skipped without the `cron` schema) | Explore part 2 (stories, video, groups, challenges, moderation) | Large (149 KB): section 0.1. Before the wave-2 deploy; wave 1's Explore keeps working with it. Once it is applied, never run #51 again (section 0.1). It deletes no row. |
| 53 | `20261124100010_fitx_social_v2_groups` | Explore part 2 groups: direct messages (requests, who can message you, blocks, unsend, a stop on repeated text, unread counts, Realtime pings), communities run by FITX (directory, private requests, member posts and discussions, removal by a community's moderators), challenges with values computed only from the member's own workouts and activities, opt-in leaderboards for adults, "Completed" and "Top 3" badges, templates that open a challenge each week and month, and the hourly job `fitx-challenge-hourly`. 24 new functions and one index; no table, policy or trigger. | Additive · yes | #52 (all its tables and helpers); #27's pg_cron for the job (skipped without the `cron` schema) | Explore messages, communities and challenges | Large (70 KB): section 0.1. Before the wave-2 deploy; wave 1's Explore does not call it. It changes no row. |
| 54 | `20261124100020_fitx_admin_explore` | Admin's Explore section: the `explore.view` and `explore.moderate` permissions (the role table recreated with 23 permissions; support agents view only); the `explore` and `explore_video` switches in the settings save (a switch the form leaves out keeps its saved value); moderating reports (dismiss, take for review, limit, hide, unhide, remove, clear photo or bio, warn, suspend, lift), each closing the reports, telling the reporters, keeping evidence 90 days and writing the audit row in one transaction; FITX's communities, their moderators, challenges (closed through #53's `fitx_social_challenge_tick`), templates; the Free-plan meter. No table; one index. | Additive · yes | #52 (every table it uses); #42 and #43 (the functions it recreates); #53 (the challenge close) | Admin's Explore section; the Explore switches in Settings | Large (47 KB): section 0.1. Before the wave-2 deploy. Once it is applied, never run #42 or #43 again (section 0.1). |
| 55 | `20261125100000_fitx_social_reports_column_privileges` | Members still read their own Explore reports (what they reported, their reason and note, the status and the dates) but no longer the evidence FITX stores with them (`evidence` and `evidence_purge_at`): a read of ten columns in place of #51's read of the whole table. Admin and the server key are unchanged. | Takes privileges away · yes | #51 (the table and its read), #52 (the evidence columns) | A reporter can no longer fetch the copy of what they reported through the API | Small (3 KB): the connector takes it whole (section 3). No deploy needs it; members notice nothing. Undone before #52 (section 5), so it does not run again after #51's file at the end of #52's undo. Only if #51's file runs by mistake while #52 and #55 are in place, run #52 and then #55 again after it (section 0.1). |

### 2.1 Allowed: the food parts last

The five food parts (#20 to #24) and #37 may instead come after #36, even after the new app is deployed
(section 6.4), for example on another day. The order is then #1 to #19, #25 to #36, then #20 to #24 and #37.

- Nothing else needs them. The only later file that reads the catalogue's rows is #37, which adds search
  words to six foods from #20, so it moves with them and stays after #24. Applied before them, it would change
  nothing, and nothing would run it again.
- Meanwhile the new app's food search answers from its built-in food list and members' own foods, and
  members log food as usual. The food parts add catalogue rows only and never touch members' data.
- Their Checks, the Smoke after #24 and section 6.3 stay as written; History 1 gives every file its own
  number whatever order they ran in. Section 6 then follows #37, except two parts that come right after #36:
  the final checks (6.1), which give the same results then, and the deploy (6.4), which may then come before
  #20. The Smoke (6.2) runs after #24, on that later day.

`tests/integration/migrations.test.mjs` applies them last on a copy of production's database, runs 6.1 and
searches as a member in between, and checks that the result is exactly the same as with every file in order.

## 3. Each file: summary and check

Expected values are in the order of the query's columns: `t` is true, `f` is false. A Check that runs a
moment after members used the app can show slightly different counts; the session says why.

### #1 `20261115100000_fitx_workout_session_pause_timing`

Workout sessions get three new fields: active time so far, when the current stretch started, and when the
session was paused. Members: pausing is saved with the workout, so a paused workout keeps its time after a
reload or on another device. The live app uses the fields too as soon as they are there. Workouts still open when
#1 runs have no saved time yet: their clock shows the time since they were started, and a pause that the live app
kept only on the phone is dropped at the next reload. Finishing such a workout records that time as its length.
On production "when the session was paused" (`paused_at`) is already there from experience 2.0 (section 1.8),
of the same type, and empty while Start 10 shows no workouts with experience 2.0 pauses, so #1 adds the other two
and keeps it.

```sql
-- Before 20261115100000: workouts open now, oldest first, with the hours their clock will show after #1
select id, started_at, round(extract(epoch from now() - started_at) / 3600, 1) as hours_since_start
from public.workout_sessions where status = 'in_progress' order by started_at;
```

On 2026-11-17 production had three workouts, all open. One open for days is probably a workout its member forgot
to finish. Tell the session about any such workout: with the member, it can be finished or abandoned in the app
first. (#16 also closes all but the newest open workout of each member, as abandoned.)

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

On production all five fields are already there from experience 2.0 (section 1.8), with the same types, and
the live app already saves targets and set times in them. There #2 adds only the five range checks, and it runs
experience 2.0's three checks on the same fields against the saved rows, which they were never checked against.
A saved value outside a range would stop #2, so run the Before query first.

```sql
-- Before 20261115110000: saved values its range checks would refuse. Expect: 0, 0, 0
select
  (select count(*) from public.workout_plan_exercises
    where target_weight_kg not between 0 and 2000 or target_duration_seconds not between 1 and 7200) as planned_exercises,
  (select count(*) from public.workout_session_exercises
    where target_weight_kg not between 0 and 2000 or target_duration_seconds not between 1 and 7200) as live_exercises,
  (select count(*) from public.workout_sets where duration_seconds not between 1 and 86400) as sets;
```

If a count is not 0, tell the session: it lists those rows (read-only), and the value is corrected with your OK
before #2. (Where the fields do not exist yet, this query reports a missing column: there is nothing to check.)

```sql
-- Check 20261115110000: expect 5, 5, 0
select
  (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (
     ('workout_plan_exercises', 'target_weight_kg'), ('workout_plan_exercises', 'target_duration_seconds'),
     ('workout_session_exercises', 'target_weight_kg'), ('workout_session_exercises', 'target_duration_seconds'),
     ('workout_sets', 'duration_seconds'))) as target_columns,
  (select count(*) from pg_constraint where conname in (
     'workout_plan_exercises_target_weight_kg_check', 'workout_plan_exercises_target_duration_seconds_check',
     'workout_session_exercises_target_weight_kg_check', 'workout_session_exercises_target_duration_seconds_check',
     'workout_sets_duration_seconds_check')) as target_checks,
  (select count(*) from pg_constraint where conrelid in ('public.workout_plan_exercises'::regclass,
     'public.workout_session_exercises'::regclass, 'public.workout_sets'::regclass) and not convalidated) as rules_never_checked;
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
-- Before 20261118120001: goal types in use. Expect: only manual (a type other than manual, calories_kcal, protein_g, water_ml, workouts_completed, body_weight_kg or tasks_completed could no longer be edited)
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
-- Record 20261118130010 (writes, after the SQL editor run). Expect: one row, 20261118130010
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118130010', 'fitx_exercise_catalog_cleanup') on conflict (version) do nothing returning version;
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
targets (owner only). Logged meals and custom foods keep their "updated" time from now on. A barcode is 8 to 14
digits, and a member has one active food per barcode: archiving a food frees its barcode.

On production custom foods already have a barcode field from experience 2.0 (section 1.8), with two rules of
its own: 8, 12, 13 or 14 digits, and one food per barcode per member, archived foods included. #18 keeps the
field and replaces both rules with its own. Every barcode the older rules allowed passes the new ones, and no
custom food had a barcode on 2026-11-17, so nothing changes for members.

```sql
-- Check 20261118140001: expect 8, 3, custom_foods_touch_updated_at,meals_touch_updated_at, f, CHECK (((barcode IS NULL) OR (barcode ~ '^[0-9]{8,14}$'::text))), custom_foods_user_barcode_idx
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'custom_foods' and column_name in
     ('barcode', 'origin', 'value_basis', 'image_path', 'image_url', 'image_attribution', 'source_ref', 'archived_at')) as new_columns,
  (select count(*) from pg_class where oid in (to_regclass('public.meal_templates'), to_regclass('public.meal_template_items'),
     to_regclass('public.nutrition_targets')) and relrowsecurity) as tables_with_row_security,
  (select string_agg(tgname, ',' order by tgname) from pg_trigger
    where tgrelid in ('public.custom_foods'::regclass, 'public.meals'::regclass) and not tgisinternal) as updated_time_triggers,
  has_table_privilege('anon', 'public.meal_templates', 'SELECT') as visitors_read,
  (select string_agg(pg_get_constraintdef(c.oid), '; ' order by c.conname) from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname = 'barcode'
    where c.conrelid = 'public.custom_foods'::regclass and c.contype = 'c') as barcode_rules,
  (select string_agg(i.relname, ',' order by i.relname) from pg_index x join pg_class i on i.oid = x.indexrelid
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any (x.indkey::int2[]) and a.attname = 'barcode'
    where x.indrelid = 'public.custom_foods'::regclass and x.indisunique) as barcode_indexes;
```

### #19 `20261118140002_fitx_search_foods`

Adds the database food search. It returns catalogue foods and the member's own foods that contain every typed
word, how often the member logged each one in the last 60 days, and close spellings when nothing matches. It
runs with the member's own rights. Its number puts it before the five food parts, and that is fine: until the
parts are in, the app fills in from its built-in food list. #20 to #24 can follow in the same sitting or later
(section 2.1).

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
portions. A second run changes nothing and never undoes a later correction. They may wait until after #36 and
the deploy, with #37 after them (section 2.1). Apply each through the SQL editor (section 0.2), then record it:

```sql
-- Record 20261118140010 (writes, after the SQL editor run). Expect: one row, 20261118140010
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140010', 'fitx_food_catalog_seed_part_01') on conflict (version) do nothing returning version;
```

```sql
-- Record 20261118140011 (writes, after the SQL editor run). Expect: one row, 20261118140011
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140011', 'fitx_food_catalog_seed_part_02') on conflict (version) do nothing returning version;
```

```sql
-- Record 20261118140012 (writes, after the SQL editor run). Expect: one row, 20261118140012
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140012', 'fitx_food_catalog_seed_part_03') on conflict (version) do nothing returning version;
```

```sql
-- Record 20261118140013 (writes, after the SQL editor run). Expect: one row, 20261118140013
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140013', 'fitx_food_catalog_seed_part_04') on conflict (version) do nothing returning version;
```

```sql
-- Record 20261118140014 (writes, after the SQL editor run). Expect: one row, 20261118140014
insert into supabase_migrations.schema_migrations (version, name)
values ('20261118140014', 'fitx_food_catalog_seed_part_05') on conflict (version) do nothing returning version;
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
Extensions → `pg_cron` → Enable). (The file also switches pg_cron on itself if it is still off; switching it on
first lets the Before query confirm it.) Then:

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

On production the old Admin draft (section 1.8) already made both tables, with no rows (Start 10). #29 keeps
them and drops the draft's link from the audit log to accounts, which would have cleared an account's ID from
the log when the account was deleted. Dropping that link locks the accounts table from then until #29 has
finished, which is quick: meanwhile every sign-in, token refresh and account lookup waits. If a request is using
the accounts table at that point, #29 waits at most 3 seconds for it, and sign-ins wait with it; then #29 stops
with `canceling statement due to lock timeout`, and nothing of it stays: run it again a minute later (section 4).
#30 then replaces the draft's role rule and its two functions.

```sql
-- Check 20261118180000: expect t, t, t, f, 3, t, 0 (or the members the old draft had), 0
select (select relforcerowsecurity from pg_class where oid = to_regclass('public.fitx_admin_members')) as team_row_security_forced,
  (select relforcerowsecurity from pg_class where oid = to_regclass('public.fitx_admin_audit_logs')) as audit_row_security_forced,
  has_table_privilege('service_role', 'public.fitx_admin_members', 'SELECT') as server_reads_team,
  has_table_privilege('authenticated', 'public.fitx_admin_audit_logs', 'SELECT') as members_read_audit,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and proname in
     ('fitx_admin_overview_metrics', 'fitx_admin_set_member', 'fitx_admin_set_exercise_active')) as admin_functions,
  (select r.rolbypassrls from pg_roles r join pg_proc p on p.proowner = r.oid
    where p.oid = 'public.fitx_admin_overview_metrics()'::regprocedure) as owner_bypasses_row_security,
  (select count(*) from public.fitx_admin_members) as team_members,
  (select count(*) from pg_constraint where conrelid = 'public.fitx_admin_audit_logs'::regclass and contype = 'f') as links_to_accounts;
```

### #30 `20261118180001_fitx_admin_roles`

Five Admin roles: super-admin, admin, support agent, content editor and viewer. One permission check that
every Admin function that changes something uses, apart from the one that records sign-ins and other events
(#31); the reading functions are server key only, and Admin checks the role before it calls them. Adds granting
access by email, the team list with emails, and an email lookup for the audit and support screens. Server key
only.

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

### #37 `20261118200000_fitx_food_catalog_rajma_keywords`

USDA names kidney beans only "Kidney beans" and "Beans, kidney, …", so a search for rajma found nothing. This
adds the search words `rajma` and `rajmah` to the six kidney-bean foods from #20: four FNDDS ones and two
Foundation ones. A search word helps search find a food but never selects it, so members still tap the kidney
beans they mean. No values change. It updates only those six rows, and a second run changes nothing.

```sql
-- Check 20261118200000: expect 6 rows, 2644289, 2644290, 2707379, 2707380, 2707381 and 2707382 (kidney beans), each with t
with member as materialized (
  select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true) as claims
)
select f.id, f.name, 'rajma' = any (f.keywords) as has_rajma
from member, lateral public.search_foods('rajma', array['rajma'], 20) as f
where not f.fuzzy
order by f.id;
```

### #38 `20261119100000_fitx_activity_sources`

Adds where each activity came from. Every existing and newly recorded activity reads `fitx_gps` through the
default, with no table rewrite. Imports store `file` with their format (GPX, TCX or FIT), the device the file
names and when they were imported. Row security and grants are unchanged, and a second run changes nothing.

```sql
-- Check 20261119100000: expect 'fitx_gps'::text, NO, 3, CHECK ((source = ANY (ARRAY['fitx_gps'::text, 'file'::text])))
select (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'source') as source_default,
  (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'source') as source_nullable,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name in ('source_format', 'source_device', 'imported_at')) as import_fields,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'activities_source_check') as source_rule;
```

### #39 `20261119100010_fitx_exercise_notes`

Adds each member's private note on an exercise (for example their seat or pin setting): one per exercise, 1 to
500 characters. Only the member can read, change or delete their notes. They are part of "Download my data" and
are deleted with the account. A note on a duplicate exercise that the catalogue clean-up merged follows it to the
kept exercise. No note exists yet, so the file changes no rows.

```sql
-- Check 20261119100010: expect t, 1, t, f, 0
select (select relrowsecurity from pg_class where oid = to_regclass('public.exercise_notes')) as row_security,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exercise_notes') as policies,
  (select bool_and(has_table_privilege('authenticated', 'public.exercise_notes', p)) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p) as members_keep_their_own,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'exercise_notes' and 'anon' = any (roles)) as visitors_have_a_policy,
  (select count(*) from public.exercise_notes) as notes;
```

### #40 `20261119100020_fitx_exercise_favorites`

Production has had `exercise_favorites` since experience 2.0 (section 1.8), with no file here. FITX now keeps each
member's saved exercises in it, so this file adopts it. On production it finds the table, its index, its owner-only
policy and its grants exactly as experience 2.0 made them and changes nothing. On a new project it creates them.
A saved exercise on a duplicate that the catalogue clean-up merged follows it to the kept exercise. Saved exercises
are part of "Download my data" and are deleted with the account.

```sql
-- Check 20261119100020: expect t, 1, t, t
select (select relrowsecurity from pg_class where oid = to_regclass('public.exercise_favorites')) as row_security,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'exercise_favorites') as policies,
  (select bool_and(has_table_privilege('authenticated', 'public.exercise_favorites', p)) from unnest(array['SELECT', 'INSERT', 'DELETE']) p) as members_save_and_remove,
  not exists (select 1 from public.exercise_favorites f join public.exercise_library e on e.id = f.exercise_id where e.merged_into is not null) as none_on_merged_exercises;
```

### #41 `20261120100000_fitx_onboarding_v3`

The three setup pages after sign-up. Adds the date of birth to profiles: members set it on their own row only, and
a trigger keeps the profile's age equal to the age it gives each time the profile is saved, so Home, Nutrition and
the AI coach keep reading the age. Profiles without a birth date keep their age. The goal rule also accepts
"Maintain weight" (the calorie target stays at maintenance). Two new answers, empty until a member gives them: where
meals mostly come from (home-cooked, outside food or both) and the nutrition goal (high protein, balanced diet or no
specific preference). Meals a day, training days a week and the vegan and eggetarian diets exist already. It changes
no existing row, and a second run changes nothing.

```sql
-- Check 20261120100000: expect t, t, f, t, 2, t, t
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'date_of_birth' and data_type = 'date') as birth_date_field,
  has_column_privilege('authenticated', 'public.profiles', 'date_of_birth', 'UPDATE') as members_set_their_own,
  has_column_privilege('anon', 'public.profiles', 'date_of_birth', 'SELECT') as visitors_read_it,
  exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_age_from_birth_date' and tgenabled = 'O') as age_follows_it,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences' and column_name in ('food_source', 'nutrition_focus')) as new_food_answers,
  (select pg_get_constraintdef(oid) like '%maintain_weight%' from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_primary_goal_check') as maintain_weight_allowed,
  (select pg_get_constraintdef(oid) like '%eggetarian%' and pg_get_constraintdef(oid) like '%vegan%' from pg_constraint where conrelid = 'public.user_preferences'::regclass and conname = 'user_preferences_diet_type_check') as vegan_and_eggetarian_allowed;
```

### #42 `20261121100030_fitx_admin_v2`

Admin's own sign-in: a username and password, no Google. Adds three tables, `admin_operators`, `admin_web_sessions`
and `admin_login_attempts`, with row level security forced and no policy, so only the server's secret key and the
database functions reach them (members and visitors have no rights on them). Adds the sign-in limits: 5 failures
from one network address lock that username on that address for 15 minutes; 50 failures from any addresses lock
the username everywhere for 5 minutes; 20 attempts per network address in 15 minutes. The lock is per address
because usernames are not secret: otherwise anyone could keep an operator, the owner too, out for good. Locked
out? Wait, or sign in from another network; a new `FITX_ADMIN_PASSWORD_HASH` (section 7) and a redeploy also clear
every address lock, because Admin makes the address keys with it. Adds
`fitx_admin_op_can`,
`fitx_admin_op_log_event` and an operator version (`fitx_admin_op_*`) of every Admin write function, all for the
server key only. Adds operator columns to the audit log (`actor_operator_id`, `actor_username`), support requests and
messages, and announcements; none is readable by members. Replaces the role table of #30 with 21 permissions. The
older Admin functions, the team list of #29 and all audit history stay. It changes no row; the owner's operator row
appears at the first sign-in. Until it is applied, Admin refuses every sign-in.

```sql
-- Check 20261121100030: expect 3, 0, f, f, 14, 21, 2, 4, 0
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('admin_operators', 'admin_web_sessions', 'admin_login_attempts') and relrowsecurity and relforcerowsecurity) as admin_tables_locked,
  (select count(*) from pg_policy where polrelid in ('public.admin_operators'::regclass, 'public.admin_web_sessions'::regclass, 'public.admin_login_attempts'::regclass)) as policies,
  has_table_privilege('authenticated', 'public.admin_operators', 'SELECT') as members_read_operators,
  has_function_privilege('anon', 'public.fitx_admin_login_check(text, text)', 'EXECUTE') as visitors_call_sign_in,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx_admin_op\_%') as operator_functions,
  cardinality(public.fitx_admin_role_permissions('super_admin')) as super_admin_permissions,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fitx_admin_audit_logs' and column_name in ('actor_operator_id', 'actor_username')) as audit_operator_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('support_requests', 'assigned_operator_id'), ('support_messages', 'author_operator_id'), ('announcements', 'created_by_operator_id'), ('announcements', 'updated_by_operator_id'))) as operator_columns,
  (select count(*) from public.admin_operators) as operators;
```

The last value becomes 1 once the owner signs in to Admin. Run later, after #43 and #44, `operator_functions` is
higher: they add their own `fitx_admin_op_*` functions.

### #43 `20261121100033_fitx_admin_ops`

What Admin's Settings, Notifications, Support and Security screens need. `platform_settings` holds one row: the
feature switches (AI coach, Home workout, Activity, Subscriptions, Help messages), the maintenance notice and the
website information (support email, Instagram). Members and visitors may read it; operators change it only through
`fitx_admin_op_save_platform_settings`. The app reads it with the publishable key, caches it for a minute, and keeps
every feature on when it cannot read it. `member_notifications` holds notices sent to chosen accounts: each member
reads and dismisses only their own, sees neither who sent them nor the batch, and the database stamps the dismissal
itself. Help requests gain a Complaint category and staff unread tracking (`staff_seen_at`, `staff_unread`, both
hidden from members). Help requests already there when the column first appears count as read when they are
resolved or closed or support wrote the newest message; the rest start unread. Adds the Admin account search v2, a
lookup of pasted recipient emails in one call, the Dashboard extras (Ever subscribed counts only accounts that paid
for a live subscription at least once) and the Security summary. It also replaces #32's two Dashboard functions
so that a walk, run or ride (#26) makes an account active, as in #44's report counts; #32's file stays as it was
applied. Every function is for the server key only. It
adds one settings row with everything on, sets `staff_seen_at` on those older Help requests (once: a second run
changes nothing) and changes no other row.

```sql
-- Check 20261121100033: expect 1, t, 11, t, t
select (select count(*) from public.platform_settings) as settings_rows,
       to_regclass('public.member_notifications') is not null as notices,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('fitx_admin_op_save_platform_settings','fitx_admin_op_send_notifications','fitx_admin_notification_history','fitx_admin_find_users_by_emails','fitx_admin_op_support_mark_seen','fitx_admin_support_inbox','fitx_admin_search_users_v2','fitx_admin_overview_extras','fitx_admin_security_overview','fitx_support_staff_seen','fitx_member_notification_dismiss_guard')) as functions,
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='support_requests' and column_name='staff_unread') as unread_column,
       (select pg_get_constraintdef(oid) ilike '%complaint%' from pg_constraint where conrelid='public.support_requests'::regclass and conname='support_requests_category_check') as complaints;
```

### #44 `20261121100036_fitx_admin_content`

What Admin's Workouts, Nutrition, Subscriptions and Reports screens need. Adds no table. Sets type and size limits
on the public `exercise-media` bucket (JPEG, PNG, WebP and AVIF photos, MP4 and WebM loops, 50 MB at most) and adds
a public `food-media` bucket with the same kind of limits. No storage policy: only the Admin server uploads, through
one-time signed upload URLs. Adds 16 functions for the server key only: edit exercises (a new one starts hidden;
delete only an Admin-made one that nothing uses) and their photos and videos, publish programmes or move them back
to draft, edit foods (changing the values of a USDA food makes it a FITX food: source `fitx_admin`, licence `FITX`,
no USDA id or data type, and never lab analysed or compiled), their portions, photos and categories, add and edit
subscription plans (prices and plan ids already set never change: Razorpay fixes them), and report counts (a walk,
run or ride makes an account active, as on the Dashboard). Each checks the operator's role and writes one audit row.
It changes no row.

```sql
-- Check 20261121100036: expect 16, 2
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fitx_admin_op_save_exercise','fitx_admin_op_delete_exercise','fitx_admin_op_add_exercise_media','fitx_admin_op_remove_exercise_media','fitx_admin_op_set_programme_status','fitx_admin_op_training_counts','fitx_admin_op_save_food','fitx_admin_op_set_food_active','fitx_admin_op_set_food_portions','fitx_admin_op_set_food_image','fitx_admin_op_rename_food_category','fitx_admin_op_food_categories','fitx_admin_op_save_billing_plan','fitx_admin_op_report','fitx_admin_content_text_array','fitx_admin_content_slug')) as functions,
  (select count(*) from storage.buckets where id in ('exercise-media','food-media') and public and file_size_limit is not null) as buckets;
```

### #45 `20261121100040_fitx_security_hardening`

The database security review (phase 15). Five fixes, each needed because a member or a visitor could use the publishable
key, which every browser has, straight against the database:

- Signed-out visitors can no longer call experience 2.0's `get_activity_share`, and members and visitors lose every right
  on its four unused tables (section 1.8). Only the server key reaches them; nothing in them is deleted.
- `workout_sessions` leaves the Realtime broadcast. Nothing in FITX listens to it, and Realtime sends deletions without
  checking who may see them, so any visitor could watch members' workouts being deleted.
- A member's private photo folder (profile photo and food photos) holds at most 1,000 files and 250 MB, and at most 100
  files in it may be under an hour old. The browser uploads there directly, so one account could otherwise fill the
  project's storage. It counts the files that are there: a deleted file no longer counts, so this limits what is
  stored, not how often a script uploads and deletes.
- Each member can write at most 10,000 rows and 50 MB an hour, and 50,000 rows and 150 MB in 24 hours, to the tables
  members write directly (workouts, meals, To-Dos, activities, the coach and the rest). A busy day is a few thousand
  rows and a few MB. The count is kept in a new table, `fitx_member_write_budget` (hourly totals, server key only;
  hours over two days old are deleted, for every member, at any member's first write of an hour); past the limit the
  write is refused with "write limit reached". Writes by the server, Admin and sign-up are
  not counted. Help requests and replies keep their own limits (#34).
- A member can join only a published programme, and can bring back a left or completed enrolment only while its
  programme is published. Before, a member who knew a draft programme's id could join it, or set an old enrolment
  back to active, and read its unpublished days. Resuming a paused enrolment stays allowed.

It changes no row, and a second run changes nothing.

```sql
-- Check 20261121100040: expect f, 0, 0, 1, 66, t, f
select
  coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p where p.oid = to_regprocedure('public.get_activity_share(text)')), false) as visitors_call_share,
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('food_favorites', 'outdoor_activities', 'activity_shares', 'user_release_reads')
     and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))) as leftover_tables_open,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public') as broadcast_tables,
  (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'fitx_media_insert_quota' and not polpermissive) as photo_limit,
  (select count(*) from pg_trigger where tgname in ('fitx_write_budget_insert', 'fitx_write_budget_update') and tgenabled = 'O') as write_limit_triggers,
  exists (select 1 from pg_trigger where tgrelid = 'public.programme_enrolments'::regclass and tgname = 'programme_enrolments_published') as published_programmes_only,
  has_table_privilege('authenticated', 'public.fitx_member_write_budget', 'SELECT') as members_read_the_count;
```

66 is two triggers on each of the 33 tables members write directly. If `broadcast_tables` is not 0, a table was added
to Realtime outside these files: tell the session. Run later, after #47, #51 and #52, `write_limit_triggers` is higher: they add the
same limits to their own tables.

### #46 `20261123100000_fitx_shell_prefs`

The Settings switch "Floating AI Coach button". Adds `user_preferences.coach_launcher`, true (the button shows)
unless the member turns it off; then it stays off after a refresh, a new sign-in or on another device until they
turn it back on. Hiding the button for one page load is not stored. The owner-only policy, the grants and #45's
write limits on `user_preferences` already cover the column, so there is no new table, policy or function. It
changes no row, and a second run changes nothing.

```sql
-- Check 20261123100000: expect boolean, NO, true
select data_type, is_nullable, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'coach_launcher';
```

### #47 `20261123100010_fitx_onboarding_v4`

Home's quote of the day. `daily_quotes` holds the library of 372 quotes (members and the app read it; nobody writes
it from the browser). `daily_quote_history` keeps which quote each member was shown on each local day: one row per
member and day, never the same quote twice for one member; members read only their own rows and write none
directly, the function below writes them, #45's write limits count them, and they go with the account and are in
"Download my data". `fitx_daily_quote(date, text[])` picks the day's quote (`security definer`, `search_path = ''`,
for signed-in members only). It changes no existing row, and a second run changes nothing.

```sql
-- Check 20261123100010: expect 372, t, t, 2
select (select count(*) from public.daily_quotes) as quotes,
       pg_catalog.to_regclass('public.daily_quote_history') is not null as history,
       pg_catalog.to_regprocedure('public.fitx_daily_quote(date,text[])') is not null as picker,
       (select count(*) from pg_catalog.pg_trigger where tgrelid = 'public.daily_quote_history'::regclass and tgname like 'fitx_write_budget_%') as budget_triggers;
```

### #48 `20261123100020_fitx_workout_setup`

The Workouts first-time setup. Adds `user_preferences.workout_setup_at` (when the member last finished it; null:
not yet) and `user_preferences.demo_model` (`male`, `female`, or null to follow the profile's sex), with the named
check `user_preferences_demo_model_check`. The setup's other answers use columns that exist already. For wave 2's
demonstration media it adds `exercise_media.model` and `exercise_media.caption` (at most 280 characters), with the
named checks `exercise_media_model_check` and `exercise_media_caption_check`; the unique key on `exercise_media`
stays. So that nobody who already answered the training questions is asked again, it sets `workout_setup_at` to now
(a) on the run that adds the column, and only then, for every member who has finished onboarding (`profiles.onboarded`:
the old onboarding asked where they train, their experience, days and equipment, and saved no equipment list for a gym
member who kept the full-gym default), and (b) on every run, for members who have a saved equipment list. It changes
no other row. A second run changes nothing for members already marked; a member who joins after the deploy is still
asked once. (An undo followed by a new run after the deploy would mark everyone onboarded by then.)

```sql
-- Check 20261123100020: expect 4
select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'user_preferences' and column_name in ('workout_setup_at', 'demo_model')) or (table_name = 'exercise_media' and column_name in ('model', 'caption')));
```

### #49 `20261123100040_fitx_nutrition_v2`

The Nutrition first-time setup. Onboarding no longer asks the food questions; Nutrition asks them once and saves
them in the `user_preferences` columns that hold them already. This adds only `user_preferences.nutrition_setup_at`
(null until the setup is answered), with no default, so the table is not rewritten. The old onboarding required a
diet, so every row with a diet is marked answered now; nobody is asked again. It changes no other row, and a second
run changes nothing.

```sql
-- Check 20261123100040: expect 0, 1
select count(*) filter (where nutrition_setup_at is null and diet_type is not null) as missed,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'user_preferences' and column_name = 'nutrition_setup_at') as col
from public.user_preferences;
```

### #50 `20261123100050_fitx_coach_activity_v2`

More Activity sports and best efforts. The rule on `activities.sport` (named `activities_sport_check`) is replaced,
in one transaction and only while it does not list them yet, by one that also accepts hike, trail_run, mtb, ebike,
wheelchair, skate and paddle; walk, run and ride stay, and every existing row passes it. Adds
`activities.best_efforts` (the fastest time for each benchmark distance inside one activity, worked out on the
device) with the check `activities_best_efforts_check` (null, or a list of at most 20 entries and 4,000 bytes). No
new table, policy, function or grant: the owner-only policies on `activities` cover the column, and it is part of
the activities in "Download my data". It changes no row, and a second run changes nothing.

```sql
-- Check 20261123100050: expect t, t, t
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'activities' and column_name = 'best_efforts') as best_efforts,
       (select position('paddle' in pg_get_constraintdef(oid)) > 0 from pg_constraint where conname = 'activities_sport_check' and conrelid = 'public.activities'::regclass) as sport_check_lists_paddle,
       exists (select 1 from pg_constraint where conname = 'activities_best_efforts_check' and conrelid = 'public.activities'::regclass) as best_efforts_check;
```

### #51 `20261123100060_fitx_social_v1`

Explore, part 1. Fifteen tables, all with row level security: profiles (a separate Explore profile, public or
private), follows and follow requests, photo posts and their photos, hashtags, likes, saves, comments with
replies, blocks, restrictions, reports, notifications and notification settings, and the anti-spam counters.
Members read rows only through the 18 select and storage policies, which call visibility helpers (a block either
way hides everything; a private account's posts reach only its accepted followers), and write nothing directly:
every change goes through one of the 57 `fitx_social_*` functions (`security definer`, `search_path = ''`), which
take the member from the session and check blocks, privacy, sizes and daily limits first. Every table a member's
action writes has #45's write limits (28 triggers). Photos go to the new private `social-media` bucket (WebP or
JPEG, at most 3 MB each), at `<member>/<post>/<n>`; a file can be read only by its owner and by members who may see
its post or profile. Each member may upload 60 files in 24 hours, counted as they are uploaded (deleting a file gives
none back), and keep 600 files and 150 MB in all. A restricted member's comment reaches no one but them and the post's
owner, in notifications too: no reply or mention notification, no snippet. Members' Explore rows are in "Download
my data" (the counters are left out) and go with the account; the app removes the account's photos from the bucket
before it deletes the login. It touches no existing table, row or policy, and a second run changes nothing.

```sql
-- Check 20261123100060: expect 15, 18, 57, 0, 1, 28
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'social\_%' and rowsecurity) as tables_with_rls,
       (select count(*) from pg_policies where (schemaname = 'public' and tablename like 'social\_%') or (schemaname = 'storage' and policyname like 'social\_media\_%')) as policies,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx\_social\_%') as functions,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx\_social\_%' and prosecdef and not coalesce(proconfig, '{}') @> array['search_path=""']) as definer_without_search_path,
       (select count(*) from storage.buckets where id = 'social-media' and not public and file_size_limit = 3145728 and allowed_mime_types = array['image/webp','image/jpeg']) as bucket,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'social\_%' and t.tgname like 'fitx\_write\_budget\_%') as budget_triggers;
```

### #52 `20261124100000_fitx_social_v2_core`

Explore, part 2 core (wave 2). Fifteen new tables, all with row level security: stories (24 hours, photo or video)
with their views and likes, member sanctions, the storage trash, conversations with their two sides and messages,
communities and their members, challenges with their templates, entries and badges, and the moderation record. The
group tables get only own-row read policies for now (a member's own messages, sides, memberships, entries and
badges); the challenge templates, the trash and the moderation record have no policy and no grant to members at all
(service role and `security definer` functions only, section 6.1). Posts and comments get a moderation state
(visible, limited or hidden); an active Explore sanction stops the member's own Explore use and hides their posts,
comments and stories from everyone else; age bands come from the date of birth (without one a member is never an adult: the age entered only marks
an under-13 or a teen, O1 (a)), and members without a date of birth can add one once, and a saved date of birth is then changed or cleared only by FITX support (the trigger
`profiles_birth_date_locked` refuses a member's change; service role and the SQL editor may; a date a member adds from
Profile after joining Explore is stamped for Admin like one from Explore settings); Admin's Explore switch (`platform_settings`) is enforced in the database, with
deleting, blocking, reporting and settings kept open. Reports keep an evidence snapshot (removed 90 days after
review), a report now goes through across a block, and restricting is rate limited. Video posts (one video of at most
30 seconds) follow Admin's `explore_video` switch; the `social-media` bucket also takes `video/mp4` (still 3 MB a
file); signed video links have a daily play budget (each video counted once a member a day, in the new column
`social_rate_counters.paths`, and a member's share of the project's plays capped; the project's daily total is read
through the new index `social_rate_counters_video_day_idx`). 25 new functions; 36 of #51's functions are rewritten under the
same names and arguments, and #51's read policies on posts, post photos and comments now call the item-level helpers;
`fitx_social_save_notification_prefs` goes from 5 to 9 parameters (the four new ones have defaults, so wave 1's call
still works). New tables members write have #45's write limits (16 more triggers). On production it also schedules
the hourly clean-up job `fitx-social-hourly` (expired stories, orphan files, old report evidence and notifications;
files leave the bucket only through the server's sweep) and adds the Realtime policy `social_inbox_read`. It deletes
no row; `social_notifications.actor_id` may now be empty (notices from FITX). A message records whether it was sent
as a shared post or a story reply (`shared_post`, `story_reply`), so it still says so after the post is deleted or the
story is cleaned up; a notice about a conversation shows only while the other side has no block either way and no
Explore suspension, and a message request's notice only while the request waits. The username `new` is kept for FITX
from now on (so `/explore/stories/new` is always the story composer); a member who already has it keeps it. A second
run changes nothing. After it, #51's Check gives other numbers: use this one.

md5 of the file (`md5 -q`): `ed9473c19c4a587f5201fb0a79710b4f`. The session compares it with the file it sends before it runs it.

```sql
-- Check 20261124100000: expect 30, 30, 82, 0, 1, 44, 5, 9, 2, 1, 1
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'social\_%' and rowsecurity) as tables_with_rls,
       (select count(*) from pg_policies where (schemaname = 'public' and tablename like 'social\_%') or (schemaname = 'storage' and policyname like 'social\_media\_%')) as policies,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx\_social\_%') as functions,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx\_social\_%' and prosecdef and not coalesce(proconfig, '{}') @> array['search_path=""']) as definer_without_search_path,
       (select count(*) from storage.buckets where id = 'social-media' and not public and file_size_limit = 3145728 and allowed_mime_types = array['image/webp','image/jpeg','video/mp4']) as bucket,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'social\_%' and t.tgname like 'fitx\_write\_budget\_%') as budget_triggers,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'social\_%' and column_name = 'moderation_state') as moderation_columns,
       (select string_agg(pronargs::text, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fitx_social_save_notification_prefs') as prefs_save_args,
       (select count(*) from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname in ('profiles_birth_date_locked', 'profiles_birth_date_added') and tgenabled = 'O') as birth_date_triggers,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'social_rate_counters' and column_name = 'paths') as play_paths,
       (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'social_rate_counters_video_day_idx') as play_budget_index;
```

Before #52 it gives `15, 18, 57, 0, 0, 28, 0, 5, 0, 0, 0`. On production the session then also checks the job and the Realtime
policy, expecting `1, 1`: `select (select count(*) from cron.job where jobname = 'fitx-social-hourly') as hourly_job,
(select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname =
'social_inbox_read') as inbox_policy;` (the test copy has neither pg_cron nor Realtime). A 0 there means pg_cron or
Realtime was off when #52 ran: tell the session; #52 can be run again once it is on.

Run after #53 instead of right after #52, this Check gives `30, 30, 106, 0, 1, 44, 5, 9, 2, 1, 1` (#53 adds 24 functions; the
rest does not move).

### #53 `20261124100010_fitx_social_v2_groups`

Explore part 2's groups (wave 2): 24 functions, one index and one scheduled job, on #52's tables; it creates no table,
policy or trigger and changes no row. Direct messages: both people must be adults (18 and over, by the date of birth;
no date of birth counts as under 18), a block either way stops sending and hides the conversation, "who can message
you" (everyone, people you follow, mutual follows, or no one new), a first message from someone the member does not
follow arrives as a request (one message, a notice that names nobody, no links), limits on new conversations and
messages, a stop on the same text sent to several people, "Unsend" (the text is blanked), story replies, and unread
counts (unknown is empty, never 0; a suspended member's messages and requests are not counted, as they are not
listed). Messages are not end-to-end encrypted: the service key, and so Admin's evidence view for a reported message,
can read them. Communities are made by FITX in Admin (#54); members join (a private one asks
first), post and start discussions; a community's moderators can hide a post in their own community only, which is
recorded. Challenges count only the member's own completed workouts and activities from when they joined (a run saved
as both counts once), the leaderboard shows only adults who switched it on, and "Completed" and "Top 3" badges (Top 3
only with 10 or more on the board) are given when a challenge closes, 2 hours after its end (until then it stays
under Open for the members who joined it). On production it also schedules `fitx-challenge-hourly` (minute 23 of
every hour): it brings every entry up to date, closes ended challenges and opens each template's challenge for the week (Monday) and month (the 1st), India time. A second run changes nothing.

md5 of the file (`md5 -q`): `1f99d234d1c8a84ebbd22e75e3c687e8`. The session compares it with the file it sends before it runs it.

```sql
-- Check 20261124100010: expect 24, 0, 0, 0, 22, 1, 106
with fns as (select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[
  'fitx_social_send_message', 'fitx_social_conversations', 'fitx_social_messages', 'fitx_social_answer_conversation',
  'fitx_social_mark_conversation_read', 'fitx_social_unsend_message', 'fitx_social_set_dm_policy', 'fitx_social_unread_counts',
  'fitx_social_communities', 'fitx_social_community', 'fitx_social_community_posts', 'fitx_social_join_community',
  'fitx_social_answer_community_request', 'fitx_social_leave_community', 'fitx_social_create_group_post',
  'fitx_social_moderator_remove_post', 'fitx_social_challenges', 'fitx_social_challenge', 'fitx_social_join_challenge',
  'fitx_social_leave_challenge', 'fitx_social_set_leaderboard', 'fitx_social_challenge_board', 'fitx_social_challenge_sync',
  'fitx_social_challenge_tick']))
select (select count(*) from fns) as group_functions,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx\_social\_%' and prosecdef and not coalesce(proconfig, '{}') @> array['search_path=""']) as definer_without_search_path,
       (select count(*) from fns where has_function_privilege('anon', oid, 'execute')) as callable_by_anon,
       (select count(*) from fns where proname in ('fitx_social_challenge_sync', 'fitx_social_challenge_tick') and has_function_privilege('authenticated', oid, 'execute')) as internal_callable_by_members,
       (select count(*) from fns where has_function_privilege('authenticated', oid, 'execute')) as member_functions,
       (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'workout_sessions_user_completed_idx') as challenge_index,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'fitx\_social\_%') as explore_functions;
```

Before #53 (after #52) it gives `0, 0, 0, 0, 0, 0, 82`. On production the session then also checks the job,
expecting `1`: `select count(*) as challenge_job from cron.job where jobname = 'fitx-challenge-hourly';` (the test copy
has no pg_cron). A 0 there means pg_cron was off when #53 ran: tell the session; #53 can be run again once it is on.

### #54 `20261124100020_fitx_admin_explore`

Admin's Explore section (wave 2): 8 functions, one index, and two Admin functions recreated; it creates no table and
changes no row. The role table is recreated with 23 permissions: `explore.view` and `explore.moderate` for super-admins
and admins, `explore.view` only for support agents, neither for content editors and viewers. The settings save also
takes the `explore` switch (on unless saved off) and `explore_video` (off unless saved on), and a switch the form leaves
out keeps its saved value (Admin leaves out the two Explore switches while it cannot read Explore's state, and a
missing `explore` would read as on); nothing else in it changes.
Moderation of a report (dismiss, take for review, limit, hide, unhide, remove, clear the photo or bio, warn, suspend
from Explore, messages or uploads for 7 days, 30 days or until lifted, lift) checks the permission, changes the item or
the account, closes every open report on it, tells each reporter that FITX reviewed it, keeps the evidence 90 days
after the review, keeps the moderator's note in the moderation record only (never shown to the member, never in the
audit row) and writes the audit row, all in one transaction. FITX's communities (with covers and moderators),
challenges and templates are saved here; "Close challenge" runs #53's `fitx_social_challenge_tick` for that challenge
(a final count of every entry, the close, the ranks and the badges). The Free-plan meter reads storage per bucket and
per kind of Explore file, the database size, today's signed video bytes, the clean-up queue and the hourly job's last
run. Every function runs as its owner with an empty search path and only the server key can call it. A second run
changes nothing.

md5 of the file (`md5 -q`): `f7f4ac66f26b38899191b95347eb83b2`. The session compares it with the file it sends before it runs it.

```sql
-- Check 20261124100020: expect 8, 23, 6, 1, 1
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fitx_admin_op_moderate', 'fitx_admin_op_save_community', 'fitx_admin_op_set_community_role', 'fitx_admin_op_save_challenge', 'fitx_admin_op_close_challenge', 'fitx_admin_op_save_challenge_template', 'fitx_admin_explore_meter', 'fitx_admin_explore_reason_words')) as explore_functions,
       (select cardinality(public.fitx_admin_role_permissions('super_admin'))) as super_admin_permissions,
       (select cardinality(public.fitx_admin_role_permissions('support_agent'))) as support_permissions,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fitx_admin_op_save_platform_settings' and prosrc like '%''explore_video''%') as save_takes_explore,
       (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'social_reports_target_user_idx') as report_user_index;
```

Before #54 (after #53) it gives `0, 21, 5, 0, 0`.

### #55 `20261125100000_fitx_social_reports_column_privileges`

Explore reports (release 2c). Since #52 each report keeps a copy of the reported item, its evidence (the caption,
comment, message, bio or community text another member wrote, with its file names), for FITX's moderators until 90
days after review. #51 let members read every column of their own reports, so a reporter could still fetch that copy
through the API, even after its author deleted or unsent the item. After #55 members read their own reports without
`evidence` and `evidence_purge_at`: what they reported, their reason and note, the status and the dates, which are
the ten columns "Download my data" reads. Nothing else moves: row level security still lets each member read only
their own reports, signed-out visitors still read nothing, and the server key keeps every right, so Admin's Explore
section, the hourly clean-up and reporting itself work as before. Members notice nothing: the app never reads the
evidence. It changes no row, table, policy or function, and a second run changes nothing. #51's file runs again
only as the last step of #52's undo (section 5), which comes after #55's undo: members then already read every
column of their reports, as after #51, so #55 does not run again. If #51's file ever runs by mistake while #52 and
#55 are in place, it gives members every column back: run #52 and then #55 again after it (section 0.1).

md5 of the file (`md5 -q`): `16b1603f1e40c02cc21eb18cde948d88`. The session compares it with the file it sends before
it runs it. The file is small (3 KB), so the connector's `apply_migration` takes it whole (section 0, step 3); the
session then checks that `md5(statements[1])` of the history row the connector recorded is this md5, and History 1
(section 6.3) gives that row #55's number. (With the staged method of section 0.1 instead, the row is recorded
under #55's own number.) What the file runs, without its comments:

```sql
-- Statements 20261125100000: for reading only; the session applies the file itself
do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;
revoke select on table public.social_reports from public, anon, authenticated;
grant select (id, user_id, target_type, target_id, target_user_id, reason, details, status, created_at, reviewed_at)
  on table public.social_reports to authenticated;
notify pgrst, 'reload schema';
```

```sql
-- Check 20261125100000: expect f, f, created_at,details,id,reason,reviewed_at,status,target_id,target_type,target_user_id,user_id, f, f, t, 1
select has_column_privilege('authenticated', 'public.social_reports', 'evidence', 'SELECT') as members_read_evidence,
       has_column_privilege('authenticated', 'public.social_reports', 'evidence_purge_at', 'SELECT') as members_read_purge_time,
       (select string_agg(p.column_name::text, ',' order by p.column_name::text collate "C") from information_schema.column_privileges p
        where p.table_schema = 'public' and p.table_name = 'social_reports' and p.grantee = 'authenticated'
          and p.privilege_type = 'SELECT') as member_columns,
       has_table_privilege('authenticated', 'public.social_reports', 'INSERT, UPDATE, DELETE') as members_write,
       has_any_column_privilege('anon', 'public.social_reports', 'SELECT') as visitors_read,
       has_column_privilege('service_role', 'public.social_reports', 'evidence', 'SELECT') as server_reads_evidence,
       (select count(*) from pg_policy where polrelid = 'public.social_reports'::regclass) as policies;
```

Before #55 it gives `t, t` and `member_columns` lists every column, `evidence` and `evidence_purge_at` included; the
last four values are the same. If `member_columns` lists a column it does not name above, tell the session.

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
| `duplicate key value violates unique constraint "schema_migrations_pkey"` | any, through the connector | The history already had a row under the second the connector ran the file (section 0.2, step 4). Tell the session; it compares Start 1 and the file's Check before anything runs again. |
| `operator class "gin_trgm_ops" does not exist` | #17 | The search path lacks `extensions` (Start 6). Tell the session; do not edit the file. |
| `could not create unique index "workout_sessions_one_in_progress"` | #16 | A member opened a second workout during the run. Run the file again. |
| `extension "pg_cron" is not available`, `permission denied to create extension`, `schema "cron" does not exist` | #27 | pg_cron is not on. Switch it on in the Dashboard (section 3, #27), then run the file again. |
| `violates check constraint` | #7, #8, #9 | Existing rows break a rebuilt rule. These files run as one transaction, so nothing stayed. Tell the session; it finds the rows with a read-only query. |
| `check constraint "…" of relation "…" is violated by some row` | #2 | A saved target or set time is outside its range (Before 20261115110000). Tell the session; it finds the rows with that query. Once they are corrected, run #2 again, which is safe over any part that stayed. |
| any other `permission denied` | any | The connector is not acting as `postgres` (Start 3), or is read-only. Stop and fix the connector first. |
| The SQL editor stops or times out | #12, #20 to #24 | The file ran as one unit, so nothing stayed. Run it again. If it keeps failing, run it yourself in Terminal, in the repository folder, with the connection string from section 1.1: `psql "<the connection string>" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/<file>`. Then tell the session. |

If a file was applied but its Check does not match, do not undo it straight away. Tell the session. Most
differences have a reason (for example, a member signed up during the run).

## 5. Undoing a file

Undo only when something is broken, and only after talking to the session. Undo the most recent files
first: never undo a file while a later file that needs it is still in place (the "Needs" column in section
2). After an undo, remove that file's row from the history, so the record matches the database:
`delete from supabase_migrations.schema_migrations where name = '<the file name without number>' and version not in ('20261002172610', '20261002172706', '20261116093902');`
(the old Admin draft's row has the same name as #29 and stays, with the other two of section 1.8).

Keep the history rows of #15 and #20 to #24: their undo only hides rows, and running those files again does not
show them. To show them again: for #15,
`update public.training_programmes set status = 'published', updated_at = now() where id in ('ppl-3', 'ppl-6', 'upper-lower-4', 'full-body-3', 'bro-split-5', 'home-bodyweight-3', 'home-dumbbell-4');`
(writes; tested: 7 published again); for #20 to #24, `update public.food_catalog set is_active = true where not is_active;`
(writes).

Anything a member saved in a dropped table or column is lost. When a file only adds a feature, switching the
feature off in the app is usually better than an undo.

| # | How to undo, or why it cannot simply be undone |
|---|---|
| 55 | SQL below, then remove #55's history row. Members read every column of their own reports again, the evidence included, as from #52 to #54; nothing else moves. |
| 54 | SQL below, then remove #54's history row, then run #43's file once more (`20261121100033_fitx_admin_ops`, through the SQL editor, section 0.2 steps 1 to 3, without a Record query: #43's history row is still there): that puts back the five-switch settings save. Drops the 8 functions and the index, and puts back the 21-permission role table; Admin's Explore section then says it needs a database update. The saved `explore` and `explore_video` switches stay in `platform_settings`, where the app still reads them, but only until the next settings save: #43's save replaces all the switches with its five, and a missing `explore` reads as on (a missing `explore_video` as off). So note the Explore switch before the undo and, if it was off, set it off again after each settings save until #54 is back: `update public.platform_settings set features = features \|\| '{"explore": false}' where id = 1;` (writes). Reports, sanctions and moderation records stay. |
| 53 | Undo #54 first (its challenge close calls #53). SQL below, then remove #53's history row. Drops the 24 functions, the index and the hourly challenge job; the tables and their rows stay (they are #52's), and posts a community moderator hid stay hidden. Explore's messages, communities and challenges then say they need the next update. |
| 52 | Undo #55, #54 and #53 first. First run its Before undo query: if it is not 0, the session lists those files (stories, video posts and their posters, the photos of community, challenge, limited and hidden posts, community covers, and files already waiting in the trash) and you delete them in Dashboard → Storage, or they stay in the bucket with nothing pointing at them. Then the SQL below, then remove #52's history row, then run #51's file once more through the SQL editor (section 0.2, steps 1 to 3, without its Record query: #51's history row is still there): that puts back part 1's function bodies, its three read policies, the five-parameter notification settings save and the bucket's two file types. Deletes every story, message, conversation, community, challenge, badge, sanction and moderation record, report evidence, video and text posts, every post made in a community or a challenge (photo posts too) and every limited or hidden post and comment (a post with its comments and photos, a comment with its replies: part 1's feed, profile, Discover, hashtag and search reads would otherwise show them to every follower and, for a public account, to everyone), FITX notices and notifications and reports of the new kinds; Explore works as after #51. |
| 51 | Undo #52 first. First empty the `social-media` bucket and then delete it in Dashboard → Storage (Storage refuses to delete a bucket that still holds files, and its files are deleted with the Storage API, not with SQL). Then the SQL below. Deletes every Explore profile, post, comment, like, save, follow, block, restriction, report and notification, its functions and its storage policies; Explore then says it needs the next update. |
| 50 | First run its Before undo query: if it is not 0, delete those activities (or change their sport to walk, run or ride) or the last step fails. Then the SQL below. Drops every saved best effort and puts back the walk, run and ride rule; the app offers those three only again. |
| 49 | SQL below. Drops when each member answered the Nutrition setup; the app then counts the setup as done when a diet is saved. The answers stay. |
| 48 | SQL below. Drops the setup time, the demonstration model choice and exercise media's model and caption; the app then counts the setup as done for members with an equipment list, and the model follows the profile's sex. |
| 47 | SQL below. Drops the quote library and every member's quote history; Home falls back to a history kept in the browser. |
| 46 | SQL below. Drops the switch's stored value: the button shows again for everyone, and the switch applies on each device only. |
| 45 | SQL below. Puts back the share function for signed-out visitors, members' rights on experience 2.0's four tables and the workouts broadcast, and drops the photo and write limits (with their counts) and the published-programmes rule. |
| 44 | SQL below, then delete the `food-media` bucket (and the photos in it) in Dashboard → Storage, not with SQL. Admin's Workouts, Nutrition, Subscriptions and Reports then say they need the update; exercises, foods and plans already saved stay. |
| 43 | Undo #54 first (it recreates #43's settings save). First run its Before undo query: if it is not 0, move those Help requests to another category (for example `update public.support_requests set category = 'problem' where category = 'complaint';`, writes) or the last step fails. Then the SQL below. Drops the platform settings (every feature is on again and the website information falls back to the brand's) and every notice sent to chosen accounts. The Dashboard's active counts keep counting walks, runs and rides; to count them as before, run #32's file again. Audit rows it wrote stay: the audit log is permanent. |
| 42 | Undo #54 (it recreates #42's role table), #53, #52 (its sanctions and moderation record link to operators), #44 and #43 first. SQL below. Drops the operators, their sessions and sign-in attempts, the operator functions and the operator columns on support and announcements, and puts back the role table of #30; Admin then refuses every sign-in. The two audit columns `actor_operator_id` and `actor_username` stay, so the log keeps who did what. |
| 41 | Undo #52 first (its date-of-birth triggers depend on the column). SQL below. Drops members' birth dates (their age stays as last saved), food preference and nutrition goal, and turns Maintain weight goals into General fitness, which has the same calorie target. |
| 40 | Nothing to undo on production: the table came with experience 2.0 (1.8) and #40 changes nothing there; leave its history row. On a new project only, `drop table if exists public.exercise_favorites;` drops every member's saved exercises, and the app keeps new ones on the device again. |
| 39 | SQL below. Drops every member's exercise notes; the exercise page hides its note box again. |
| 38 | SQL below. Deletes imported activities first, so none is shown as a FITX recording afterwards; members can import their files again once it is re-applied. |
| 37 | SQL below. Removes the two search words; a search for rajma finds nothing again. |
| 36 | Only while no real payment exists: SQL below. Once Razorpay has charged anyone, never drop these tables; they are the money trail. To stop selling, set every plan's `is_active` to false. |
| 35, 34 | SQL below. Drops announcements, Help requests and replies. |
| 33, 32 | SQL below. Drops functions only; Admin falls back to its older screens. |
| 31 | Cannot be undone, by design: the audit log is permanent. |
| 30, 29 | Not undone once anyone used Admin: the team list and audit log hold the record. To switch Admin off, switch every other operator off in Admin and security, Access control, and delete `FITX_ADMIN_PASSWORD_HASH` on the admin project and redeploy: Admin then refuses every sign-in. |
| 28 | SQL below. Drops the camera label. |
| 27 | SQL below: stops the daily job. Points it already deleted are gone, by design. |
| 26 | Undo #27 first. SQL below. Drops all recorded activities. |
| 25 | Better: set `AI_COACH_ENABLED=false` (section 7). SQL below drops all coach conversations, consents and the safety notes that keep the 30-day pause. |
| 20 to 24 | SQL below hides the whole catalogue (search falls back to the built-in list); setting it back to `true` shows it again. Meals already logged keep their own copies. |
| 19 | SQL below. The app falls back to its built-in food list. |
| 18 | Undo #19 first. Then its Before undo query and the SQL below. Drops saved meals, routines, own targets, and custom foods' photos, origin and archive date, so foods members archived show again. On production the barcode field came with experience 2.0 (1.8), so it stays, with #18's barcode check (it allows every barcode experience 2.0's did), and experience 2.0's one food per barcode comes back. |
| 17 | Undo #19 to #24 and #37 first. SQL below. `pg_trgm` stays on (harmless). |
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
| 2 | SQL below. On production the five fields came with experience 2.0 (1.8) and hold the live app's targets and set times, so it drops only #2's five range checks. |
| 1 | SQL below. Drops the saved active time and stretch start; open workouts keep their clock in the browser again. On production `paused_at` came with experience 2.0 (1.8), so it stays, but emptied: otherwise #1, applied again later, would show each workout that was paused at the undo as paused with no time. |

```sql
-- Undo 20261125100000 (writes; then remove its history row)
begin;
revoke select on table public.social_reports from authenticated;
grant select on table public.social_reports to authenticated;
commit;
```

```sql
-- Undo 20261124100020 (writes; then remove its history row and run #43's file once more, as the table above says)
begin;
drop function if exists public.fitx_admin_op_moderate(uuid, uuid, text, text, text, timestamptz, text, uuid),
  public.fitx_admin_op_save_community(uuid, uuid, text, text, text, text, text),
  public.fitx_admin_op_set_community_role(uuid, uuid, uuid, text),
  public.fitx_admin_op_save_challenge(uuid, uuid, text, text, text, text, numeric, timestamptz, timestamptz, uuid),
  public.fitx_admin_op_close_challenge(uuid, uuid),
  public.fitx_admin_op_save_challenge_template(uuid, uuid, text, text, text, text, numeric, boolean),
  public.fitx_admin_explore_meter(), public.fitx_admin_explore_reason_words(text);
drop index if exists public.social_reports_target_user_idx;
create or replace function public.fitx_admin_role_permissions(p_role text) returns text[] language sql immutable
  set search_path = '' as $f$ select case p_role
  when 'super_admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'people.delete', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'audit.export', 'access.view', 'access.manage', 'settings.view', 'billing.view', 'nutrition.manage', 'billing.manage', 'notifications.send', 'settings.manage', 'security.view']
  when 'admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'access.view', 'settings.view', 'billing.view', 'nutrition.manage', 'notifications.send', 'security.view']
  when 'support_agent' then array['overview.view', 'people.view', 'people.support', 'support.view', 'support.reply']
  when 'content_editor' then array['overview.view', 'content.manage', 'announcements.manage', 'nutrition.manage', 'notifications.send']
  when 'viewer' then array['overview.view', 'reports.view'] else array[]::text[] end $f$;
commit;
```

```sql
-- Undo 20261124100010 (writes; then remove its history row)
begin;
do $u$ begin if pg_catalog.to_regnamespace('cron') is not null then
  execute $e$select cron.unschedule(jobid) from cron.job where jobname = 'fitx-challenge-hourly'$e$; end if; end $u$;
drop function if exists public.fitx_social_send_message(uuid, text, uuid, uuid), public.fitx_social_conversations(timestamptz, text),
  public.fitx_social_messages(uuid, timestamptz, uuid), public.fitx_social_answer_conversation(uuid, boolean),
  public.fitx_social_mark_conversation_read(uuid), public.fitx_social_unsend_message(uuid), public.fitx_social_set_dm_policy(text),
  public.fitx_social_unread_counts(), public.fitx_social_communities(text), public.fitx_social_community(text),
  public.fitx_social_community_posts(uuid, timestamptz, uuid), public.fitx_social_join_community(uuid),
  public.fitx_social_answer_community_request(uuid, uuid, boolean), public.fitx_social_leave_community(uuid),
  public.fitx_social_create_group_post(uuid, text, jsonb, jsonb, uuid, uuid), public.fitx_social_moderator_remove_post(uuid, text),
  public.fitx_social_challenges(text), public.fitx_social_challenge(uuid), public.fitx_social_join_challenge(uuid),
  public.fitx_social_leave_challenge(uuid), public.fitx_social_set_leaderboard(uuid, boolean), public.fitx_social_challenge_board(uuid),
  public.fitx_social_challenge_sync(uuid, uuid), public.fitx_social_challenge_tick(uuid);
drop index if exists public.workout_sessions_user_completed_idx;
commit;
```

```sql
-- Before undo 20261124100000: files in the social-media bucket that only #52's rows point to. Expect: 0
select count(*) as files_to_delete_first from storage.objects o
where o.bucket_id = 'social-media'
  and (exists (select 1 from public.social_stories s where o.name in (s.storage_path, s.poster_path))
       or exists (select 1 from public.social_post_media m join public.social_posts p on p.id = m.post_id
                  where ((p.kind <> 'photo' or p.community_id is not null or p.challenge_id is not null
                          or p.moderation_state <> 'visible') and o.name = m.storage_path) or o.name = m.poster_path)
       or exists (select 1 from public.social_communities c where o.name = c.cover_path)
       or exists (select 1 from public.social_storage_trash t where o.name = t.path));
```

```sql
-- Undo 20261124100000 (writes; then remove its history row and run #51's file once more, as the table above says)
begin;
do $u$ begin if pg_catalog.to_regnamespace('cron') is not null then
  execute $e$select cron.unschedule(jobid) from cron.job where jobname = 'fitx-social-hourly'$e$; end if; end $u$;
do $u$ begin if pg_catalog.to_regclass('realtime.messages') is not null then drop policy if exists social_inbox_read on realtime.messages; end if; end $u$;
drop trigger if exists profiles_birth_date_locked on public.profiles;
drop trigger if exists profiles_birth_date_added on public.profiles;
drop function if exists public.fitx_profiles_birth_date_locked(), public.fitx_profiles_birth_date_added();
drop index if exists public.social_rate_counters_video_day_idx;
alter table public.social_rate_counters drop column if exists paths;
drop function if exists public.fitx_social_save_notification_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean);
drop function if exists public.fitx_social_sees_post(uuid, uuid), public.fitx_social_sees_comment_row(uuid, uuid),
  public.fitx_social_sees_story(uuid, uuid), public.fitx_social_sees_community(uuid, uuid), public.fitx_social_post_listed(uuid),
  public.fitx_social_viewer_sees_comment_row(uuid), public.fitx_social_viewer_sees_story(uuid), public.fitx_social_viewer_sees_community(uuid),
  public.fitx_social_member_any(), public.fitx_social_age_band(uuid), public.fitx_social_set_birth_date(date),
  public.fitx_social_insert_post(uuid, uuid, text, text, jsonb, text, jsonb, uuid, uuid), public.fitx_social_caps(),
  public.fitx_social_video_link_allowed(text[]), public.fitx_social_ping(uuid, text, uuid),
  public.fitx_social_create_story(uuid, text, text, text, integer, integer, integer, text), public.fitx_social_delete_story(uuid),
  public.fitx_social_story_tray(), public.fitx_social_stories(uuid), public.fitx_social_view_story(uuid),
  public.fitx_social_story_viewers(uuid), public.fitx_social_set_story_like(uuid, boolean),
  public.fitx_social_my_content(timestamptz, integer), public.fitx_social_delete_all_content(), public.fitx_social_hourly() cascade;
delete from public.social_notifications where actor_id is null or type not in ('follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'reply', 'mention');
delete from public.social_reports where target_type not in ('post', 'comment', 'account');
delete from public.social_posts where kind <> 'photo' or community_id is not null or challenge_id is not null
  or moderation_state <> 'visible';
delete from public.social_comments where moderation_state <> 'visible';
drop table if exists public.social_moderation_actions, public.social_challenge_badges, public.social_challenge_entries,
  public.social_challenge_templates, public.social_messages, public.social_conversation_sides, public.social_conversations,
  public.social_community_members, public.social_story_likes, public.social_story_views, public.social_member_sanctions,
  public.social_storage_trash cascade;
alter table public.social_posts drop constraint if exists social_posts_community_id_fkey, drop constraint if exists social_posts_challenge_id_fkey;
drop table if exists public.social_challenges, public.social_communities, public.social_stories cascade;
alter table public.social_posts drop column if exists moderation_state, drop column if exists moderated_at;
alter table public.social_comments drop column if exists moderation_state, drop column if exists moderated_at;
alter table public.social_post_media drop column if exists poster_path;
alter table public.social_notifications drop column if exists story_id, drop column if exists conversation_id,
  drop column if exists community_id, drop column if exists challenge_id;
alter table public.social_notifications alter column actor_id set not null;
alter table public.social_reports drop column if exists evidence, drop column if exists evidence_purge_at;
alter table public.social_profiles drop column if exists dm_policy, drop column if exists birth_date_added_at;
alter table public.social_notification_prefs drop column if exists stories, drop column if exists challenges,
  drop column if exists communities, drop column if exists messages;
alter table public.social_posts drop constraint if exists social_posts_kind_check, add constraint social_posts_kind_check check (kind in ('photo'));
alter table public.social_post_media drop constraint if exists social_post_media_kind_check, add constraint social_post_media_kind_check check (kind in ('image'));
alter table public.social_notifications drop constraint if exists social_notifications_type_check, add constraint social_notifications_type_check
  check (type in ('follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'reply', 'mention'));
alter table public.social_notifications drop constraint if exists social_notifications_entity_type_check,
  add constraint social_notifications_entity_type_check check (entity_type in ('profile', 'post', 'comment'));
alter table public.social_reports drop constraint if exists social_reports_target_type_check,
  add constraint social_reports_target_type_check check (target_type in ('post', 'comment', 'account'));
drop index if exists public.social_notifications_created_idx, public.social_posts_community_idx, public.social_posts_challenge_idx,
  public.social_reports_target_idx;
commit;
```

```sql
-- Undo 20261123100060 (writes; empty and delete the social-media bucket in Dashboard → Storage first)
begin;
drop policy if exists social_media_read on storage.objects;
drop policy if exists social_media_insert on storage.objects;
drop policy if exists social_media_delete on storage.objects;
drop table if exists public.social_notifications, public.social_notification_prefs, public.social_reports, public.social_restricts,
  public.social_blocks, public.social_comments, public.social_saves, public.social_likes, public.social_post_hashtags,
  public.social_hashtags, public.social_post_media, public.social_posts, public.social_follows, public.social_profiles,
  public.social_rate_counters cascade;
do $do$
declare v_fn regprocedure;
begin
  for v_fn in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'fitx\_social\_%' loop
    execute format('drop function if exists %s cascade', v_fn);
  end loop;
end $do$;
commit;
```

```sql
-- Before undo 20261123100050: activities of the sports the undo takes away. Expect: 0
select count(*) as new_sport_activities from public.activities where sport not in ('walk', 'run', 'ride');
```

```sql
-- Undo 20261123100050 (writes)
begin;
alter table public.activities drop constraint if exists activities_best_efforts_check;
alter table public.activities drop column if exists best_efforts;
alter table public.activities drop constraint if exists activities_sport_check;
alter table public.activities add constraint activities_sport_check check (sport in ('walk', 'run', 'ride'));
commit;
```

```sql
-- Undo 20261123100040 (writes)
alter table public.user_preferences drop column if exists nutrition_setup_at;
```

```sql
-- Undo 20261123100020 (writes)
alter table public.exercise_media drop constraint if exists exercise_media_caption_check, drop constraint if exists exercise_media_model_check, drop column if exists caption, drop column if exists model;
alter table public.user_preferences drop constraint if exists user_preferences_demo_model_check, drop column if exists demo_model, drop column if exists workout_setup_at;
```

```sql
-- Undo 20261123100010 (writes)
drop function if exists public.fitx_daily_quote(date, text[]);
drop table if exists public.daily_quote_history;
drop table if exists public.daily_quotes;
```

```sql
-- Undo 20261123100000 (writes)
alter table public.user_preferences drop column if exists coach_launcher;
```

```sql
-- Undo 20261121100040 (writes; puts back what #45 locked down and drops its limits)
begin;
drop trigger if exists programme_enrolments_published on public.programme_enrolments;
drop function if exists public.fitx_programme_enrolment_published();
do $undo$
declare
  v record;
begin
  for v in select t.tgrelid::regclass as rel, t.tgname from pg_trigger t
           where t.tgname in ('fitx_write_budget_insert', 'fitx_write_budget_update') loop
    execute format('drop trigger %I on %s', v.tgname, v.rel);
  end loop;
  if to_regclass('public.food_favorites') is not null then
    grant all on table public.food_favorites, public.outdoor_activities, public.activity_shares, public.user_release_reads to anon, authenticated;
  end if;
  if to_regprocedure('public.get_activity_share(text)') is not null then
    grant execute on function public.get_activity_share(text) to anon;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workout_sessions') then
    alter publication supabase_realtime add table public.workout_sessions;
  end if;
end $undo$;
drop function if exists public.fitx_member_write_budget();
drop table if exists public.fitx_member_write_budget;
drop policy if exists fitx_media_insert_quota on storage.objects;
drop function if exists public.fitx_user_media_upload_allowed();
commit;
```

```sql
-- After undo 20261121100040: what is left. Expect: t, 1, 0, 0, f
select coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p where p.oid = to_regprocedure('public.get_activity_share(text)')), false) as visitors_call_share,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workout_sessions') as broadcast_tables,
  (select count(*) from pg_trigger where tgname in ('fitx_write_budget_insert', 'fitx_write_budget_update', 'programme_enrolments_published')) as triggers_left,
  (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'fitx_media_insert_quota') as photo_limit,
  to_regclass('public.fitx_member_write_budget') is not null as count_table;
```

```sql
-- Undo 20261121100036 (writes; then delete the food-media bucket in Dashboard → Storage)
begin;
drop function if exists public.fitx_admin_op_report(uuid, integer);
drop function if exists public.fitx_admin_op_save_billing_plan(uuid, text, jsonb);
drop function if exists public.fitx_admin_op_food_categories(uuid);
drop function if exists public.fitx_admin_op_rename_food_category(uuid, text, text);
drop function if exists public.fitx_admin_op_set_food_image(uuid, text, text, text, text);
drop function if exists public.fitx_admin_op_set_food_portions(uuid, text, jsonb);
drop function if exists public.fitx_admin_op_set_food_active(uuid, text, boolean);
drop function if exists public.fitx_admin_op_save_food(uuid, text, jsonb);
drop function if exists public.fitx_admin_op_training_counts(uuid);
drop function if exists public.fitx_admin_op_set_programme_status(uuid, text, text);
drop function if exists public.fitx_admin_op_remove_exercise_media(uuid, uuid);
drop function if exists public.fitx_admin_op_add_exercise_media(uuid, text, text, text, text, text, text, integer, integer);
drop function if exists public.fitx_admin_op_delete_exercise(uuid, text);
drop function if exists public.fitx_admin_op_save_exercise(uuid, text, jsonb);
drop function if exists public.fitx_admin_content_slug(text);
drop function if exists public.fitx_admin_content_text_array(jsonb);
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'exercise-media';
commit;
```

```sql
-- Before undo 20261121100033: Help requests filed as complaints. Expect: 0
select count(*) as complaints from public.support_requests where category = 'complaint';
```

```sql
-- Undo 20261121100033 (writes; drops platform settings and notices; complaint rows must be moved first)
begin;
drop trigger if exists support_messages_staff_seen on public.support_messages;
drop trigger if exists member_notifications_dismiss_guard on public.member_notifications;
drop function if exists public.fitx_admin_op_save_platform_settings(uuid, jsonb, jsonb, jsonb, timestamptz);
drop function if exists public.fitx_admin_op_send_notifications(uuid, uuid[], text, text, text, text, text);
drop function if exists public.fitx_admin_notification_history(integer);
drop function if exists public.fitx_admin_find_users_by_emails(text[]);
drop function if exists public.fitx_admin_op_support_mark_seen(uuid, uuid);
drop function if exists public.fitx_admin_support_inbox();
drop function if exists public.fitx_admin_search_users_v2(text, text, text, text, integer, integer);
drop function if exists public.fitx_admin_overview_extras();
drop function if exists public.fitx_admin_security_overview();
drop function if exists public.fitx_support_staff_seen();
drop function if exists public.fitx_member_notification_dismiss_guard();
drop table if exists public.member_notifications;
drop table if exists public.platform_settings;
drop index if exists public.support_requests_unread_idx;
alter table public.support_requests drop column if exists staff_unread;
alter table public.support_requests drop column if exists staff_seen_at;
alter table public.support_requests drop constraint if exists support_requests_category_check;
alter table public.support_requests add constraint support_requests_category_check check (category in ('question','problem','feedback','account','other'));
commit;
```

```sql
-- Undo 20261121100030 (writes; Admin then refuses every sign-in; undo #44 and #43 first)
begin;
drop function if exists public.fitx_admin_op_set_announcement_status(uuid, uuid, text);
drop function if exists public.fitx_admin_op_save_announcement(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, boolean);
drop function if exists public.fitx_admin_op_support_reply(uuid, uuid, text, text);
drop function if exists public.fitx_admin_op_support_update(uuid, uuid, text, text, uuid, timestamptz);
drop function if exists public.fitx_admin_op_revoke_user_sessions(uuid, uuid, text);
drop function if exists public.fitx_admin_op_set_exercise_active(uuid, text, boolean);
drop function if exists public.fitx_admin_op_set_operator_password(uuid, uuid, text, boolean);
drop function if exists public.fitx_admin_op_update_operator(uuid, uuid, text, boolean);
drop function if exists public.fitx_admin_op_create_operator(uuid, text, text, text);
drop function if exists public.fitx_admin_op_end_sessions(uuid, text);
drop function if exists public.fitx_admin_op_mark_signed_in(uuid);
drop function if exists public.fitx_admin_op_root_sign_in(text);
drop function if exists public.fitx_admin_login_record(text, text, boolean);
drop function if exists public.fitx_admin_login_check(text, text);
drop function if exists public.fitx_admin_login_locked_until(text, text);
drop function if exists public.fitx_admin_login_username_limits();
drop function if exists public.fitx_admin_login_username_key(text);
drop function if exists public.fitx_admin_login_limits();
drop function if exists public.fitx_admin_op_log_event(uuid, text, text, text, jsonb);
drop function if exists public.fitx_admin_op_can(uuid, text);
alter table public.announcements drop column if exists updated_by_operator_id, drop column if exists created_by_operator_id;
alter table public.support_messages drop column if exists author_operator_id;
alter table public.support_requests drop column if exists assigned_operator_id;
drop table if exists public.admin_login_attempts, public.admin_web_sessions, public.admin_operators;
create or replace function public.fitx_admin_role_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_role
    when 'super_admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'people.delete', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'audit.export', 'access.view', 'access.manage', 'settings.view', 'billing.view']::text[]
    when 'admin' then array['overview.view', 'reports.view', 'people.view', 'people.support', 'people.suspend', 'support.view', 'support.reply', 'content.manage', 'announcements.manage', 'audit.view', 'access.view', 'settings.view', 'billing.view']::text[]
    when 'support_agent' then array['overview.view', 'people.view', 'people.support', 'support.view', 'support.reply']::text[]
    when 'content_editor' then array['overview.view', 'content.manage', 'announcements.manage']::text[]
    when 'viewer' then array['overview.view', 'reports.view']::text[]
    else array[]::text[]
  end;
$function$;
commit;
```

```sql
-- After undo 20261121100030: what is left. Expect: 0, 16
select (select count(*) from pg_proc where proname like 'fitx_admin_op\_%' or proname like 'fitx_admin_login\_%') as left_over,
  cardinality(public.fitx_admin_role_permissions('super_admin')) as permissions_after_undo;
```

```sql
-- Undo 20261120100000 (writes; turns Maintain weight goals into General fitness)
begin;
update public.user_preferences set primary_goal = 'general_fitness' where primary_goal = 'maintain_weight';
alter table public.user_preferences drop constraint if exists user_preferences_primary_goal_check;
alter table public.user_preferences add constraint user_preferences_primary_goal_check
  check (primary_goal in ('muscle_gain', 'weight_gain', 'fat_loss', 'weight_loss', 'general_fitness', 'strength', 'endurance'));
alter table public.user_preferences drop constraint if exists user_preferences_food_source_check,
  drop constraint if exists user_preferences_nutrition_focus_check, drop column if exists food_source, drop column if exists nutrition_focus;
drop trigger if exists profiles_age_from_birth_date on public.profiles;
drop function if exists public.fitx_profiles_age_from_birth_date();
alter table public.profiles drop constraint if exists profiles_date_of_birth_check, drop column if exists date_of_birth;
commit;
```

```sql
-- Undo 20261119100010 (writes)
drop table if exists public.exercise_notes;
```

```sql
-- Undo 20261119100000 (writes; deletes imported activities)
begin;
delete from public.activities where source = 'file';
alter table public.activities drop constraint if exists activities_source_check, drop constraint if exists activities_source_format_check,
  drop constraint if exists activities_source_device_check, drop column if exists imported_at, drop column if exists source_device,
  drop column if exists source_format, drop column if exists source;
commit;
```

```sql
-- Undo 20261118200000 (writes)
update public.food_catalog set keywords = array_remove(array_remove(keywords, 'rajma'), 'rajmah')
where id in ('2707379', '2707380', '2707381', '2707382', '2644289', '2644290') and keywords && array['rajma', 'rajmah'];
```

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
-- Before undo 20261118140001: barcodes a member has on more than one custom food, archived ones included. Expect: 0
select count(*) as barcodes_on_two_foods from (
  select user_id, barcode from public.custom_foods where barcode is not null
  group by user_id, barcode having count(*) > 1) d;
```

If it is not 0, the undo below would stop and change nothing: experience 2.0's rule allows one food per barcode,
archived foods included. Tell the session; with your OK it first takes the barcode off the archived foods among
them:

```sql
-- Fix before undo 20261118140001 (writes; only when its Before undo query is not 0): archived foods give up a barcode another food has
update public.custom_foods f set barcode = null
where f.archived_at is not null and f.barcode is not null
  and exists (select 1 from public.custom_foods o where o.user_id = f.user_id and o.barcode = f.barcode and o.id <> f.id);
```

```sql
-- Undo 20261118140001 (writes; undo 20261118140002 and run its Before undo query first). Production: barcode stays, with experience 2.0's one food per barcode (section 1.8)
begin;
drop table if exists public.meal_template_items, public.meal_templates, public.nutrition_targets;
drop trigger if exists custom_foods_touch_updated_at on public.custom_foods;
drop trigger if exists meals_touch_updated_at on public.meals;
-- Dropping archived_at also drops #18's one active food per barcode (custom_foods_user_barcode_idx).
alter table public.custom_foods drop column if exists origin, drop column if exists value_basis,
  drop column if exists image_path, drop column if exists image_url, drop column if exists image_attribution,
  drop column if exists source_ref, drop column if exists archived_at;
create unique index if not exists custom_foods_user_barcode_unique on public.custom_foods (user_id, barcode)
  where barcode is not null;
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
-- Undo 20261115110000 (writes). Production: the fields and the live app's values stay (section 1.8)
begin;
alter table public.workout_plan_exercises drop constraint if exists workout_plan_exercises_target_weight_kg_check,
  drop constraint if exists workout_plan_exercises_target_duration_seconds_check;
alter table public.workout_session_exercises drop constraint if exists workout_session_exercises_target_weight_kg_check,
  drop constraint if exists workout_session_exercises_target_duration_seconds_check;
alter table public.workout_sets drop constraint if exists workout_sets_duration_seconds_check;
commit;
```

```sql
-- Undo 20261115100000 (writes). Production: paused_at stays, emptied (section 1.8)
begin;
alter table public.workout_sessions drop column if exists active_duration_seconds, drop column if exists resumed_at;
update public.workout_sessions set paused_at = null where paused_at is not null;
commit;
```

## 6. After the last file

### 6.1 Final checks

```sql
-- Final 1: public tables without row level security. Expect: no rows
select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity;
```

```sql
-- Final 2: tables with row level security but no policy. Expect exactly these thirteen, on purpose: admin_login_attempts, admin_operators, admin_web_sessions, ai_coach_limits, ai_coach_usage_events, billing_provider_events, billing_reconciliation_runs, fitx_admin_audit_logs, fitx_member_write_budget, fitx_rate_limits, social_challenge_templates, social_moderation_actions, social_storage_trash
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

Before #45 it listed experience 2.0's `get_activity_share`, which #45 locks down (section 1.8). Any row: tell the
session.

Then run Start 2 again: now it lists every object on its list (on 2026-11-25, after #55, its one row; on
2026-11-24, after #54, its three rows).

The thirteen tables in Final 2 are reached only by database functions or the server key, which is why they have
no policy (the last three, from #52, are Explore's challenge templates, moderation record and storage trash). Supabase Dashboard → Advisors → Security Advisor flags them as "RLS Enabled No Policy"; that is
expected. Tell the session about any other new finding.

### 6.2 Food search smoke test

Already done after #24 (section 3). If it did not show Idli first, tell the session; in section 2's order,
before the deploy. When the food parts wait (section 2.1), it runs after #24 on that later day, with the new app
already live: its food search keeps answering from its built-in list for every food the catalogue does not
return, so tell the session then.

### 6.3 Make the migration history match the files

The connector records each file under the time it ran, not under the file's number. The September files in
the repository already carry the numbers production recorded. The three changes of section 1.8 have their own
numbers and no file; the queries below leave their rows alone. One of them, the old Admin draft, has the same
name as #29, `fitx_admin_control_plane`, which is why they leave those three out. Give each new row its file's
number once, after the last file. It writes to the history table only. #1 to #55 already carry their numbers
(History 1 ran after each earlier sitting, the staged method recorded #42 to #54 under their own numbers, and on
2026-11-25 History 1 gave #55's row, which the connector had recorded under a time, its number), so run today it
changes no row. In a later sitting it changes only the rows of that sitting's files that the connector recorded
under a time, once their rows are added to its list.

```sql
-- History 0: files recorded twice. Expect: no rows
select name, string_agg(version, ', ' order by version) as versions
from supabase_migrations.schema_migrations
where version not in ('20261002172610', '20261002172706', '20261116093902')
group by name having count(*) > 1;
```

If it lists a file, tell the session before History 1: it removes that file's newer row (writes one row), then runs
History 1.

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
  ('20261118180006', 'fitx_announcements'), ('20261118190000', 'fitx_billing_razorpay'),
  ('20261118200000', 'fitx_food_catalog_rajma_keywords'), ('20261119100000', 'fitx_activity_sources'),
  ('20261119100010', 'fitx_exercise_notes'), ('20261119100020', 'fitx_exercise_favorites'),
  ('20261120100000', 'fitx_onboarding_v3'), ('20261121100030', 'fitx_admin_v2'),
  ('20261121100033', 'fitx_admin_ops'), ('20261121100036', 'fitx_admin_content'),
  ('20261121100040', 'fitx_security_hardening'), ('20261123100000', 'fitx_shell_prefs'),
  ('20261123100010', 'fitx_onboarding_v4'), ('20261123100020', 'fitx_workout_setup'),
  ('20261123100040', 'fitx_nutrition_v2'), ('20261123100050', 'fitx_coach_activity_v2'),
  ('20261123100060', 'fitx_social_v1'), ('20261124100000', 'fitx_social_v2_core'),
  ('20261124100010', 'fitx_social_v2_groups'), ('20261124100020', 'fitx_admin_explore'),
  ('20261125100000', 'fitx_social_reports_column_privileges')
) as f (version, name)
where h.name = f.name and h.version <> f.version
  and h.version not in ('20261002172610', '20261002172706', '20261116093902')
  and not exists (select 1 from supabase_migrations.schema_migrations x where x.version = f.version);
```

```sql
-- History 2: expect 72 rows in version order: the 14 September ones, the three of section 1.8 and the 55 files of section 2, with their numbers and names
select version, name from supabase_migrations.schema_migrations order by version;
```

In version order the old Admin draft's row, `20261116093902 fitx_admin_control_plane`, comes between #2 and #3,
and #29 further down has the same name: both rows belong there. If a row still has a time instead of its file's
number, or a file is missing, tell the session: it compares the history with section 2 and fixes the rows one at
a time, with your OK.

This runbook does not use the Supabase CLI. Do not use it until section 1.8 is settled and History 1 has run:
until then `supabase db push` would stop at history rows that have no file in `supabase/migrations`, the three of
section 1.8 and, before History 1, the times the connector recorded. That is from the CLI's documentation, not
tried here.

### 6.4 Deploy the new app

Set the variables in section 7 first. Then ship the new app (the redesign, `claude/redesign` merged into
`master`) to production as planned. If the food parts wait (section 2.1), deploy after #36 and apply #20 to #24 and #37 afterwards. Both Vercel projects build from the same repository: the FITX site (`fitnessx`) and Admin
(`admin`). If Admin's build is skipped because of its path filter, redeploy it as in `admin/README.md`,
"Automatic deployments and path filters". Apply #42 to #44 before Admin is redeployed: without #42, Admin refuses
every sign-in. For the "next level" wave 1, apply #46 to #51 first, then deploy `claude/next` merged into `master`; the
app checks for each of them and works without the ones not applied yet (both done on 2026-11-23). For wave 2, apply #52, #53 and #54 before
deploying `claude/next2` (release 2a) and Admin; wave 1's app and Admin keep working with them in place (both done
on 2026-11-24). #55 needed no deploy (applied on 2026-11-25), and release 2c needs nothing from it; the app and
Admin work the same with and without it.

### 6.5 First super-admin

Admin no longer uses Google or the team list of #29 to sign in. After #42 and the Admin variables of section 7
(`FITX_ADMIN_USERNAME`, `FITX_ADMIN_PASSWORD_HASH`), redeploy Admin and sign in at `/login` with that username and your
password: you are the root operator, always a super-admin, and your operator row is made at that first sign-in (Check
20261121100030's last value becomes 1). Add other operators in Admin and security, Access control. `admin/README.md`
→ "Owner checklist" has every step in order, including what to do if sign-in does not work.

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
| AI coach, "next level" wave 1 | `fitnessx` | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; optional `CEREBRAS_API_KEY`, `MISTRAL_API_KEY` | Workers AI needs both Cloudflare values. Like Gemini, Cerebras and Mistral get only questions without the member's data unless `AI_CEREBRAS_WITH_MEMBER_DATA` or `AI_MISTRAL_WITH_MEMBER_DATA` is set; leave those unset unless you accept their free tiers' terms. `docs/runbooks/ai-coach.md` has the details. |
| Google sign-in name, "next level" wave 1 | `fitnessx` | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Cloud: add `https://fitnessx.vercel.app` as an authorised JavaScript origin of the OAuth client; Supabase → Authentication → Google: add the client ID to the authorised client IDs. Until it is set, Google sign-in uses the redirect as before. `docs/runbooks/google-sign-in.md` has the steps. |
| Activity (#26, #27) | Supabase | Switch on pg_cron | Before #27 (section 3, #27). No variables needed. Optional: `NEXT_PUBLIC_ACTIVITY_MAP_STYLE_LIGHT` and `_DARK` replace the free OpenFreeMap maps. |
| Exercise photos (#13), optional later | this Mac | `scripts/catalog/mirror-media.mjs` | Copies the photos into the `exercise-media` bucket so they stop loading from GitHub. You run it with the secret key in your own Terminal; see the script's header. |
| Admin (#29 to #35, #42 to #44) | `admin` | Domain `fitnessx-admin.vercel.app` | Vercel → admin project → Settings → Domains → Add, for Production. If the name is taken, pick another free `.vercel.app` name and use it everywhere below. |
| Admin | `admin` | `ADMIN_SITE_URL` | `https://fitnessx-admin.vercel.app` (it replaces `https://admin-one-blond.vercel.app`). |
| Admin | `admin` | `SUPABASE_SECRET_KEY` | The same kind of key as above; you can create a separate one named `fitx-admin`. Sensitive, Production only. |
| Admin (#42) | `admin` | `FITX_ADMIN_USERNAME` | The root operator's username, in lower case. Production only. |
| Admin (#42) | `admin` | `FITX_ADMIN_PASSWORD_HASH` | The single `scrypt:` line that `cd admin && npm run admin:hash` prints on your own computer after you type the password twice. Never the password itself. Sensitive, Production only. A new hash ends every open Admin session. |
| Admin (#42) | `admin` | Delete `FITX_ADMIN_ALLOWED_EMAILS` | No longer read: Admin signs in with a username and password. |
| Admin | `admin` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Check they are already there. |
| Admin, optional | Supabase | Sign-in settings | Admin no longer signs in through Supabase: you may remove `https://fitnessx-admin.vercel.app/auth/callback` from Authentication → URL Configuration → Redirect URLs. Google sign-in stays on for the FITX app. |
| Admin, optional | `admin` | `FITX_ADMIN_PASSWORD_RESET_EMAILS` | `on` only after the "Password reset emails" steps in `admin/README.md`. |
| Email code sign-in (no migration), before the redesign deploy | Supabase | Email templates | Authentication → Emails → Templates. In both "Magic link" and "Confirm signup", add the code, for example `<p>Your FITX code: <strong>{{ .Token }}</strong></p>`, and keep `{{ .ConfirmationURL }}` as a fallback link. A new address gets "Confirm signup" while "Confirm email" is on, so editing only "Magic link" leaves new members with a link and no code. Test with a new address and an existing one. |
| Email code sign-in | Supabase | Email OTP length | Authentication → Sign In / Providers → Email: Email OTP length `6` (the code screen has six boxes; any other length always fails). Leave the expiry at 1 hour or less. |
| Email code sign-in | Supabase | Custom SMTP and email rate limit | Authentication → Emails → SMTP Settings. Supabase's built-in sender delivers only to your team's addresses and a few emails an hour, so members outside the team get nothing. Set up an SMTP provider you choose (a free tier is enough to start), then raise "Rate limit for sending emails" under Authentication → Rate Limits. |
| Premium subscriptions (#36), later | `fitnessx` | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CRON_SECRET`, `BILLING_TEST_EMAILS` | Only after your billing decisions, the Razorpay account and test mode. Follow `docs/runbooks/billing-razorpay.md`, which also adds the nightly check to `vercel.json`. |

Already set and unchanged: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the older
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and `NEXT_PUBLIC_SITE_URL` on `fitnessx`.

`admin/README.md` → "Owner checklist" has every Admin step in order, including what to do if sign-in does not
work.
