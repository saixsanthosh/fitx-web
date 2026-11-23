-- FITX coach and activity v2: more GPS sports and best efforts.
--
--   activities.sport          widened from walk, run and ride to also accept hike, trail_run, mtb, ebike,
--                             wheelchair, skate and paddle (src/lib/activity/types.ts SPORTS). The original
--                             check was unnamed (Postgres called it activities_sport_check); it is replaced by
--                             a named check of the same name that lists every sport, so the next widening can do
--                             the same. Every existing row passes it (it only adds values).
--   activities.best_efforts   the fastest time for each benchmark distance inside one activity, worked out on the
--                             device from the recorded route when the activity is finished (or when its page
--                             replays the stored points): [{ "d": metres, "s": seconds, "start_m": metres }].
--                             Elapsed time, as a race clock: pauses inside the stretch count. Null when not worked
--                             out (activities saved by an older app version, or with no detailed points).
--
-- The app feature-detects this migration by the best_efforts column (repository.ts activityV2Ready): before it,
-- the new sports are not offered and best efforts are worked out on the page only.
--
-- Additive and safe to re-run: the column is added if missing; the sport check is replaced only while it does not
-- yet list the new sports, inside one transaction, so the table is never without a check. No new table, policy,
-- function or grant: the owner-only policies on public.activities already cover the new column, and the member
-- write budget triggers are unchanged.
begin;

alter table public.activities
  add column if not exists best_efforts jsonb;

do $$
declare
  current_def text;
begin
  select pg_get_constraintdef(oid) into current_def
  from pg_constraint
  where conname = 'activities_sport_check' and conrelid = 'public.activities'::regclass;

  if current_def is null or position('paddle' in current_def) = 0 then
    if current_def is not null then
      alter table public.activities drop constraint activities_sport_check;
    end if;
    alter table public.activities
      add constraint activities_sport_check
      check (sport in ('walk', 'run', 'ride', 'hike', 'trail_run', 'mtb', 'ebike', 'wheelchair', 'skate', 'paddle'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'activities_best_efforts_check' and conrelid = 'public.activities'::regclass) then
    alter table public.activities
      add constraint activities_best_efforts_check
      check (best_efforts is null or (jsonb_typeof(best_efforts) = 'array' and jsonb_array_length(best_efforts) <= 20 and pg_column_size(best_efforts) <= 4000));
  end if;
end $$;

comment on column public.activities.sport is
  'walk, run, ride, hike, trail_run, mtb (mountain bike), ebike, wheelchair, skate (inline skating) or paddle (kayak, canoe, paddleboard).';
comment on column public.activities.best_efforts is
  'Fastest elapsed time per benchmark distance inside this activity, from its recorded route: [{d: metres, s: seconds, start_m: metres}]. Null when not worked out.';

commit;
