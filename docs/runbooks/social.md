# Explore (social), part 1

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
  followers; a restricted member's comments reach only them and the post's owner.
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
| Photo uploads (bucket policy) | | 60 in 24 hours; 600 files and 150 MB in all per member |

  Every Explore table also joins the general write budget (`fitx_member_write_budget`, 20261121100040).
- Likes and follows notify once per member and post or account; a like or follow notification shows only while it
  still stands, so liking and unliking cannot flood anyone.
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

## Not in part 1

Videos and short videos (no reliable browser re-encode without new packages), stories, challenges, communities,
direct messages, push or e-mail notifications (notifications are in the app only), and Admin moderation screens.
