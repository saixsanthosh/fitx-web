-- The Settings switch "Floating AI Coach button" (wave 1 of the "next level" job, brand-nav stream).
--
-- coach_launcher is true (the button shows) unless the member turned it off in Settings; then it stays hidden
-- after a refresh, a new sign-in or on another device, until they turn it back on. A temporary dismiss of the
-- button is not stored anywhere (it lasts one page load).
--
-- Additive and re-runnable. The existing owner-only policy (user_preferences_owner), the table grants to
-- authenticated and the member write-budget trigger on user_preferences already cover the new column, so no
-- policy, grant or function changes here. Until this is applied the app keeps the choice on the device only
-- (src/lib/shell/coach-launcher-pref.ts feature-detects the column).
alter table public.user_preferences
  add column if not exists coach_launcher boolean not null default true;

comment on column public.user_preferences.coach_launcher is
  'Floating AI Coach button: true shows it (default), false hides it for good until turned back on in Settings. Cached in localStorage fitx-coach-launcher.';
