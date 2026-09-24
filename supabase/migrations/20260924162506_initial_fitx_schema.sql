-- FITX — initial schema + Row Level Security
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (idempotent).

-- ─────────────────────────── profiles ───────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  name          text,
  avatar        text,
  gender        text,
  age           int,
  height        numeric,
  weight        numeric,
  target_weight numeric,
  experience    text    default 'Beginner',
  diet_mode     text    default 'Maintenance',
  workout_mode  text    default 'Gym',
  goals         text[]  default '{}',
  level         int     default 1,
  xp            int     default 0,
  streak        int     default 0,
  best_streak   int     default 0,
  plan          text    default 'Free',
  onboarded     boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ─────────────────────────── workouts ───────────────────────────
create table if not exists public.workouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  date            timestamptz default now(),
  duration        int     default 0,
  total_volume    numeric default 0,
  calories_burned int     default 0,
  prs             int     default 0,
  exercises       jsonb   default '[]'::jsonb,
  created_at      timestamptz default now()
);
create index if not exists workouts_user_date_idx on public.workouts (user_id, date desc);

-- ───────────────────────────── meals ─────────────────────────────
create table if not exists public.meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  date         date default current_date,
  meal         text not null,           -- Breakfast | Lunch | Dinner | Snack
  food_name    text not null,
  brand        text,
  barcode      text,
  serving_size text,
  servings     numeric default 1,
  calories     numeric default 0,
  protein      numeric default 0,
  carbs        numeric default 0,
  fat          numeric default 0,
  created_at   timestamptz default now()
);
create index if not exists meals_user_date_idx on public.meals (user_id, date desc);

-- ───────────────────────────── tasks ─────────────────────────────
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  description text,
  category    text,
  priority    text default 'Medium',
  status      text default 'pending',
  due_date    date,
  due_time    text,
  recurring   text default 'None',
  tags        text[] default '{}',
  created_at  timestamptz default now()
);
create index if not exists tasks_user_idx on public.tasks (user_id, created_at desc);

-- ───────────────────────────── habits ────────────────────────────
create table if not exists public.habits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  category       text,
  frequency      text default 'Daily',
  current_streak int  default 0,
  best_streak    int  default 0,
  completion_log jsonb default '{}'::jsonb,
  created_at     timestamptz default now()
);
create index if not exists habits_user_idx on public.habits (user_id);

-- ────────────────────────── body_metrics ─────────────────────────
create table if not exists public.body_metrics (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  date       date default current_date,
  weight     numeric,
  body_fat   numeric,
  note       text,
  created_at timestamptz default now()
);
create index if not exists body_metrics_user_date_idx on public.body_metrics (user_id, date desc);

-- ─────────────────────── Row Level Security ──────────────────────
alter table public.profiles     enable row level security;
alter table public.workouts     enable row level security;
alter table public.meals        enable row level security;
alter table public.tasks        enable row level security;
alter table public.habits       enable row level security;
alter table public.body_metrics enable row level security;

-- profiles: a user owns the row whose id == their auth uid
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- the rest: a user owns rows where user_id == their auth uid
do $$
declare t text;
begin
  foreach t in array array['workouts','meals','tasks','habits','body_metrics'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner', t
    );
  end loop;
end $$;

-- ───────────── auto-create a profile row on signup ───────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── keep profiles.updated_at fresh ────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
