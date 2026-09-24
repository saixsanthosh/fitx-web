-- Cover the new owner-scoped foreign keys with indexes in their FK column order.
create index if not exists goal_progress_entries_goal_owner_idx
  on public.goal_progress_entries (goal_id, user_id);
create index if not exists personal_records_session_owner_idx
  on public.personal_records (session_id, user_id);
create index if not exists planner_events_plan_owner_idx
  on public.planner_events (workout_plan_id, user_id);
create index if not exists workout_plan_exercises_plan_owner_idx
  on public.workout_plan_exercises (plan_id, user_id);
create index if not exists workout_plan_exercises_exercise_idx
  on public.workout_plan_exercises (exercise_id);
create index if not exists workout_session_exercises_session_owner_idx
  on public.workout_session_exercises (session_id, user_id);
create index if not exists workout_session_exercises_exercise_idx
  on public.workout_session_exercises (exercise_id);
create index if not exists workout_sessions_plan_owner_idx
  on public.workout_sessions (plan_id, user_id);
create index if not exists workout_sets_session_exercise_owner_idx
  on public.workout_sets (session_exercise_id, user_id);
