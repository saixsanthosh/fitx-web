-- FITX V1 core product data. Additive migration; existing account and log data is retained.

-- User-owned training and nutrition preferences.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workout_location text not null default 'gym' check (workout_location in ('gym', 'home', 'both', 'outdoor')),
  equipment text[] not null default array['bodyweight']::text[],
  fitness_level text not null default 'beginner' check (fitness_level in ('beginner', 'intermediate', 'advanced')),
  primary_goal text not null default 'general_fitness' check (primary_goal in ('muscle_gain', 'fat_loss', 'strength', 'general_fitness', 'endurance')),
  workouts_per_week smallint not null default 3 check (workouts_per_week between 1 and 7),
  session_duration_minutes smallint not null default 45 check (session_duration_minutes between 15 and 180),
  workout_split text not null default 'full_body' check (workout_split in ('full_body', 'upper_lower', 'push_pull_legs', 'custom')),
  activity_level text not null default 'moderate' check (activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  dietary_preferences text[] not null default '{}'::text[],
  allergies text[] not null default '{}'::text[],
  meals_per_day smallint not null default 3 check (meals_per_day between 1 and 8),
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

-- Public, read-only exercise catalog. No personal performance data is stored here.
create table if not exists public.exercise_library (
  id text primary key,
  name text not null unique,
  description text not null default '',
  primary_muscle text not null,
  secondary_muscles text[] not null default '{}'::text[],
  equipment text[] not null default '{}'::text[],
  locations text[] not null default array['gym', 'home']::text[],
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  movement_pattern text not null,
  instructions text[] not null default '{}'::text[],
  recommended_sets smallint not null default 3 check (recommended_sets between 1 and 10),
  reps_min smallint not null default 8 check (reps_min between 1 and 100),
  reps_max smallint not null default 12 check (reps_max between reps_min and 100),
  rest_seconds smallint not null default 90 check (rest_seconds between 15 and 600),
  alternatives text[] not null default '{}'::text[],
  attribution text not null default 'FITX exercise reference',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- User-created plans can be edited before or after scheduling.
create table if not exists public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  split text not null default 'custom',
  workout_location text not null default 'gym' check (workout_location in ('gym', 'home', 'both', 'outdoor')),
  planned_for date,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists workout_plans_user_date_idx on public.workout_plans (user_id, planned_for desc);

create table if not exists public.workout_plan_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  exercise_id text references public.exercise_library(id) on delete set null,
  exercise_name text not null,
  sort_order smallint not null check (sort_order between 0 and 99),
  target_sets smallint not null default 3 check (target_sets between 1 and 10),
  reps_min smallint not null default 8 check (reps_min between 1 and 100),
  reps_max smallint not null default 12 check (reps_max between reps_min and 100),
  rest_seconds smallint not null default 90 check (rest_seconds between 15 and 600),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (plan_id, user_id) references public.workout_plans(id, user_id) on delete cascade,
  unique (plan_id, sort_order),
  unique (id, user_id)
);
create index if not exists workout_plan_exercises_user_plan_idx on public.workout_plan_exercises (user_id, plan_id, sort_order);

-- An active workout has a durable server-side session and individually recorded sets.
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  total_volume numeric(12,2) not null default 0 check (total_volume >= 0),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (plan_id, user_id) references public.workout_plans(id, user_id) on delete set null (plan_id),
  unique (id, user_id)
);
create index if not exists workout_sessions_user_started_idx on public.workout_sessions (user_id, started_at desc);
create index if not exists workout_sessions_user_status_idx on public.workout_sessions (user_id, status, started_at desc);

