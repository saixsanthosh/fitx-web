-- Add durable pause timing to existing workout sessions.
-- Existing session status and RLS ownership policies are unchanged.
alter table public.workout_sessions
  add column if not exists active_duration_seconds integer not null default 0
    check (active_duration_seconds >= 0),
  add column if not exists resumed_at timestamptz,
  add column if not exists paused_at timestamptz;

comment on column public.workout_sessions.active_duration_seconds is
  'Accumulated active training time, excluding periods while the session is paused.';
comment on column public.workout_sessions.resumed_at is
  'Start timestamp for the current active segment; null while paused.';
comment on column public.workout_sessions.paused_at is
  'Timestamp when the user paused the session; null while active.';
