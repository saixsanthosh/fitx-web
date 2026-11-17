-- FITX activity sources: where each activity's data came from, so imported activities can be told
-- apart from the ones FITX recorded with the phone's GPS.
--
--   source         'fitx_gps' (recorded on the Record screen; the default, so every existing row and
--                  every upload from an older app version is labelled correctly) or 'file' (imported
--                  from a GPX, TCX or FIT file a watch or another app exported).
--   source_format  for imports: 'gpx', 'tcx' or 'fit'.
--   source_device  for imports: the device or app the file names (FIT manufacturer and product name,
--                  TCX creator, GPX creator), as the file names it; at most 120 characters.
--   imported_at    for imports: when the file was imported.
--
-- Imports reuse client_id: the app derives it from the time of the file's first GPS point, so the
-- same session imported again (as GPX and as FIT, say) meets the existing unique (user_id, client_id)
-- and is saved once.
--
-- Additive and safe to re-run: columns are added if missing, checks only if missing. The constant
-- default means no table rewrite. Row-level security, policies and grants are unchanged: the
-- owner-only policies on public.activities already cover new columns.
alter table public.activities
  add column if not exists source text not null default 'fitx_gps',
  add column if not exists source_format text,
  add column if not exists source_device text,
  add column if not exists imported_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_source_check' and conrelid = 'public.activities'::regclass) then
    alter table public.activities
      add constraint activities_source_check check (source in ('fitx_gps', 'file'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_source_format_check' and conrelid = 'public.activities'::regclass) then
    alter table public.activities
      add constraint activities_source_format_check check (source_format in ('gpx', 'tcx', 'fit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_source_device_check' and conrelid = 'public.activities'::regclass) then
    alter table public.activities
      add constraint activities_source_device_check check (char_length(source_device) <= 120);
  end if;
end $$;

comment on column public.activities.source is
  'Where the data came from: fitx_gps (recorded with the phone''s GPS on the Record screen) or file (imported from a GPX, TCX or FIT file).';
comment on column public.activities.source_format is
  'For imported activities: the file format (gpx, tcx or fit).';
comment on column public.activities.source_device is
  'For imported activities: the device or app the file names, as the file names it (never guessed).';
comment on column public.activities.imported_at is
  'For imported activities: when the file was imported.';
