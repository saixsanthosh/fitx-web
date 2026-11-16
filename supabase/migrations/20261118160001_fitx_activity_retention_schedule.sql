-- Daily clean-up of detailed activity GPS points (needs 20261118160000_fitx_activity_tracking).
--
-- Turns on the pg_cron extension (the same as Supabase Dashboard > Database > Extensions > pg_cron)
-- and runs public.fitx_prune_activity_track_chunks(90) every day at 03:23 UTC: full-resolution
-- points older than 90 days are removed, activity summaries and their simplified routes stay.
-- Change the 90 to keep points for longer or shorter (the function never keeps fewer than 7 days).
--
-- Safe to re-run: the extension is created only if missing, and scheduling a job with an existing
-- name replaces that job. Without this migration nothing is ever pruned (points are kept for longer
-- than 90 days, which still meets the "at least one week" requirement but uses more storage).
-- To stop it: select cron.unschedule('fitx-prune-activity-track-chunks');
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'fitx-prune-activity-track-chunks',
  '23 3 * * *',
  $$select public.fitx_prune_activity_track_chunks(90)$$
);
