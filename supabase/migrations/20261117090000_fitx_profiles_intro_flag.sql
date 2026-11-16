-- Once-per-account intro film. The app sets this when an account's one-time film starts and treats
-- a missing column as "already seen", so this migration can be applied before or after the code.
alter table public.profiles add column if not exists intro_completed_at timestamptz;

comment on column public.profiles.intro_completed_at is
  'When this account''s one-time FITX intro film started; null until then.';

-- Accounts created before the film became once-per-account have already seen it (it played on every
-- visit), so they are marked as seen; only accounts created after this migration get the one-time film.
update public.profiles set intro_completed_at = coalesce(created_at, now()) where intro_completed_at is null;
