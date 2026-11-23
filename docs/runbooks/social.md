# Explore (social)

Explore is FITX's social space: profiles, follows (private accounts approve), photo posts, likes, comments with
replies, saves, sharing, Discover (search, topics, trending, people to follow), notifications, reports, blocks and
restrictions. Wave 2 adds stories, short videos, challenges, communities, direct messages and Admin moderation.

## Where things are

| What | Where |
|---|---|
| Schema, policies, bucket, limits | `supabase/migrations/20261123100060_fitx_social_v1.sql` |
| Typed calls, text parsing, limits, photo compression | `src/lib/social/**` |
| Screens | `src/app/(dashboard)/explore/**`, `src/components/social/**` |
| Topic stills | `public/media/explore/*.webp`, `src/data/explore-media.ts`, `scripts/media/explore.prompts.json` |
| Tests | `tests/social/**` (unit and SQL), e2e flow `tests/e2e/flows/21-explore.mjs` |

Routes: `/explore` (feed), `/explore/discover[?topic=|?tag=]`, `/explore/new`, `/explore/p/<post id>`,
`/explore/u/<username>`, `/explore/notifications`, `/explore/settings`. `/social` redirects to `/explore`.

## How it is protected

- Members write nothing directly. Every change is a `security definer` function (`fitx_social_*`) with
  `search_path = ''` that takes the member from the session (`auth.uid()`), never from its arguments.
- Reads go through row level security on every table; the policies ask `fitx_social_viewer_sees_*`, which answer
  only for the signed-in member. A block either way hides everything; a private account's posts reach only accepted
  followers; a restricted member's comments reach only them and the post's owner, in notifications too (no reply
  or mention notification, no snippet, and a later restriction hides earlier ones).
- Photos are in the private bucket `social-media` (3 MB a file, WebP or JPEG only) at
  `<user id>/<post id>/<0-9>.webp|jpg` or `<user id>/profile/<name>.webp|jpg`. A signed link is issued only for a
  file its post's or profile's visibility allows (`fitx_social_can_read_object`). The browser shrinks every photo to
  a long edge of at most 1,600 px and re-encodes it (which also drops camera and GPS metadata) before upload.
- Limits (the database enforces them; the app only says so sooner):

| Action | Per hour | Per day |
|---|---|---|
| Posts | 10 | 25 |
| Comments | 60 | 300 |
| Likes, saves | 300 | 1,500 |
| Follows | 60 | 200 |
| Reports | 10 | 30 |
| Profile and setting saves | 30 | 100 |
| Photo uploads (bucket policy) | | 60 in 24 hours, counted as they happen (deleting a file gives none back); 600 files and 150 MB in all per member |

  Every Explore table also joins the general write budget (`fitx_member_write_budget`, 20261121100040).
- Likes and follows notify once per member and post or account; a like or follow notification shows only while it
  still stands, so liking and unliking cannot flood anyone. The unread badge counts exactly what the list shows
  (`fitx_social_notification_visible` decides both).
- Nothing from Workouts, Nutrition, Progress or Activity is read by Explore. A post holds only the photos and words the
  member chose.

## Moderation (until wave 2's Admin screens)

Reports are in `public.social_reports` (`status` open, reviewing, actioned or dismissed). With the server key:

```sql
select r.created_at, r.target_type, r.target_id, r.reason, r.details, p.username as reported
from public.social_reports r left join public.social_profiles p on p.user_id = r.target_user_id
where r.status = 'open' order by r.created_at;
```

To remove a post: `delete from public.social_posts where id = '<id>';` then delete its files under
`social-media/<owner id>/<post id>/` in the Storage dashboard, and set the report's `status` to `actioned`.

## Storage on the free plan

The whole project has 1 GB. Each photo is usually 150 to 500 KB after compression, so 1 GB holds roughly 3,000 to
6,000 photos. Watch Storage usage in the Supabase dashboard; the per-member limits above stop any one account from
filling it. Files a member uploaded for a post that then failed are deleted by the app; a file left behind (for
example when the browser closed mid-post) stays readable only by its owner and counts towards their limit.

## Account deletion

The database rows go with the login (foreign keys cascade). The photos must be removed first, by
`removeSocialMediaFiles(admin, userId)` from `src/lib/account/deletion.ts`, called in `/api/account` next to
`removeUserFiles` (integrator edit).

## Part 2 core (wave 2, `20261124100000_fitx_social_v2_core.sql`, runbook #52)

