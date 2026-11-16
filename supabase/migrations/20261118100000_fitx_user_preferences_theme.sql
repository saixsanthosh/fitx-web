-- Theme preference on the account, so a choice made in Settings follows the user to other devices.
--
-- theme is NULL until the account has a choice of its own. It has no default on purpose: before this
-- column existed, choices made with the old header toggle lived only on each device (localStorage
-- "fitx-theme"), and a default would overwrite them all. While theme is NULL, the next signed-in load
-- stores that device's choice on the account instead.
--
-- theme_updated_at records when the choice was made (on the device that made it), so a choice saved
-- late by a device that was offline never overwrites a newer one made elsewhere.
--
-- Additive and safe to apply before or after the code: until it is applied, the app keeps each
-- choice on the device and saves it to the account once these columns exist.
alter table public.user_preferences
  add column if not exists theme text,
  add column if not exists theme_updated_at timestamptz;

alter table public.user_preferences
  drop constraint if exists user_preferences_theme_check;

alter table public.user_preferences
  add constraint user_preferences_theme_check check (theme in ('light', 'dark', 'system'));

comment on column public.user_preferences.theme is
  'Site theme chosen in Settings: light, dark, or system (match the device). NULL until the account has a choice. Mirrored to localStorage fitx-theme.';

comment on column public.user_preferences.theme_updated_at is
  'When the theme was chosen, so a choice saved late from an offline device cannot overwrite a newer one.';

-- Existing owner policy (user_preferences_owner) and table grants already cover the new columns.
