-- Once-per-account intro film. The app sets this when an account's one-time film starts and treats
-- a missing column as "already seen", so this migration can be applied before or after the code.
--
-- Accounts created before the film became once-per-account have already seen it (it played on every
-- visit), so they are marked as seen; only accounts created after this migration get the one-time film.
-- The backfill runs only in the step that adds the column. Applied again, or after 20261117100000 (which
-- adds the same column without a backfill), this changes nothing, so an account that has not seen its
-- film yet keeps intro_completed_at null.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'intro_completed_at'
  ) then
    alter table public.profiles add column intro_completed_at timestamptz;
    update public.profiles set intro_completed_at = coalesce(created_at, now());
  end if;
end $$;

comment on column public.profiles.intro_completed_at is
  'When this account''s one-time FITX intro film started; null until then.';
