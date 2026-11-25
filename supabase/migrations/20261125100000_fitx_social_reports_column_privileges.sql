-- FITX Explore reports: members read their own reports without the evidence (release 2c; runbook #55). Builds on
-- 20261123100060_fitx_social_v1.sql (#51), which made the table and gave members a read of every column of their
-- own reports, and 20261124100000_fitx_social_v2_core.sql (#52), which added the evidence.
--
-- Why: since #52 every report keeps `evidence`, a copy of the reported item made when it was reported (the
-- caption, comment, message, bio or community text another member wrote, with its file names), and
-- `evidence_purge_at`, when that copy is to be removed. The copy is for FITX's moderators, who read it in Admin with
-- the server key. Through #51's table-wide read a reporter could still fetch it from the API (select=evidence), even
-- after its author deleted or unsent the item, until it was removed 90 days after review. It is not the reporter's
-- data: "Download my data" already leaves both columns out (src/lib/account/export.ts, O7 a).
--
-- What it changes: members lose the table-wide read and keep a read of the other ten columns, so a reporter still
-- sees what they reported, their reason and details, the status and the dates. Those ten are exactly the columns
-- "Download my data" names (tests/account/export-schema.test.ts checks them against these grants), and nothing in
-- the app reads any other with a member's session. Row level security is unchanged: a member reads only their own
-- reports. Signed-out visitors held nothing on this table since #51 and still hold nothing. The server key
-- (service_role, which Admin's Explore section reads with) keeps every right, and fitx_social_report,
-- fitx_social_hourly (the hourly clean-up), fitx_admin_op_moderate and fitx_admin_explore_meter run as the table's
-- owner, so reporting, the 90-day purge, moderation and the meter work as before.
--
-- Safe to run again: revoke and grant are idempotent, so a second run ends as the first did. It changes no row,
-- column, policy or function. 20261123100060, run again, would give members every column back (its grant names the
-- whole table), so this file must run again after it (that file runs again only after #52's undo, section 5 of
-- docs/runbooks/platform-database.md).
--
-- Undo (members read every column of their own reports again, the evidence included):
--   begin;
--   revoke select on table public.social_reports from authenticated;
--   grant select on table public.social_reports to authenticated;
--   commit;

do $do$ begin perform pg_catalog.set_config('lock_timeout', '5s', true); end $do$;

-- Revoking the table's read also takes back any column reads, so a second run starts from the same place.
revoke select on table public.social_reports from public, anon, authenticated;
grant select (id, user_id, target_type, target_id, target_user_id, reason, details, status, created_at, reviewed_at)
  on table public.social_reports to authenticated;

notify pgrst, 'reload schema';
