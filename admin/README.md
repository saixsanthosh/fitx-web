# FITX Admin

FITX Admin is a private operations console that lives in `admin/` of the FITX repository. It is a separate Next.js application and a separate Vercel project, `admin`. The FITX customer website stays at the repository root in its own Vercel project, `fitnessx` (https://fitnessx.vercel.app).

Sign-in is a username and password (no Google). The owner's account is the **root operator**: its username and a scrypt hash of its password live only in the Admin project's environment. Other operators are added in Admin by a super-admin.

## Owner checklist

1. **Make the password hash on your own computer.** `cd admin && npm run admin:hash`, type the password twice (nothing shows as you type), and copy the single line it prints. It starts `scrypt:`. Never paste the password itself anywhere, and never commit the hash.
2. **Set the variables.** Vercel, project **admin**, Settings, Environment Variables, **Production** only, both marked **Sensitive**: `FITX_ADMIN_USERNAME` = your username in lower case and `FITX_ADMIN_PASSWORD_HASH` = the line from step 1. Keep `SUPABASE_SECRET_KEY`, `ADMIN_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Delete `FITX_ADMIN_ALLOWED_EMAILS`: it is no longer read.
3. **Give the OK to apply the three Admin database updates** before Admin is redeployed: `20261121100030_fitx_admin_v2`, `20261121100033_fitx_admin_ops` and `20261121100036_fitx_admin_content` (#42 to #44 in `docs/runbooks/platform-database.md`; the coordinator applies them, in that order, after the Phase 10 files listed in [Database migrations](#database-migrations)). Until `20261121100030` is applied, Admin refuses every sign-in and logs which migration is missing; until the other two are, the sections that need them say so.
4. **Redeploy Admin** and sign in at `/login`. Five wrong passwords from one network address lock that username on that address for 15 minutes (another network still works); 50 from any addresses lock it everywhere for 5 minutes. Wait it out, or set a new `FITX_ADMIN_PASSWORD_HASH` and redeploy, which clears every per-address lock.
5. **Add operators** in Admin and security, Access control. Each gets a temporary password from you and chooses their own at first sign-in.
6. Optional: remove the old Admin `/auth/callback` entry from the Supabase Redirect URLs.
7. Optional, project **fitnessx** (not admin): `OLLAMA_BASE_URL` (an `https://` address of an Ollama server you run and keep private) and `OLLAMA_MODEL`. Leave both unset to use only the free hosted AI providers.
8. Optional, after `20261121100036` is applied: run `scripts/catalog/mirror-media.mjs` so catalogue photos are served from FITX Storage. Until then Workouts previews them from the catalogue's GitHub source.

To change your password later, repeat steps 1, 2 and 4: every open Admin session ends, because each session remembers which password hash it signed in with.

### If sign-in does not work

Every refusal shows the same message on purpose, so the page never says which part was wrong. Vercel, project **admin**, Logs, shows a `[fitx-admin]` line for each refused check:

| Log line | What to check |
| --- | --- |
| `FITX_ADMIN_USERNAME or FITX_ADMIN_PASSWORD_HASH is missing or malformed` | Steps 1 and 2: the hash must be the whole `scrypt:` line. Redeploy after changing a variable. |
| `SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set` | The server key is Production-only, so Preview deployments show this on purpose. |
| `sign-in is refused until migration 20261121100030_fitx_admin_v2 is applied` | Step 3. |
| nothing new | Five wrong passwords from one network address lock that username on that address for 15 minutes (another network still works); 50 from any addresses lock it everywhere for 5 minutes; one network address gets at most 20 attempts in 15 minutes. Wait it out, or set a new `FITX_ADMIN_PASSWORD_HASH` and redeploy, which clears every per-address lock. |

## What Admin does

Eleven sections, in this order: 1 Dashboard (`/overview`), 2 Users (`/users`), 3 Workouts (`/training`), 4 Nutrition (`/nutrition`), 5 Subscriptions (`/billing`), 6 Support (`/support`), 7 Notifications (`/notifications`, `/announcements`), 8 Explore (`/explore`, `/explore/communities`, `/explore/challenges`), 9 Reports (`/reports`, analytics), 10 Admin and security (`/access-control`, `/audit`, `/security`), 11 Settings (`/settings`). `/account` is where an operator changes their own password. The navigation shows only the sections a role may open, and every page checks again on the server.

## Roles

| Role | May use |
| --- | --- |
| Super-admin | Everything, including operators, account deletion, settings and billing changes, and audit export. The root is always a super-admin. |
| Admin | Everything else: overview, reports, users (including suspend), support, Explore moderation, communities and challenges, workouts, nutrition, notifications, announcements, audit log, security, access and settings (read-only), billing (read-only). |
| Support agent | Overview, users (sign out everywhere, password reset), support, the Explore queue (read-only). |
| Content editor | Overview, workouts, nutrition, announcements, notifications. |
| Viewer | Overview and reports, read-only. |

The table lives in two places that a test keeps identical: `src/lib/roles.ts` and `fitx_admin_role_permissions`, as its newest migration (`20261124100020`) leaves it.

## Explore

Members' reports from Explore, and the communities and challenges FITX runs there. Nothing is seeded: the queue fills from members' reports, and communities, challenges and templates exist only once an operator types them in.

- **Queue** (`/explore`): reports oldest first while waiting (open or in review), with tabs by status and kind, and the Free-plan meter (storage per bucket and per kind of Explore file, Explore's own caps, the database, video plays signed today, the clean-up queue and the hourly job's last run; a file with no recorded size makes the total "at least", never 0). The navigation badge counts waiting reports.
- **Report** (`/explore/reports/<id>`): the reporter's snapshot (pictures and videos through 300-second signed links), what moderators did, and the actions: Dismiss, Take for review, Limit, Hide, Unhide, Remove, Warn, Clear photo, Clear bio, Suspend from Explore (Explore, messages or uploads; 7 days, 30 days or until lifted) and Lift suspension. Each action closes every open report on the item, tells each reporter FITX reviewed it, keeps the snapshot 90 days after review, and is audited in the same transaction (codes and counts only; the moderator's note is never on the audit log). Opening a report is audited too. A reported message shows only that one message, never the conversation.
- **Account** (`/explore/accounts/<id>`): the Explore profile, "Date of birth added in Explore on …", suspensions, reports about the member and what moderators did, with the member actions.
- **Communities** (`/explore/communities`, `/explore/communities/<id>`): name, address, description, public or private, a cover (made into a 16:9 WebP in the browser, uploaded to `communities/<id>/cover.webp` with the server key), and moderators (accepted adult members, by their Explore username).
- **Challenges** (`/explore/challenges`): open and recently closed challenges (weekly Monday to Monday or monthly 1st to 1st, India time), Close challenge, and templates the hourly job opens challenges from. Values are always computed from members' own workouts and activities.
- Super-admins and admins act (`explore.moderate`); support agents read (`explore.view`); content editors and viewers see no Explore section.
- Settings has two more switches: **Explore** (on unless switched off; members can still delete their content from Explore settings) and **Explore videos** (off until video posts are checked on real phones). They appear once `20261124100020` is applied.

