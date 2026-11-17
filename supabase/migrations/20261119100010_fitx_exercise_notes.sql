-- FITX exercise notes: one private note per member and exercise, at most 500 characters ("seat on 4, pin at 7").
-- Only the member can read or change their notes (row level security, owner only). They are part of
-- "Download my data" (src/lib/account/export.ts) and are deleted with the account. Until this file is applied
-- the exercise page hides its note box (src/lib/training/exercise-notes.ts). Additive; plain SQL, safe to run
-- more than once.

create table if not exists public.exercise_notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id text not null references public.exercise_library (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500 and btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
create index if not exists exercise_notes_exercise_idx on public.exercise_notes (exercise_id);

alter table public.exercise_notes enable row level security;
drop policy if exists exercise_notes_owner on public.exercise_notes;
create policy exercise_notes_owner on public.exercise_notes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on table public.exercise_notes from public, anon;
grant select, insert, update, delete on public.exercise_notes to authenticated;

-- A note on an exercise that the catalogue clean-up merged into another follows it to the kept exercise, as
-- saved plans, sessions and records do (scripts/catalog/migration.mjs lists the tables that follow merges). A
-- note the member already has on the kept exercise stays as it is. No note exists when this first runs.
update public.exercise_notes as n
set exercise_id = e.merged_into
from public.exercise_library as e
where n.exercise_id = e.id
  and e.merged_into is not null
  and not exists (select 1 from public.exercise_notes as k where k.user_id = n.user_id and k.exercise_id = e.merged_into);
