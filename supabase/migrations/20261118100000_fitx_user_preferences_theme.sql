-- Theme preference on the account, so a choice made in Settings follows the user to other devices.
-- Additive and safe to apply before or after the code: until it is applied the app keeps the choice
-- on the device (localStorage "fitx-theme") and pushes it to the account once this column exists.
alter table public.user_preferences
  add column if not exists theme text not null default 'system';

alter table public.user_preferences
  drop constraint if exists user_preferences_theme_check;

alter table public.user_preferences
  add constraint user_preferences_theme_check check (theme in ('light', 'dark', 'system'));

comment on column public.user_preferences.theme is
  'Site theme chosen in Settings: light, dark, or system (match the device). Mirrored to localStorage fitx-theme.';

-- Existing owner policy (user_preferences_owner) and table grants already cover the new column.