create table if not exists public.workout_session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  exercise_id text references public.exercise_library(id) on delete set null,
  exercise_name text not null,
  sort_order smallint not null check (sort_order between 0 and 99),
  target_sets smallint not null default 3 check (target_sets between 1 and 10),
  reps_min smallint not null default 8 check (reps_min between 1 and 100),
  reps_max smallint not null default 12 check (reps_max between reps_min and 100),
  rest_seconds smallint not null default 90 check (rest_seconds between 15 and 600),
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.workout_sessions(id, user_id) on delete cascade,
  unique (session_id, sort_order),
  unique (id, user_id)
);
create index if not exists workout_session_exercises_session_idx on public.workout_session_exercises (user_id, session_id, sort_order);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_exercise_id uuid not null,
  set_number smallint not null check (set_number between 1 and 30),
  target_reps smallint,
  reps smallint check (reps between 0 and 500),
  weight_kg numeric(8,2) not null default 0 check (weight_kg between 0 and 2000),
  rpe numeric(3,1) check (rpe between 1 and 10),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (session_exercise_id, user_id) references public.workout_session_exercises(id, user_id) on delete cascade,
  unique (session_exercise_id, set_number)
);
create index if not exists workout_sets_user_created_idx on public.workout_sets (user_id, created_at desc);

create table if not exists public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text,
  exercise_name text not null,
  best_weight_kg numeric(8,2) not null default 0 check (best_weight_kg >= 0),
  best_reps smallint not null default 1 check (best_reps between 1 and 500),
  estimated_one_rep_max numeric(8,2) not null default 0 check (estimated_one_rep_max >= 0),
  achieved_at timestamptz not null default now(),
  session_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, exercise_name),
  foreign key (session_id, user_id) references public.workout_sessions(id, user_id) on delete set null (session_id)
);
create index if not exists personal_records_user_date_idx on public.personal_records (user_id, achieved_at desc);

-- Meals continue to use the existing table and retain a snapshot of nutrients at log time.
alter table public.meals
  add column if not exists source text not null default 'manual',
  add column if not exists provider_id text,
  add column if not exists quantity_grams numeric(9,2) check (quantity_grams is null or quantity_grams > 0),
  add column if not exists nutrition_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.custom_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  brand text,
  serving_size text not null default '100 g',
  serving_grams numeric(8,2) not null default 100 check (serving_grams > 0),
  calories_per_100g numeric(8,2) not null default 0 check (calories_per_100g >= 0),
  protein_per_100g numeric(8,2) not null default 0 check (protein_per_100g >= 0),
  carbs_per_100g numeric(8,2) not null default 0 check (carbs_per_100g >= 0),
  fat_per_100g numeric(8,2) not null default 0 check (fat_per_100g >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists custom_foods_user_name_idx on public.custom_foods (user_id, lower(name));

create table if not exists public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_ml smallint not null check (amount_ml between 1 and 3000),
  logged_at timestamptz not null default now(),
  local_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists water_logs_user_date_idx on public.water_logs (user_id, local_date desc);

alter table public.body_metrics
  add column if not exists measurements jsonb not null default '{}'::jsonb;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  category text not null default 'fitness' check (category in ('fitness', 'nutrition', 'body', 'consistency', 'personal')),
  metric text not null default 'manual',
  target_value numeric(12,2) not null check (target_value > 0),
  current_value numeric(12,2) not null default 0 check (current_value >= 0),
  unit text not null default '',
  starts_on date not null default current_date,
  due_on date,
  status text not null default 'active' check (status in ('active', 'completed', 'paused', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on is null or due_on >= starts_on),
  unique (id, user_id)
);
create index if not exists goals_user_status_due_idx on public.goals (user_id, status, due_on);

create table if not exists public.goal_progress_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.goals(id, user_id) on delete cascade
);
create index if not exists goal_progress_user_goal_date_idx on public.goal_progress_entries (user_id, goal_id, logged_at desc);

create table if not exists public.planner_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null default 'workout' check (event_type in ('workout', 'meal', 'rest', 'goal', 'other')),
  title text not null check (char_length(title) between 1 and 120),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  workout_plan_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workout_plan_id, user_id) references public.workout_plans(id, user_id) on delete set null (workout_plan_id),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists planner_events_user_start_idx on public.planner_events (user_id, starts_at);

