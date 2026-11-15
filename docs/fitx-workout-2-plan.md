# FITX Workout 2.0 — staged implementation plan

## Audit

- Keep the existing Next.js routes, Supabase client, catalog and RLS as the product foundation.
- The live catalog is represented by 876 unique records in the repository's existing import migrations. Do not seed a second copy or invent exercise facts.
- The current schema already supports user-owned plans, ordered plan exercises, durable sessions, sets, personal records and planner events. `/progress` is the existing history/progress destination.
- The current exercise import is based on Free Exercise DB, revision `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`; imported rows use the `free-exercise-db-` ID prefix. The pinned source exposes still-image movement frames, not animated video.
- Motion-asset review: the [Desk Break library](https://github.com/shlomorsh/desk-break) publishes 435 MIT-licensed GLB motions on a simplified wooden mannequin, focused mainly on mobility, seated/floor work, yoga and low-impact activity. Its limited rig and movement coverage do not support the accuracy or visual direction needed for the full strength catalog, so it was not presented as a universal demo source. The [RepDB free tier](https://github.com/RepDB/exercise-dataset) includes licensed stills with attribution; its animation package is a separate paid license and was not used.
- There is no local `.env.local`, Supabase CLI, Docker runtime or exercise media in `public/`. Local account-backed queries therefore cannot be exercised without connecting to the user's Supabase project.

## Stages

1. **Library discovery:** keep filters grounded in existing fields; add URL-shareable search/filter/sort, device-local favorites/recent views, bounded result rendering and responsive controls.
2. **Exercise detail/media:** resolve alternatives to real records, link selected movements into the builder, and use only verified, pinned movement frames with a clear still-image fallback. Never label stills as animation.
3. **Plan builder:** make selection immediately visible, support keyboard-accessible ordering and per-exercise set/rep/rest/load/time targets, and add safe plan management actions while retaining RLS-scoped Supabase writes.
4. **Live session:** improve focused exercise navigation, elapsed/rest timers, timed-set logging, interruption handling, pause/resume and duplicate completion handling without fabricating set data.
5. **History and quality:** retain `/progress` as the single history destination, validate calculations, and inspect theme, responsive, accessibility, lint, type, build and browser behavior.

## Guardrails

- No production data or remote schema changes from this worktree.
- No commit, push, deployment or destructive cleanup.
- Any database change must be an additive local migration with reviewed RLS; the current Phase 2 pass reuses existing tables and does not alter their RLS policies.
- New optional planned load, timed-target, per-set duration and pause timing columns are defined in local migrations. They have not been applied to any remote or production database.
- Never present an unverified image, generated motion or empty history as a real demonstration or user result.
