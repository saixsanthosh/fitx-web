# FITX Admin

FITX Admin is a private operations console that lives in `/admin` of the `saixsanthosh/fitx-web` repository. It is a separate Next.js application and a separate Vercel project, `admin`. The FITX customer website stays at the repository root in its own Vercel project, `fitnessx` (https://fitnessx.vercel.app).

## Finish the Admin setup (owner checklist)

Nobody can use Admin until these steps are done. They are settings in Vercel and Supabase plus one database update; none needs code. Do them in order.

**Why not `admin.fitx.vercel.app`?** The name `fitx.vercel.app` belongs to a different Vercel account, and Vercel does not give out names under someone else's `.vercel.app` name. Admin therefore gets its own free `.vercel.app` name. The steps below use `fitnessx-admin.vercel.app`. If Vercel says that name is taken, pick another free one, such as `fitx-admin.vercel.app`, and use it everywhere below instead.

1. **Add the new name.** In Vercel, open the **admin** project, then Settings → Domains → Add, and enter `fitnessx-admin.vercel.app` for Production. Wait for the green check, then open https://fitnessx-admin.vercel.app. You should see the FITX Admin sign-in page. Do not continue until it loads.
2. **Set the environment variables.** In the **admin** project, open Settings → Environment Variables and set these for **Production**:
   - `ADMIN_SITE_URL` = `https://fitnessx-admin.vercel.app`. This replaces the old value, `https://admin-one-blond.vercel.app`.
   - `SUPABASE_SECRET_KEY` = a secret key from Supabase → Project Settings → API Keys → Secret keys. Create one named `fitx-admin` if none exists. In Vercel, tick **Sensitive** and choose **Production** only, not Preview or Development. Never give it a name that starts with `NEXT_PUBLIC_`.
   - `FITX_ADMIN_ALLOWED_EMAILS` = the Google email address you will sign in with. Separate several addresses with commas.
   - Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are already there.
3. **Check three Supabase settings.**
   - Authentication → URL Configuration → Redirect URLs → Add URL: `https://fitnessx-admin.vercel.app/auth/callback`. Leave the Site URL and the existing FITX entries as they are.
   - Authentication → Sign In / Providers: **Google** is enabled. Admin signs in with Google only.
   - Authentication → Multi-Factor: **Authenticator app (TOTP)** is enabled. It is on by default; Admin requires it.
4. **Update the database.** Admin's tables and functions are in seven files, `supabase/migrations/20261118180000_…` to `20261118180006_…` (listed in [Database migrations](#database-migrations)). The coordinating Claude session applies them in that order through the Supabase connector once you give your OK. Each file is safe to run again, and the first one creates the original Admin tables if they are missing.
5. **Redeploy Admin** so it picks up the new variables. In the **admin** project, open Deployments and find the Production deployment marked **Current**, with the status Ready. Do not choose a row marked Canceled: redeploying a skipped deployment is usually skipped again, so the new variables would never reach a build. Choose ⋯ → Redeploy, untick **Use project's Ignore Build Step** in the dialog, and confirm. Unticking it makes Vercel build no matter which files changed. A later push that changes Admin also picks up the variables.
6. **Make yourself the first super-admin.** Sign in to FITX at https://fitnessx.vercel.app once with the same Google account, so that the account exists. Then run the SQL in [First super-admin](#first-super-admin) with your email address. The coordinating session can run it for you through the connector once you give your OK.
7. **Sign in and set up your authenticator app** at https://fitnessx-admin.vercel.app. The first time, Admin asks you to scan a QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar) and enter its six-digit code. After that, Admin asks for a code at every sign-in, and a session ends 12 hours after you signed in with Google. Each code you enter also signs that Google account out of the FITX app on every device; see [One Google account or two](#one-google-account-or-two) before you choose which account to use.

After the switch, production visits to `admin-one-blond.vercel.app`, or to any other Admin address, are sent to `ADMIN_SITE_URL` automatically, so the old name keeps working as a shortcut. Once you have signed in on the new name, you can remove the old `https://admin-one-blond.vercel.app/auth/callback` entry from the Supabase Redirect URLs.

If Admin stops loading after step 5 (for example, every page redirects to an address that does not open), set `ADMIN_SITE_URL` back to `https://admin-one-blond.vercel.app` and redeploy as in step 5. Then check step 1 again.

### If sign-in does not work

| What you see | What to check |
| --- | --- |
| Admin sign-in is not configured on this environment yet. | Step 2: `ADMIN_SITE_URL`, the two public Supabase variables and `FITX_ADMIN_ALLOWED_EMAILS` must all be set. Then redeploy as in step 5. |
| Server data access is not configured. | Step 2: `SUPABASE_SECRET_KEY` is missing in this environment. Then redeploy as in step 5. Preview deployments show this on purpose, because the key is Production-only. |
| Google sign-in could not start. | Step 3: the redirect URL, and whether the Google provider is enabled. This also appears when the Google window is cancelled. |
| This Google account does not have FITX Admin access. | The Google email must be on `FITX_ADMIN_ALLOWED_EMAILS` (step 2) and have an active membership (step 6). |
| Admin access is not initialized yet. | The Admin tables are missing: step 4. |
| Your Admin session reached its 12-hour limit. | Expected. Sign in again. |
| The FITX app signed me out after I signed in to Admin. | Expected when one Google account is used for both: see [One Google account or two](#one-google-account-or-two). Sign in to FITX again. |
| Your role does not include this page. | Your role does not cover that area; see [Roles](#roles). A super-admin can change it on the Access screen. |

Vercel → **admin** → Logs shows a `[fitx-admin]` line for each refused or failed check, saying which check failed. Emails, user IDs, tokens and keys are masked in these lines.

### Lost your phone?

1. If the lost phone is still signed in to your Google account, sign it out first (Google Account → Security → Your devices). Once the authenticator is gone, a Google sign-in alone reaches the set-up page, so whoever holds a signed-in phone could otherwise set one up before you do.
2. Another super-admin opens Access and chooses **Reset authenticator** for you. Admin records the request, removes the authenticator and signs your account out on every device, the lost phone included (the FITX app too).
3. Sign in to Admin with Google again and set up the new authenticator.

If you are the only super-admin, the coordinating session can do the same through the Supabase connector with your OK: `delete from auth.mfa_factors where user_id = '<your account ID>'; delete from auth.sessions where user_id = '<your account ID>';`. Then sign in again and set up the new authenticator.

### One Google account or two

FITX and Admin use the same Supabase project, so one Google account is one FITX account in both. When an authenticator code is verified, Supabase ends every other session of that account that has not passed a code (see `mfa.verify` in the supabase-js reference). FITX app sessions never pass a code, so they end too:

- **One account for both.** Every Admin sign-in, at most once every 12 hours, signs you out of the FITX app on your phone and your other devices. Pages that check with Supabase notice straight away; the rest notice when the current access token runs out, within an hour by default. You then sign in to FITX again as usual, without a code. Your own FITX use is also left out of the metrics, because Admin team accounts are left out of every number.
- **A separate Google account for Admin (recommended if you use FITX day to day).** Your everyday FITX account is never signed out by Admin and stays in the metrics. To set it up, sign in to FITX once with the new account and put its email on `FITX_ADMIN_ALLOWED_EMAILS`. Then make it a super-admin, on the Access screen if you already use Admin, or otherwise with the SQL in [First super-admin](#first-super-admin) using the new email, and set up its authenticator. If your everyday account was already a member, set it to inactive on Access afterwards and take its email off the allowlist.

Everyone you add to Admin faces the same choice, so tell new members before they set up their authenticator.

## What Admin does

- **Overview:** counts with their exact definitions (see [Metrics](#metrics)): accounts, fresh sign-ins in the last 24 hours, 7 and 30 days, active accounts from real app activity, workout and meal volume, published exercises, and help requests that need attention.
- **Reports:** daily trends for the last 14, 30 or 90 days (new accounts, active accounts, workouts completed, meals logged), with the numbers also shown as a table.
- **People:** search accounts by part of an email or by account ID, and open an account to see account details only: email, sign-in methods, creation and last sign-in time, confirmation, authenticator and suspension status. No profile, workout, meal, body or other health data. Depending on role: sign the person out everywhere, send a password reset email (see [Password reset emails](#password-reset-emails)), suspend or lift a suspension, and delete the account. Views and actions are recorded in the audit log, and account actions record the request before they run; if a view could not be recorded, the page says so. Deleting an account also removes its private photos, subfolders included, and is refused while Razorpay is still billing a live subscription for it.
- **Support:** the queue of Help requests sent from the FITX app's Help page, with status tabs and counts, category and "assigned to me" filters, the conversation, replies as "FITX team", status, priority and assignee. Replies appear on the person's Help page; no email is sent.
- **Training:** publish or hide exercises in `exercise_library` (up to 100 per search). Exercise editing and the food catalogue come later.
- **Announcements:** write a message, preview it, publish it for a time window, return it to draft or archive it. Signed-in people see the newest one at the top of the FITX app and can dismiss it. The list shows how many accounts dismissed each one; nothing tracks views.
- **Access:** grant or change access by email, five roles, lower an existing member's access only with a confirmation (on the grant form too), reset a member's authenticator (recorded before it runs, and it signs the account out on every device), and see whether each member is on `FITX_ADMIN_ALLOWED_EMAILS` and has an authenticator.
- **Audit log:** every privileged action, sign-in, refusal and authenticator event, filtered by action, actor (email or ID), resource and IST date range, 50 per page. Super-admins can export the filtered rows as CSV (up to 5,000 rows); the export is itself recorded. Rows can be added but never changed or deleted.
- **Billing:** owned by the payments stream (Phase 11). **Nutrition:** explains that no admin food catalogue exists yet. **Settings:** shows which environment variables are set, never their values.

Admin has no public registration. Every page, data read and change checks the signed-in account, the email allowlist, membership, role, the authenticator code and the session age on the server; the database functions check the role again.

## Roles

| Role | May use |
| --- | --- |
| Super-admin | Everything: Admin access, account deletion, audit export, plus all of the below. |
| Admin | Overview, Reports, People (including suspend), Support, Training, Announcements, Audit log, Access (read-only), Settings, Billing. |
| Support agent | Overview, People (sign out everywhere, password reset), Support. |
| Content editor | Overview, Training, Announcements. |
| Viewer | Overview and Reports, read-only. |

The table lives in two places that a test keeps identical: `src/lib/roles.ts` and `fitx_admin_role_permissions` in migration `20261118180001`. Admin team accounts can only be suspended, signed out or changed by a super-admin, and nobody can act on their own account from People. A deletion needs the person's Admin membership set to Inactive first; the inactive membership is deleted with the account, and the audit log keeps the account ID on the rows it wrote.

## Metrics

| Number | Exactly what it counts |
| --- | --- |
| Registered accounts | Supabase Auth accounts that are not deleted, not anonymous and not Admin team members. Every number below leaves out the same accounts. |
| With a confirmed email | Of those, accounts whose email is confirmed. |
| New in 7 / 30 days | Accounts created in the window. |
| Signed in in 24 hours / 7 / 30 days | Accounts whose most recent **fresh** sign-in (Auth `last_sign_in_at`) is in the window. Staying signed in does not create a new sign-in, so regular users are undercounted. |
| Active in 24 hours / 7 / 30 days | Accounts that logged a workout session, workout set, meal, water entry, body measurement or goal progress entry in the window. Signing in alone does not count. |
| Workouts completed | Workout sessions with status completed, counted on the day they started. |
| Meals logged | Meal entries created in the window. |
| Trend days | Calendar days in India Standard Time. |

All numbers come from `fitx_admin_metrics()` and `fitx_admin_daily_trends()` (migration `20261118180003`), which return counts only. Until that migration is applied, the Overview shows the original five counts and says so.

## Database migrations

All files are in the root `supabase/migrations/` folder. Apply them in this order. Each is written to run safely more than once.

| File | What it does | Until it is applied |
| --- | --- | --- |
| `20261118180000_fitx_admin_control_plane.sql` | The original Admin tables and functions, created only if missing. | Admin cannot sign anyone in ("Admin access is not initialized yet"). |
| `20261118180001_fitx_admin_roles.sql` | Five roles, one permission check used by every function, grant by email, member list with emails. | Only Admin and Super-admin exist, and Access grants by account ID. |
| `20261118180002_fitx_admin_audit_log.sql` | Makes the audit log append-only (a trigger blocks every edit and delete, and rows keep the actor's account ID after that account is deleted) and adds `fitx_admin_log_event`. | Sign-in and view events are not recorded (People pages say so), and People actions and authenticator resets refuse to run because they must be recorded first. |
| `20261118180003_fitx_admin_metrics.sql` | The defined metrics and daily trends. | Overview shows the original five counts; Reports waits. |
| `20261118180004_fitx_admin_people.sql` | People search and "sign out everywhere". | People pages through all accounts without search; signing out everywhere is unavailable. |
| `20261118180005_fitx_support.sql` | Help requests and replies, row-level security, rate limits (3 requests an hour and 10 a day per account, 10 replies an hour), and the audited support functions. | The FITX Help page shows the support email instead of the form; the Support queue waits. |
| `20261118180006_fitx_announcements.sql` | Announcements and dismissals, with row-level security and audited functions. | The FITX banner stays hidden; Announcements waits. |

Apply only these seven root files. The old draft `admin/supabase/migrations/20261116000000_fitx_admin_control_plane.sql` has been removed: `20261118180000` replaces it, and running the draft after `20261118180001` would put back its two-role access functions. If the draft was ever applied by hand, the seven files still apply cleanly on top of it.

## Environment variables

Set these in a local `.env.local` or in the **admin Vercel project only**. `.env.example` contains placeholders, not working credentials.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-visible | Existing FITX Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-visible | Existing Supabase publishable key, used for the user session. |
| `SUPABASE_SECRET_KEY` | Server only, Sensitive, Production only | Preferred key for Admin data access, membership checks, and the Auth Admin API. Never use a `NEXT_PUBLIC_` prefix. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, legacy fallback | Use only if the project has no secret key. Do not set both. |
| `ADMIN_SITE_URL` | Server configuration | Canonical production origin, for example `https://fitnessx-admin.vercel.app`. Google sign-in returns here, and in production every other host redirects here. |
| `FITX_ADMIN_ALLOWED_EMAILS` | Server configuration | Comma-separated Google emails allowed into Admin. Checked after Google sign-in against the account's verified Google email, and again on every request. Membership is still required. |
| `FITX_SITE_URL` | Optional | The customer site, used for password reset links. Default `https://fitnessx.vercel.app`. |
| `FITX_ADMIN_PASSWORD_RESET_EMAILS` | Optional | `on` enables the "Send reset email" button. Leave it unset until [Password reset emails](#password-reset-emails) is done. |
| `FITX_ADMIN_CSP_REPORT_ONLY` | Optional, emergency switch | `1` turns the Content-Security-Policy into report-only mode without a code change, if it ever blocks something it should not. Leave unset. |

Do not add Supabase service or secret keys to frontend code, screenshots, logs, or source control. Never copy a key from FITX into the public client key field.

Vercel supplies `VERCEL_ENV` and `VERCEL_URL`. Preview deployments use their own deployment URL for the sign-in callback, while production uses `ADMIN_SITE_URL`. Keep the secret key out of Preview. Preview sign-in then shows "Server data access is not configured", which is intended.

## How sign-in and access checks work

1. Admin signs in with Google through the existing FITX Supabase project, and the Google-to-Supabase callback is unchanged. The email typed on the form only pre-selects the account in Google. Every valid email gets the same response, so the form never reveals who is approved.
2. After Google returns, `/auth/callback` exchanges the code and then checks on the server, in this order:
   - the account's email is confirmed and belongs to a verified Google identity on the same account;
   - that email, in any letter case, is on `FITX_ADMIN_ALLOWED_EMAILS`;
   - the account has an active membership in `fitx_admin_members`, read with the server-only key.

   If any check fails, Admin signs that browser out, records the refusal and its reason, and shows the same "no access" message.
3. **Authenticator (Supabase AAL2).** Every console page then requires a verified authenticator app. Without one, Admin opens the set-up page; with one, it asks for the current code once per sign-in. Only a session raised to AAL2 by that code can use the console. Verifying a code also makes Supabase end the account's other sessions below AAL2, which includes its FITX app sessions on every device (see [One Google account or two](#one-google-account-or-two)).
4. **Session age.** A session ends 12 hours after its Google sign-in, however active it is (`src/lib/session-policy.ts`). Admin then signs that browser out and asks for a fresh sign-in.
5. **Every request is checked.** Every page, every data helper in `src/lib/data/` and every Server Action calls `requireAdmin(permission)`, which repeats the allowlist, membership, role, authenticator and session-age checks. The layout is never the only guard, and the navigation shows only the pages a role allows. To remove someone's access, set their membership to inactive on Access, which takes effect on their next page load, and remove their email from the allowlist.
6. Signing out, or being refused, ends only that Admin browser session (`signOut({ scope: "local" })`), not the person's FITX app sessions. Entering an authenticator code is the step that does end them (point 3).
7. **Database.** RLS is enabled on every Admin and support table. Functions that act for an admin (`p_actor_id`) are executable by `service_role` only, pin `search_path`, and check the actor's role again in Postgres. A test checks these rules for every Phase 10 migration.
8. **Browser.** Every response carries a Content-Security-Policy with a fresh nonce: scripts only from Admin itself, no inline styles or eval in production, no framing, and form posts only to Admin, Supabase and Google. In production, a request on any host other than `ADMIN_SITE_URL` is redirected there first, with a temporary 307 redirect.
9. Failed checks and queries are written to the server logs as `[fitx-admin]` lines with error codes and short messages. Emails, user IDs, tokens and keys are masked.

## Password reset emails

Admin asks Supabase to email the reset link. FITX's own sign-in callback currently accepts only links that started in the person's own browser (PKCE), and a reset sent from Admin cannot start there, so the button is off until both of these are done:

1. The customer site's `src/app/auth/callback/route.ts` also accepts `token_hash` and `type` parameters and calls `supabase.auth.verifyOtp({ token_hash, type })` before redirecting to `next` (the coordinating session owns that file).
2. In Supabase → Authentication → Emails → Reset Password, the link becomes `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`. This also keeps the existing "Forgot password" page working.

Then set `FITX_ADMIN_PASSWORD_RESET_EMAILS=on` in the Admin project and redeploy. Supabase's built-in email sender allows only a few emails an hour; a custom SMTP server raises that.

## Help page and announcements in the FITX app

These customer-side pieces live in the root app; the coordinating session wires them in:

- **Help page:** `src/app/(dashboard)/help/page.tsx` with `src/components/support/*` and the API routes `src/app/api/support/route.ts` and `src/app/api/support/reply/route.ts`. Add `"/help"` to `PRIVATE_ROOTS` in `src/proxy.ts`; the page also sends signed-out visitors to sign in on its own. Link to it as "Help and feedback" with the `CircleHelp` icon: in `src/config/navigation.ts` once the Phase 2 shell lands (one entry reaches the sidebar, the tablet rail and the phone's More sheet), otherwise in `Sidebar.tsx` and the More menu, and from Settings. A link can carry the page the person came from: `/help?from=/workouts`.
- **Announcements:** `src/components/announcements/AnnouncementBanner.tsx`. Mount it once in `src/app/(dashboard)/layout.tsx`, directly under `<WorkspaceHeader />` and above `<main>`. It renders nothing when there is no announcement, when signed out, or before migration `20261118180006` is applied.

## First super-admin

After the migrations (step 4) and once your Google account exists in FITX, run this in the Supabase SQL Editor. Replace `owner@example.com` with your exact Google email; the statement stops without changing anything unless exactly one account has that email.

```sql
do $$
declare
  owner_id uuid;
begin
  select id into strict owner_id
  from auth.users
  where lower(email) = lower('owner@example.com');

  insert into public.fitx_admin_members (user_id, role, is_active, created_by)
  values (owner_id, 'super_admin', true, owner_id)
  on conflict (user_id) do update
    set role = 'super_admin', is_active = true, updated_at = now();

  insert into public.fitx_admin_audit_logs (actor_id, action, resource_type, resource_id, details)
  values (owner_id, 'admin_member_bootstrapped', 'admin_member', owner_id::text,
    jsonb_build_object('role', 'super_admin', 'is_active', true));
end;
$$;
```

To confirm it worked, run the following. It should return one row with `super_admin`, `true`, and your email.

```sql
select m.role, m.is_active, u.email
from public.fitx_admin_members m
join auth.users u on u.id = m.user_id;
```

This owner-only bootstrap avoids a public "first user becomes admin" race. Later role changes belong on the protected Access screen. The email must also be on `FITX_ADMIN_ALLOWED_EMAILS`, or the sign-in is refused before membership is checked.

## Architecture

```text
admin/
  src/app/                     Pages, MFA screens, OAuth callback and session expiry, Server Actions, audit CSV route
  src/components/              Shell and navigation, forms, trend chart, data states
  src/lib/                     Access checks, roles, session policy, CSP, audit writer, logging, IST times
  src/lib/data/                Server data access, one module per area; each calls requireAdmin itself
  src/proxy.ts                 Canonical-host redirect, CSP nonce, Supabase session refresh
  scripts/                     Path-based deploy filter for both Vercel projects
  tests/                       node --test suites and local database checks
  vercel.json                  Admin project's Ignored Build Step
```

Tech stack: Next.js 16, React 19, TypeScript, Supabase Auth and Postgres, `@supabase/ssr`, and Lucide icons. Admin has its own `package.json` and `package-lock.json`, so Vercel installs and builds it from the `admin` Root Directory independently of the customer site.

## Local setup

Use Node.js 20 or newer, npm and Git.

```bash
cd admin
npm ci
cp .env.example .env.local
# Fill in .env.local from your password manager. Never commit it.
npm run dev
```

Open `http://localhost:3100`. Local sign-in needs the same setup as production: the variables in `.env.local`, `http://localhost:3100/auth/callback` in the Supabase Redirect URLs, the migrations, an active membership and an authenticator app. The customer app keeps its own `.env.local` at the repository root.

## Commands and checks

```bash
npm run dev        # local server on port 3100
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # node --test: deploy filter, roles parity with SQL, session and CSP rules, audit, content and migration checks
npm run build      # production Next.js build
npm start          # run the production build on port 3100
```

Before applying migrations to the real project, `tests/database/run-database-checks.sh` (from `admin/`, needs PostgreSQL 15 or newer installed locally) applies every root migration to a throwaway local database, shaped like a Supabase project by the repository's shared stand-in (`tests/support/supabase-stub.sql`; a migration that needs pg_cron is skipped when the local PostgreSQL lacks it), then runs the Phase 10 migrations a second time and checks roles, the append-only audit log, metric definitions, search, rate limits, row-level security and column grants. It never touches a real project.

The site serves `robots.txt` disallowing all crawlers, sends `noindex` metadata, and sends `X-Robots-Tag: noindex, nofollow`. It is a private console, not public SEO content.

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
- Redeploying a Canceled (skipped) deployment is usually skipped again. Vercel compares it with the last Ready deployment, and if no relevant file changed in between, the filter skips it once more. To pick up new environment variables, redeploy the deployment marked Current (status Ready) and untick **Use project's Ignore Build Step**, as in step 5 of the checklist.
- A branch's first deployment compares with the point where the branch left `master`.
- Vercel clones only the last 10 commits. When the previous commit is older, the filter first fetches that commit, or the branch with more history.
- Any error, missing information, or unknown target builds. The filter skips only when it is sure that nothing relevant changed.
- Setting the project environment variable `FITX_FORCE_BUILD` to `1` makes every deployment of that project build. Because `vercel.json` overrides the dashboard's Ignored Build Step field, this is the switch that needs no code change, for example if the filter ever skips something it should not. Vercel documents only its own system variables for this step, so the first time you rely on it, check that the build log says "FITX_FORCE_BUILD is set". Remove the variable afterwards, or every push builds both apps.

Skipped builds appear as "Canceled" in Vercel. They still count toward Vercel's deployment limits.

## Maintenance

- Review every new database function for RLS, `search_path`, role checks, least privilege, and audit coverage. Keep the role table in `src/lib/roles.ts` and migration `20261118180001` identical (a test compares them).
- Apply only reviewed migrations; never disable existing FITX RLS policies.
- Keep user health and activity details out of Admin lists, account pages and analytics.
- Add billing, the food catalogue and exercise editing only after their authoritative source and permissions are defined.
- Re-run lint, TypeScript, tests, and the production build after changes. When shared paths or the repository layout change, update `scripts/deploy-filter.mjs` and its tests.
- The root `npm test` also runs `tests/deploy-filter.test.mjs` and `tests/vercel-ignore.test.mjs` without Admin's dependencies installed. Keep the filter scripts and those two test files limited to Node built-ins and `git`; a test enforces this.
- Never commit `.env.local`, Vercel project linkage files, secrets, generated user exports, or screenshots containing personal data.