## Metrics

| Number | Exactly what it counts |
| --- | --- |
| Registered accounts | Supabase Auth accounts that are not deleted, not anonymous and not old Google-era Admin team members. Every number below leaves out the same accounts. |
| With a confirmed email | Of those, accounts whose email is confirmed. |
| New in 7 / 30 days | Accounts created in the window. |
| Signed in in 24 hours / 7 / 30 days | Accounts whose most recent **fresh** sign-in (Auth `last_sign_in_at`) is in the window. Staying signed in does not create a new sign-in, so regular users are undercounted. |
| Active in 24 hours / 7 / 30 days | Accounts that logged a workout session, workout set, meal, water entry, body measurement or goal progress entry in the window. Signing in alone does not count. |
| Workouts completed | Workout sessions with status completed, counted on the day they started. |
| Meals logged | Meal entries created in the window. |
| Trend days | Calendar days in India Standard Time. |

## Database migrations

All files are in the root `supabase/migrations/` folder, applied in file-name order; each runs safely more than once. The Phase 10 files `20261118180000` to `20261118180006` made the Admin tables, the append-only audit log, metrics, people search, support and announcements. The three Admin files below are #42 to #44 in `docs/runbooks/platform-database.md`, which has each one's Check query, expected result and undo.

1. `20261121100030_fitx_admin_v2.sql` (#42):
   - `admin_operators`, `admin_web_sessions` and `admin_login_attempts`, with row-level security on and no policy, so only the server key and the database functions reach them;
   - the sign-in limit functions `fitx_admin_login_check` and `fitx_admin_login_record`;
   - `fitx_admin_op_can`, `fitx_admin_op_log_event` and an operator version (`fitx_admin_op_*`) of every Admin write function;
   - operator columns on the audit log, support requests and messages, and announcements. The older functions, `fitx_admin_members` and all audit history stay.
2. `20261121100033_fitx_admin_ops.sql` (#43): `platform_settings` (one row of feature switches, the maintenance notice and website information; members and visitors may read it, operators write it through `fitx_admin_op_save_platform_settings`), `member_notifications` (notices to chosen accounts; each member reads and dismisses only their own), the support Complaint category and unread tracking, account search v2, the Dashboard extras and the Security summary.
3. `20261121100036_fitx_admin_content.sql` (#44): no new table. Type and size limits on the `exercise-media` bucket, a public `food-media` bucket, and the operator functions behind Workouts, Nutrition, Subscriptions (plans; never prices) and Reports.

4. `20261124100020_fitx_admin_explore.sql` (#54, wave 2): no new table. The Explore permissions (the role table recreated), the `explore` and `explore_video` switches in the settings save, the moderation, community, challenge and template functions, and the Free-plan meter. It needs `20261124100000_fitx_social_v2_core` (#52) first, and uses `20261124100010` (#53) for the challenge close when it is there. Until it is applied, the Explore screens say which migration they need and Settings shows only the five older switches.

## Environment variables

Set these in a local `.env.local` or in the **admin Vercel project only**. `.env.example` contains placeholders, not working credentials.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `FITX_ADMIN_USERNAME` | Server only, Production | The root operator's username. |
| `FITX_ADMIN_PASSWORD_HASH` | Server only, Sensitive, Production | The `scrypt:` line from `npm run admin:hash`. Also keys the hashed network addresses in the sign-in limits. |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-visible | Existing FITX Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-visible | Existing Supabase publishable key. |
| `SUPABASE_SECRET_KEY` | Server only, Sensitive, Production only | Admin's only data access. Never use a `NEXT_PUBLIC_` prefix. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, legacy fallback | Use only if the project has no secret key. Do not set both. |
| `ADMIN_SITE_URL` | Server configuration | Canonical production origin. In production every other host redirects here. |
| `FITX_SITE_URL` | Optional | The customer site, used for password reset links. Default `https://fitnessx.vercel.app`. |
| `FITX_ADMIN_PASSWORD_RESET_EMAILS` | Optional | `on` enables "Send reset email" on Users. Leave it unset until [Password reset emails](#password-reset-emails) is done. |
| `FITX_ADMIN_CSP_REPORT_ONLY` | Optional, emergency switch | `1` turns the Content-Security-Policy into report-only mode. Leave unset. |

## How sign-in and access checks work

1. **Sign-in** (`src/app/login/actions.ts`). The username is matched in lower case. The root's password is checked against `FITX_ADMIN_PASSWORD_HASH`; other operators against their stored scrypt hash (`src/lib/password.ts`: N 2^15, r 8, p 1, 16-byte salt, 64-byte key, compared in constant time). An unknown username still runs one scrypt check, and every failure, whatever the cause, takes 400 to 700 ms and shows the same message.
2. **Limits** (`src/lib/login-guard.ts`). Five failures for one username in 15 minutes lock it for 15 minutes from the fifth, the root included. Attempts during a lock are refused without checking the password and do not extend it. One network address gets at most 20 attempts in 15 minutes. Addresses are stored only as an HMAC; typed usernames only as a SHA-256. Lockouts and address limits are audited.
3. **Sessions** (`src/lib/admin-session.ts`). A successful sign-in creates a new random 32-byte token in the `__Host-fitx_admin` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`). The database keeps only the token's SHA-256. A session ends 12 hours after sign-in, after 60 minutes without use, on sign-out, when its operator is switched off, or when the password changes.
4. **Every request is checked.** Every page, data helper, Server Action and Route Handler calls `requireAdmin(permission)` (`src/lib/admin-auth.ts`): no session goes to `/login`, a role without the permission gets the 403 page, and an operator with a temporary password goes to `/account`. The layout is never the only guard. The proxy only sends requests without the cookie to `/login`; it does no database work.
5. **Database.** Admin reads and writes only on the server with the service key (`src/lib/supabase/admin.ts`). Every write goes through a `fitx_admin_op_*` function that checks the operator's role in Postgres and writes its audit row in the same transaction. All of them are executable by `service_role` only and pin `search_path`.
6. **Browser.** Every response carries a Content-Security-Policy with a fresh nonce: scripts only from Admin itself, no inline styles or eval in production, no framing, forms post only to Admin. Images, video and uploads may also use the Supabase project, and images the exercise catalogue's GitHub source (`raw.githubusercontent.com/yuhonas/free-exercise-db/`).
7. Failed checks are written to the server logs as `[fitx-admin]` lines; emails, IDs, tokens and keys are masked.
8. **No member details in URLs.** The Users search posts its text to a Server Action, which returns to the list with an opaque `s` token (AES-256-GCM under a key derived from the service key, bound to the operator, valid for 30 minutes; `src/lib/people-search.ts`). Emails and phone numbers typed into it never reach request logs or browser history. A plain `?q=` is ignored.

## Password reset emails

Admin asks Supabase to email a member's reset link. FITX's own sign-in callback currently accepts only links that started in the member's own browser (PKCE), and a reset sent from Admin cannot start there, so the button is off until both of these are done:

1. The customer site's `src/app/auth/callback/route.ts` also accepts `token_hash` and `type` parameters and calls `supabase.auth.verifyOtp({ token_hash, type })` before redirecting to `next`.
2. In Supabase, Authentication, Emails, Reset Password, the link becomes `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`.

Then set `FITX_ADMIN_PASSWORD_RESET_EMAILS=on` in the Admin project and redeploy.

## Architecture

```text
admin/
  src/app/login/               Sign-in page and its Server Actions (sign in, sign out)
  src/app/(control)/           The eleven sections and /account; every page and action calls requireAdmin
  src/components/              Shell and section navigation, motion (counters, chart draw-in, section transitions)
  src/lib/                     Guard, sessions, passwords, sign-in limits, operators, roles, CSP, audit writer
  src/lib/data/                Server data access, one module per area; each calls requireAdmin itself
  src/proxy.ts                 Canonical-host redirect, CSP nonce, no-cookie redirect to /login
  scripts/                     admin:hash and the path-based deploy filter for both Vercel projects
  tests/                       node --test suites and local database checks
```

Tech stack: Next.js 16, React 19, TypeScript, Supabase Postgres through the service key, and Lucide icons. Motion is CSS, SVG and the Web Animations API, and nothing moves with reduced motion. Admin has its own `package.json` and `package-lock.json`.

## Local setup

Use Node.js 20 or newer, npm and Git.

```bash
cd admin
npm ci
cp .env.example .env.local
npm run admin:hash   # paste the line into FITX_ADMIN_PASSWORD_HASH in .env.local
npm run dev
```

Open `http://localhost:3100/login`. Local sign-in needs the variables in `.env.local` and the migrations on the database it points at. Never commit `.env.local`.

## Commands and checks

```bash
npm run dev         # local server on port 3100
npm run admin:hash  # make FITX_ADMIN_PASSWORD_HASH
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm test            # node --test: sign-in, sessions, roles parity with SQL, CSP, audit, section actions and rules
npm run build       # production Next.js build
```

`tests/database/run-database-checks.sh [port]` (needs PostgreSQL 15 or newer locally) applies every root migration to a throwaway local database shaped like a Supabase project, runs the Admin migrations a second time, then every `tests/database/*-checks.sql`: roles, the append-only audit log, metrics, row-level security and grants, operators, lockout windows, address limits and the operator write functions. It never touches a real project.

The site serves `robots.txt` disallowing all crawlers and sends `noindex` metadata and `X-Robots-Tag: noindex, nofollow`.

## Two Vercel projects, one repository

Both projects deploy automatically from the same repository. `master` is the production branch, and other branches create Preview deployments.

| | Customer site | Admin |
| --- | --- | --- |
| Vercel project | `fitnessx` | `admin` |
| Root Directory | repository root | `admin` |
| Address | https://fitnessx.vercel.app | `ADMIN_SITE_URL`, for example https://fitnessx-admin.vercel.app |
| Install and build (dashboard settings) | unchanged | `npm ci` and `npm run build` (`next build --webpack`) |
| Ignored Build Step (in Git) | `/vercel.json` | `admin/vercel.json` |
| Server-only secrets | none of Admin's | `SUPABASE_SECRET_KEY` (Production only) |

Root Directory, Production Branch, and the install and build commands are dashboard settings, under Settings → Build and Deployment. Check them once against this table. Do not create a second FITX customer project or change `fitnessx.vercel.app`. Do not add a GitHub Actions deployment workflow either: Vercel's own Git integration handles builds and deployment aliases.

### Automatic deployments and path filters

The ignore commands are stored in Git, one `vercel.json` per project:

| Project | File | Command | Runs in |
| --- | --- | --- | --- |
| `fitnessx` | `/vercel.json` | `node admin/scripts/vercel-ignore.mjs fitx` | repository root |
| `admin` | `admin/vercel.json` | `node scripts/vercel-ignore.mjs admin` | `admin/` |

JSON files cannot hold comments, so the note lives here. Each `vercel.json` contains only `ignoreCommand`. It overrides the **Ignored Build Step** field in that project's dashboard settings and changes nothing else about the build. Vercel reads `vercel.json` from each project's Root Directory, so the root file applies only to `fitnessx` and `admin/vercel.json` only to `admin`.

How the filter decides (exit code 1 builds, exit code 0 skips):

- It compares the commit being deployed with the last successfully deployed commit on that branch (`VERCEL_GIT_PREVIOUS_SHA`). Skipped pushes therefore add up until a relevant change arrives.
- Changes under `admin/` build Admin only. Changes anywhere else build FITX, which lives at the root, so documentation outside `admin/` also builds FITX. Shared paths build both apps: the root `package.json`, `package-lock.json`, `.npmrc` and `tsconfig.base.json`, plus `packages/` and `shared/`.
- A redeploy or promotion of a commit that is already deployed builds, and so does an empty diff. A production build of a branch other than `master` is a promotion, so it builds too.
- Redeploying a Canceled (skipped) deployment is usually skipped again. Vercel compares it with the last Ready deployment, and if no relevant file changed in between, the filter skips it once more. To pick up new environment variables, redeploy the deployment marked Current (status Ready) and untick **Use project's Ignore Build Step** (step 4 of the checklist redeploys this way).
- A branch's first deployment compares with the point where the branch left `master`.
- Vercel clones only the last 10 commits. When the previous commit is older, the filter first fetches that commit, or the branch with more history.
- Any error, missing information, or unknown target builds. The filter skips only when it is sure that nothing relevant changed.
- Setting the project environment variable `FITX_FORCE_BUILD` to `1` makes every deployment of that project build. Because `vercel.json` overrides the dashboard's Ignored Build Step field, this is the switch that needs no code change, for example if the filter ever skips something it should not. Vercel documents only its own system variables for this step, so the first time you rely on it, check that the build log says "FITX_FORCE_BUILD is set". Remove the variable afterwards, or every push builds both apps.

Skipped builds appear as "Canceled" in Vercel. They still count toward Vercel's deployment limits.

## Maintenance

- Review every new database function for RLS, `search_path`, role checks, least privilege, and audit coverage. Keep the role table in `src/lib/roles.ts` and the newest `fitx_admin_role_permissions` (migration `20261121100030`) identical (`tests/roles.test.mjs` compares them).
- Apply only reviewed migrations; never disable existing FITX RLS policies.
- Keep user health and activity details out of Admin lists, account pages and analytics.
- Re-run lint, TypeScript, tests, and the production build after changes. When shared paths or the repository layout change, update `scripts/deploy-filter.mjs` and its tests.
- The root `npm test` also runs `tests/deploy-filter.test.mjs` and `tests/vercel-ignore.test.mjs` without Admin's dependencies installed. Keep the filter scripts and those two test files limited to Node built-ins and `git`; a test enforces this.
- Never commit `.env.local`, Vercel project linkage files, secrets, generated user exports, or screenshots containing personal data.
