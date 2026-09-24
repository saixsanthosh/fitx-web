alter table public.user_preferences
  add column if not exists daily_water_goal_ml integer not null default 2500
  check (daily_water_goal_ml between 250 and 10000);