-- Make existing per-user policies explicit and avoid per-row auth.uid() reevaluation.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists workouts_owner on public.workouts;
create policy workouts_owner on public.workouts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists meals_owner on public.meals;
create policy meals_owner on public.meals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists tasks_owner on public.tasks;
create policy tasks_owner on public.tasks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists habits_owner on public.habits;
create policy habits_owner on public.habits for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists body_metrics_owner on public.body_metrics;
create policy body_metrics_owner on public.body_metrics for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Add the ownership policies and explicit grants for all new data tables.
alter table public.user_preferences enable row level security;
alter table public.exercise_library enable row level security;
alter table public.workout_plans enable row level security;
alter table public.workout_plan_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_session_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.personal_records enable row level security;
alter table public.custom_foods enable row level security;
alter table public.water_logs enable row level security;
alter table public.goals enable row level security;
alter table public.goal_progress_entries enable row level security;
alter table public.planner_events enable row level security;

create policy user_preferences_owner on public.user_preferences for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy exercise_library_read on public.exercise_library for select to anon, authenticated using (is_active);
create policy workout_plans_owner on public.workout_plans for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy workout_plan_exercises_owner on public.workout_plan_exercises for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy workout_sessions_owner on public.workout_sessions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy workout_session_exercises_owner on public.workout_session_exercises for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy workout_sets_owner on public.workout_sets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy personal_records_owner on public.personal_records for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy custom_foods_owner on public.custom_foods for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy water_logs_owner on public.water_logs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy goals_owner on public.goals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy goal_progress_entries_owner on public.goal_progress_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy planner_events_owner on public.planner_events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select on public.exercise_library to anon, authenticated;
grant select, insert, update, delete on public.user_preferences, public.workout_plans,
  public.workout_plan_exercises, public.workout_sessions, public.workout_session_exercises,
  public.workout_sets, public.personal_records, public.custom_foods, public.water_logs,
  public.goals, public.goal_progress_entries, public.planner_events to authenticated;
grant select, insert, update, delete on public.meals, public.body_metrics to authenticated;

-- A private bucket for profile and progress images. Files are owned by the UID folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fitx-user-media', 'fitx-user-media', false, 10485760, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[];

