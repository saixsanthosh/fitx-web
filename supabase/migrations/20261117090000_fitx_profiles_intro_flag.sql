-- Once-per-account intro film. The app sets this when an account's one-time film starts and treats
-- a missing column as "already seen", so this migration can be applied before or after the code.
alter table public.profiles add column if not exists intro_completed_at timestamptz;

comment on column public.profiles.intro_completed_at is
  'When this account''s one-time FITX intro film started; null until then.';
