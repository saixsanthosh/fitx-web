-- FITX Workouts v2 (4 of 6): training programmes and enrolments.
-- A programme is a repeating sequence of days; each day is a list of slots (what to train and how),
-- which the app fills with exercises the user can do. Enrolling schedules the coming week's days as
-- dated workout plans linked to the enrolment; finishing one moves the enrolment to the next day.
-- The authored programmes are seeded by 20261118130040 (generated from src/data/programmes).
-- Additive only.

create table if not exists public.training_programmes (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  title text not null check (char_length(title) between 1 and 120),
  summary text not null default '',
  context text not null check (context in ('home', 'gym')),
  split text not null check (char_length(split) between 1 and 40),
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  days_per_week smallint not null check (days_per_week between 1 and 7),
  default_weekdays smallint[] not null default '{}'::smallint[],
  session_minutes smallint not null default 60 check (session_minutes between 10 and 240),
  built_around text[] not null default '{}'::text[],
  is_premium boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published')),
  source_notes text not null default '',
  reviewed_by text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.training_programmes.is_premium is 'Gated once subscriptions exist (Phase 11); every authored programme is free.';
comment on column public.training_programmes.reviewed_by is 'Coach or physiotherapist who reviewed the programme; null until reviewed.';

create table if not exists public.training_programme_days (
  programme_id text not null references public.training_programmes (id) on delete cascade,
  day_index smallint not null check (day_index between 0 and 13),
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  title text not null check (char_length(title) between 1 and 80),
  focus text[] not null default '{}'::text[],
  slots jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 12),
  primary key (programme_id, day_index),
  unique (programme_id, key)
);
comment on column public.training_programme_days.slots is 'Slot objects as in src/lib/training/generator.ts SlotSpec.';

alter table public.training_programmes enable row level security;
alter table public.training_programme_days enable row level security;
drop policy if exists training_programmes_read on public.training_programmes;
create policy training_programmes_read on public.training_programmes for select to anon, authenticated
  using (status = 'published');
drop policy if exists training_programme_days_read on public.training_programme_days;
create policy training_programme_days_read on public.training_programme_days for select to anon, authenticated
  using (exists (select 1 from public.training_programmes p where p.id = training_programme_days.programme_id and p.status = 'published'));
grant select on public.training_programmes, public.training_programme_days to anon, authenticated;

create table if not exists public.programme_enrolments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  programme_id text not null references public.training_programmes (id) on delete restrict,
  context text not null check (context in ('home', 'gym')),
  status text not null default 'active' check (status in ('active', 'paused', 'left', 'completed')),
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  preferred_time time not null default '18:00',
  next_day_index smallint not null default 0 check (next_day_index between 0 and 13),
  sessions_completed integer not null default 0 check (sessions_completed >= 0),
  started_on date not null default current_date,
  last_session_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index if not exists programme_enrolments_one_active on public.programme_enrolments (user_id) where status = 'active';
create index if not exists programme_enrolments_programme_idx on public.programme_enrolments (programme_id);

alter table public.programme_enrolments enable row level security;
drop policy if exists programme_enrolments_owner on public.programme_enrolments;
create policy programme_enrolments_owner on public.programme_enrolments for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.programme_enrolments to authenticated;

-- Programme days become ordinary dated plans, so starting, logging and history work unchanged.
alter table public.workout_plans
  add column if not exists programme_enrolment_id uuid,
  add column if not exists programme_day_index smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workout_plans_programme_enrolment_fkey') then
    alter table public.workout_plans add constraint workout_plans_programme_enrolment_fkey
      foreign key (programme_enrolment_id, user_id) references public.programme_enrolments (id, user_id)
      on delete set null (programme_enrolment_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_plans_programme_day_index_check') then
    alter table public.workout_plans add constraint workout_plans_programme_day_index_check
      check (programme_day_index is null or programme_day_index between 0 and 13);
  end if;
end $$;
create index if not exists workout_plans_programme_idx on public.workout_plans (user_id, programme_enrolment_id, planned_for)
  where programme_enrolment_id is not null;
