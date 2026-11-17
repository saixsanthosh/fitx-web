-- FITX saved exercises: adopts public.exercise_favorites. Production has had this table since experience 2.0
-- (applied by hand on 2026-10-02, docs/runbooks/platform-database.md section 1.8) without a file in this folder.
-- The exercise library and the exercise page now keep each member's saved exercises in it
-- (src/lib/domain/exercise-preferences.ts), so they follow the member to every device, are part of
-- "Download my data" (src/lib/account/export.ts) and are deleted with the account.
--
-- On production this file changes nothing: the table, its index, its owner-only policy and its grants are
-- exactly experience 2.0's. On a new project it creates them. Additive; plain SQL, safe to run more than once.

create table if not exists public.exercise_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null references public.exercise_library(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
create index if not exists exercise_favorites_exercise_idx
  on public.exercise_favorites (exercise_id);

alter table public.exercise_favorites enable row level security;
drop policy if exists exercise_favorites_owner on public.exercise_favorites;
create policy exercise_favorites_owner on public.exercise_favorites for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, delete on public.exercise_favorites to authenticated;

-- A saved exercise that the catalogue clean-up merged into another follows it to the kept exercise, as saved
-- plans, sessions, records and notes do (scripts/catalog/migration.mjs lists the tables that follow merges).
-- When the member has saved the kept exercise as well, the duplicate's row goes: the key is member and exercise.
delete from public.exercise_favorites as f
using public.exercise_library as e
where f.exercise_id = e.id
  and e.merged_into is not null
  and exists (select 1 from public.exercise_favorites as k where k.user_id = f.user_id and k.exercise_id = e.merged_into);
update public.exercise_favorites as f
set exercise_id = e.merged_into
from public.exercise_library as e
where f.exercise_id = e.id
  and e.merged_into is not null;
