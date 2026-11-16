-- FITX Workouts v2 (3 of 6): exercise media.
-- One row per still photo or video loop of an exercise. Today only stills exist: the two Free Exercise DB
-- photos (Unlicense, pinned revision f00c92c7) for every exercise with a source_ref (set by 20261118130010).
-- `source_url` is the original on GitHub; `storage_path` is the self-hosted copy in the public
-- `exercise-media` bucket. `mirrored_at` stays null until scripts/catalog/mirror-media.mjs has uploaded the
-- copy; until then the app shows the source URL. Video loops (kind 'video_loop') arrive later with licensed
-- or FITX-produced demonstrations; none are seeded and none are faked.

create table if not exists public.exercise_media (
  id uuid primary key default gen_random_uuid(),
  exercise_id text not null references public.exercise_library (id) on delete cascade,
  kind text not null check (kind in ('still', 'video_loop')),
  position smallint not null default 0 check (position between 0 and 20),
  storage_path text check (storage_path is null or storage_path ~ '^[A-Za-z0-9_./-]+$'),
  source_url text check (source_url is null or source_url ~ '^https://'),
  mirrored_at timestamptz,
  width smallint check (width is null or width > 0),
  height smallint check (height is null or height > 0),
  alt text not null default '',
  attribution text not null,
  license text not null,
  created_at timestamptz not null default now(),
  unique (exercise_id, kind, position),
  check (storage_path is not null or source_url is not null)
);
create index if not exists exercise_media_exercise_idx on public.exercise_media (exercise_id, kind, position);

alter table public.exercise_media enable row level security;
drop policy if exists exercise_media_read on public.exercise_media;
create policy exercise_media_read on public.exercise_media for select to anon, authenticated
  using (exists (select 1 from public.exercise_library e where e.id = exercise_media.exercise_id and e.is_active));
grant select on public.exercise_media to anon, authenticated;

-- Public bucket for the self-hosted copies. Anyone can read objects; only the service role can upload.
insert into storage.buckets (id, name, public)
values ('exercise-media', 'exercise-media', true)
on conflict (id) do nothing;

insert into public.exercise_media (exercise_id, kind, position, storage_path, source_url, alt, attribution, license)
select
  e.id,
  'still',
  frame.position,
  'free-exercise-db/' || e.source_ref || '/' || frame.position || '.jpg',
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/' || e.source_ref || '/' || frame.position || '.jpg',
  e.name || ', photo ' || (frame.position + 1) || ' of 2',
  'Free Exercise DB (github.com/yuhonas/free-exercise-db)',
  'Unlicense (public domain dedication)'
from public.exercise_library e
cross join (values (0), (1)) as frame (position)
where e.source_ref is not null and e.source_ref ~ '^[A-Za-z0-9_-]+$'
on conflict (exercise_id, kind, position) do nothing;