Applied **before** the wave-2 deploy; wave-1 clients keep working in between (`tests/social/compat-sql.test.mjs`).
It creates every wave-2 Explore table (stories, sanctions, the storage trash, conversations and messages,
communities, challenges, the moderation record) and every shared helper; the groups file (#53) and the Admin file
(#54) add only functions, policies and jobs.

- **Item-level visibility.** `fitx_social_sees_post`, `_sees_comment_row`, `_sees_story`, `_sees_community` and
  `_post_listed` decide what one member sees of one item; every read of another member's posts, comments or stories
  uses them (`tests/social/item-helpers.test.mjs` fails otherwise). `tests/social/safety-matrix-sql.test.mjs` checks
  each viewer (self, stranger, pending, follower, blocked either way, restricted, community member, teen, unknown
  age) against each owner state (active, suspended, deleted) and content state.
- **Moderation states** on posts, comments, stories, messages and communities: `visible`; `limited` (owner,
  accepted followers and, in a community, its accepted members only; out of Discover, trending, hashtags, topics,
  search, suggestions, the Videos feed and non-followers' story trays); `hidden` (the owner only, shown as "Hidden
  by FITX"). Admin (#54) sets them.
- **Sanctions** (`social_member_sanctions`, set in Admin): `explore` (the member's Explore use stops with
  `social_suspended`, their content is hidden from everyone else), `dm`, `upload`. Deleting, blocking, unblocking,
  reporting, unfollowing, settings reads and "Your Explore content" stay open while suspended, and while Explore is
  switched off (`platform_settings.features.explore = false`; a missing key means on).
- **Age (O1 a):** `fitx_social_age_band` from `profiles.date_of_birth`, else `profiles.age`. Under 13: no Explore
  profile. No date of birth: teen rules until the member adds one in Explore settings ("Add your date of birth",
  `fitx_social_set_birth_date`, once; `social_profiles.birth_date_added_at` records it for Admin). Messages,
  communities and leaderboards need 18+ (#53 enforces them and raises `social_age_restricted` with the band as hint).
- **Reports** snapshot the item (`evidence`, at most 8 KB; O4 a: a message report holds that one message) and accept
  content addressed to the reporter across a block. Evidence is removed 90 days after review (O8 a).
- **Videos** (`explore_video`, off unless saved as true): one video of at most 30 s per post (15 s for a story) at
  `<uid>/<id>/0.mp4` with its poster at `<uid>/<id>/0p.webp`. A member's own key never signs another member's
  `.mp4`: `/api/social/video-links` asks `fitx_social_video_link_allowed`, which counts 40 plays a day per member and
  the project's daily play bytes.
- **Caps (O9 a), owner-tunable:** `fitx_social_caps()` returns them. To change one, run in the SQL editor:

```sql
create or replace function public.fitx_social_caps() returns jsonb language sql immutable set search_path = '' as $f$
  select pg_catalog.jsonb_build_object('social_media_bytes', 471859200, 'video_bytes', 262144000,
    'story_bytes', 62914560, 'video_play_bytes_per_day', 78643200);
$f$;
```

  (450 MB of Explore files, of which 250 MB videos and posters and 60 MB live stories; 75 MB of video plays a day.)
- **New limits:** stories 10 an hour, 20 a calendar day and 10 in any 24 hours; videos 2 an hour and 3 a day (also
  3 `.mp4` uploads in 24 hours and 20 kept); video plays 40 a day; restricting 30 an hour and 100 a day.
- **Clean-up:** the pg_cron job `fitx-social-hourly` (minute 7) runs `fitx_social_hourly()`: expired stories without
  an open report are deleted and their files queued in `social_storage_trash`; files older than 6 hours that nothing
  refers to are queued; trash rows whose file is gone are forgotten; report evidence is removed 90 days after review;
  notifications older than 90 days are deleted. Files leave the bucket only through the Storage API, by
  `/api/social/sweep` (daily Vercel cron). Check it: `select public.fitx_social_hourly();` (service role) and
  `select * from cron.job_run_details where command like '%fitx_social_hourly%' order by start_time desc limit 5;`.
- **Realtime:** `fitx_social_ping` sends ids only to the private topic `social:inbox:<uid>`; a failing ping never
  fails a write.

## Not yet

Push or e-mail notifications (notifications are in the app only). Stories, short videos, challenges, communities,
direct messages and the Admin screens arrive with the wave-2 streams after part 2 core.