drop policy if exists fitx_media_select_own on storage.objects;
create policy fitx_media_select_own on storage.objects for select to authenticated
  using (bucket_id = 'fitx-user-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists fitx_media_insert_own on storage.objects;
create policy fitx_media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'fitx-user-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists fitx_media_update_own on storage.objects;
create policy fitx_media_update_own on storage.objects for update to authenticated
  using (bucket_id = 'fitx-user-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'fitx-user-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists fitx_media_delete_own on storage.objects;
create policy fitx_media_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'fitx-user-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Seed an expandable starter catalog; rows contain exercise guidance, never user results.
insert into public.exercise_library
  (id, name, description, primary_muscle, secondary_muscles, equipment, locations, difficulty, movement_pattern, instructions, recommended_sets, reps_min, reps_max, rest_seconds, alternatives)
values
('bench_press','Barbell Bench Press','Press a bar from the chest while keeping the shoulder blades stable.','chest',array['triceps','front_deltoids'],array['barbell','bench'],array['gym'],'intermediate','horizontal_push',array['Set the bench and secure your feet.','Lower the bar under control to the mid chest.','Press up without bouncing or losing shoulder position.'],3,6,10,150,array['dumbbell_bench_press','push_up']),
('dumbbell_bench_press','Dumbbell Bench Press','Press dumbbells from chest level on a flat bench.','chest',array['triceps','front_deltoids'],array['dumbbell','bench'],array['gym','home'],'beginner','horizontal_push',array['Lie on a flat bench with dumbbells above the chest.','Lower with elbows at a comfortable angle.','Press up and keep both sides controlled.'],3,8,12,120,array['push_up','bench_press']),
('push_up','Push-Up','A bodyweight horizontal press with a braced, straight body position.','chest',array['triceps','front_deltoids','core'],array['bodyweight'],array['gym','home','outdoor'],'beginner','horizontal_push',array['Start in a high plank with hands under shoulders.','Lower your chest while keeping your body in one line.','Press the floor away to return.'],3,8,15,90,array['dumbbell_bench_press','incline_push_up']),
('incline_dumbbell_press','Incline Dumbbell Press','Press on a shallow incline to train the upper chest.','chest',array['triceps','front_deltoids'],array['dumbbell','bench'],array['gym','home'],'beginner','horizontal_push',array['Set a low incline and brace your upper back.','Lower dumbbells beside the upper chest.','Press up without letting the weights collide.'],3,8,12,120,array['bench_press','push_up']),
('cable_fly','Cable Fly','Bring cable handles together through a controlled chest arc.','chest',array['front_deltoids'],array['cable'],array['gym'],'beginner','horizontal_adduction',array['Set handles around chest height.','Keep a soft elbow bend and bring hands together.','Return slowly to a comfortable stretch.'],3,10,15,75,array['dumbbell_fly','push_up']),
('lat_pulldown','Lat Pulldown','Pull a cable bar to the upper chest while keeping the torso steady.','back',array['biceps','rear_deltoids'],array['cable','machine'],array['gym'],'beginner','vertical_pull',array['Secure the thighs and take a comfortable overhand grip.','Pull toward the upper chest with elbows down.','Return the bar with control.'],3,8,12,120,array['assisted_pull_up','band_lat_pulldown']),
('pull_up','Pull-Up','Pull the body toward a fixed bar using a controlled vertical pull.','back',array['biceps','core'],array['pull_up_bar'],array['gym','home','outdoor'],'intermediate','vertical_pull',array['Grip the bar and start from a controlled hang.','Pull until the chin clears the bar without swinging.','Lower to the start position with control.'],3,4,10,150,array['lat_pulldown','band_lat_pulldown']),
('one_arm_dumbbell_row','One-Arm Dumbbell Row','Row one dumbbell toward the hip while bracing with the other hand.','back',array['biceps','rear_deltoids'],array['dumbbell','bench'],array['gym','home'],'beginner','horizontal_pull',array['Support one hand on a bench and keep the back neutral.','Pull the dumbbell toward the hip.','Lower slowly and repeat on the other side.'],3,8,12,90,array['cable_row','barbell_row']),
('barbell_row','Barbell Row','Row a bar toward the lower chest from a stable hip hinge.','back',array['biceps','rear_deltoids','core'],array['barbell'],array['gym'],'intermediate','horizontal_pull',array['Hinge with a neutral spine and soft knees.','Pull the bar toward the lower ribs.','Lower without changing your torso position.'],3,6,10,150,array['one_arm_dumbbell_row','cable_row']),
('seated_cable_row','Seated Cable Row','Pull a cable handle toward the torso with a steady trunk.','back',array['biceps','rear_deltoids'],array['cable','machine'],array['gym'],'beginner','horizontal_pull',array['Sit tall with knees softly bent.','Pull the handle toward the lower ribs.','Reach forward under control without rounding the back.'],3,8,12,120,array['one_arm_dumbbell_row','barbell_row']),
('goblet_squat','Goblet Squat','Squat while holding one weight close to the chest.','quadriceps',array['glutes','core'],array['dumbbell','kettlebell'],array['gym','home'],'beginner','squat',array['Hold the weight close to the chest.','Sit between the hips with knees following the toes.','Stand through the whole foot.'],3,8,12,120,array['bodyweight_squat','leg_press']),
('bodyweight_squat','Bodyweight Squat','A bodyweight squat using a comfortable, controlled range.','quadriceps',array['glutes','core'],array['bodyweight'],array['gym','home','outdoor'],'beginner','squat',array['Stand with feet around shoulder width.','Sit down and keep the chest comfortably upright.','Stand and fully regain balance.'],3,10,20,75,array['goblet_squat','split_squat']),
('barbell_back_squat','Barbell Back Squat','Squat with a bar supported across the upper back.','quadriceps',array['glutes','hamstrings','core'],array['barbell','rack'],array['gym'],'intermediate','squat',array['Set the bar securely on the upper back.','Brace and squat to a depth you can control.','Drive up while keeping knees aligned with toes.'],3,5,8,180,array['goblet_squat','leg_press']),
('split_squat','Split Squat','Train each leg in a staggered stance using bodyweight or dumbbells.','quadriceps',array['glutes','core'],array['bodyweight'],array['gym','home','outdoor'],'beginner','single_leg_squat',array['Stand in a stable split stance.','Lower the back knee toward the floor.','Drive through the front foot and switch sides.'],3,8,12,90,array['goblet_squat','step_up']),
('romanian_deadlift','Romanian Deadlift','Hinge at the hips while lowering a bar or dumbbells along the legs.','hamstrings',array['glutes','back'],array['barbell'],array['gym'],'intermediate','hinge',array['Hold the weight against the thighs.','Push the hips back with a small knee bend.','Stand by bringing the hips forward while keeping the weight close.'],3,6,10,150,array['dumbbell_rdl','glute_bridge']),
('dumbbell_rdl','Dumbbell Romanian Deadlift','A hip hinge performed with dumbbells and a controlled stretch.','hamstrings',array['glutes','back'],array['dumbbell'],array['gym','home'],'beginner','hinge',array['Hold dumbbells in front of the thighs.','Push the hips back and lower to a comfortable stretch.','Stand tall without leaning back.'],3,8,12,120,array['romanian_deadlift','glute_bridge']),
('glute_bridge','Glute Bridge','Raise the hips from the floor with a controlled glute contraction.','glutes',array['hamstrings','core'],array['bodyweight'],array['gym','home'],'beginner','hip_extension',array['Lie down with knees bent and feet flat.','Brace and lift the hips until the torso and thighs align.','Lower slowly without arching the lower back.'],3,10,15,75,array['dumbbell_rdl','hip_thrust']),
('hip_thrust','Hip Thrust','Extend the hips with the upper back supported by a bench.','glutes',array['hamstrings','core'],array['barbell','bench'],array['gym'],'intermediate','hip_extension',array['Support the upper back on a bench.','Lower hips under control.','Drive through the feet and finish with a neutral trunk.'],3,8,12,120,array['glute_bridge','split_squat']),
('dumbbell_shoulder_press','Dumbbell Shoulder Press','Press dumbbells overhead from shoulder height.','shoulders',array['triceps','upper_chest'],array['dumbbell'],array['gym','home'],'beginner','vertical_push',array['Start with dumbbells near shoulder height.','Brace and press overhead in a comfortable path.','Lower slowly back to the shoulders.'],3,8,12,120,array['pike_push_up','machine_shoulder_press']),
('lateral_raise','Dumbbell Lateral Raise','Raise dumbbells out to the sides with light, controlled motion.','shoulders',array['traps'],array['dumbbell'],array['gym','home'],'beginner','shoulder_abduction',array['Stand tall with light dumbbells.','Raise arms to a comfortable height with soft elbows.','Lower slowly without swinging.'],3,10,15,75,array['band_lateral_raise','cable_lateral_raise']),
('band_lateral_raise','Band Lateral Raise','Raise the arms out to the sides against resistance bands.','shoulders',array['traps'],array['bands'],array['home','outdoor'],'beginner','shoulder_abduction',array['Stand on the center of the band.','Raise the arms with a soft bend in the elbows.','Return slowly.'],3,12,20,60,array['lateral_raise','pike_push_up']),
('biceps_curl','Dumbbell Biceps Curl','Curl dumbbells without swinging the torso.','biceps',array['forearms'],array['dumbbell'],array['gym','home'],'beginner','elbow_flexion',array['Stand tall with arms by the sides.','Curl the weights while keeping elbows near the torso.','Lower slowly to the start.'],3,8,15,75,array['band_curl','cable_curl']),
('triceps_extension','Dumbbell Overhead Triceps Extension','Extend the elbows with a dumbbell held overhead.','triceps',array['shoulders'],array['dumbbell'],array['gym','home'],'beginner','elbow_extension',array['Hold one dumbbell overhead with both hands.','Bend the elbows to lower behind the head.','Straighten the arms without flaring the ribs.'],3,8,15,75,array['close_grip_push_up','band_pressdown']),
('plank','Front Plank','Hold a stable forearm plank with the body in a straight line.','core',array['shoulders','glutes'],array['bodyweight'],array['gym','home','outdoor'],'beginner','anti_extension',array['Place elbows below shoulders.','Brace the abdomen and glutes.','Hold without letting the hips sag or rise.'],3,20,60,60,array['dead_bug','side_plank']),
('dead_bug','Dead Bug','Control opposite arm and leg movement while bracing the trunk.','core',array['hip_flexors'],array['bodyweight'],array['gym','home'],'beginner','anti_extension',array['Lie on your back with arms raised and knees bent.','Brace and lower opposite arm and leg slowly.','Return and alternate sides while keeping the back controlled.'],3,6,12,60,array['plank','bird_dog']),
('walking_lunge','Walking Lunge','Move forward through alternating controlled lunges.','quadriceps',array['glutes','hamstrings','core'],array['bodyweight'],array['gym','home','outdoor'],'beginner','locomotion',array['Stand tall with enough room to step.','Step forward and lower under control.','Push through the front foot and alternate sides.'],3,8,14,90,array['split_squat','step_up']),
('step_up','Step-Up','Step onto a stable platform one leg at a time.','quadriceps',array['glutes','hamstrings'],array['bodyweight','bench'],array['gym','home','outdoor'],'beginner','single_leg_squat',array['Use a stable low step or bench.','Place the full foot on the platform and stand up.','Step down carefully and alternate sides.'],3,8,12,90,array['split_squat','walking_lunge']),
('band_row','Resistance Band Row','Row a resistance band toward the torso from a stable anchor.','back',array['biceps','rear_deltoids'],array['bands'],array['home','outdoor'],'beginner','horizontal_pull',array['Anchor the band at chest height.','Pull elbows back while keeping shoulders relaxed.','Return slowly without losing posture.'],3,10,18,75,array['one_arm_dumbbell_row','seated_cable_row']),
('jumping_jack','Jumping Jack','A low-equipment cardiovascular movement with a scalable pace.','cardio',array['calves','shoulders'],array['bodyweight'],array['gym','home','outdoor'],'beginner','cardio',array['Start standing with arms by the sides.','Step or jump feet out while raising arms.','Return to the start at a pace you can control.'],3,20,40,60,array['march_in_place','step_up']),
('calf_raise','Standing Calf Raise','Raise the heels through a comfortable range of motion.','calves',array['ankles'],array['bodyweight'],array['gym','home','outdoor'],'beginner','plantar_flexion',array['Stand with feet hip-width and hold support if needed.','Rise onto the balls of the feet.','Lower the heels slowly.'],3,10,20,60,array['single_leg_calf_raise','step_up'])
on conflict (id) do update set name = excluded.name, description = excluded.description,
  primary_muscle = excluded.primary_muscle, secondary_muscles = excluded.secondary_muscles,
  equipment = excluded.equipment, locations = excluded.locations, difficulty = excluded.difficulty,
  movement_pattern = excluded.movement_pattern, instructions = excluded.instructions,
  recommended_sets = excluded.recommended_sets, reps_min = excluded.reps_min,
  reps_max = excluded.reps_max, rest_seconds = excluded.rest_seconds,
  alternatives = excluded.alternatives, is_active = true;

-- Realtime updates are limited to a user's active training sessions.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workout_sessions'
     ) then
    alter publication supabase_realtime add table public.workout_sessions;
  end if;
end $$;
