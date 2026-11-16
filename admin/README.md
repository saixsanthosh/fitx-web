# FITX Admin

FITX Admin is a private operations console that lives in `/admin` of the `saixsanthosh/fitx-web` repository. It is a separate Next.js application and a separate Vercel project, `admin`. The FITX customer website stays at the repository root in its own Vercel project, `fitnessx` (https://fitnessx.vercel.app).

## Finish the Admin setup (owner checklist)

Nobody can use Admin until these steps are done. Each one is a setting in Vercel or Supabase, and none needs code. Do them in order.

**Why not `admin.fitx.vercel.app`?** The name `fitx.vercel.app` belongs to a different Vercel account, and Vercel does not give out names under someone else's `.vercel.app` name. Admin therefore gets its own free `.vercel.app` name. The steps below use `fitnessx-admin.vercel.app`. If Vercel says that name is taken, pick another free one, such as `fitx-admin.vercel.app`, and use it everywhere below instead.

1. **Add the new name.** In Vercel, open the **admin** project, then Settings → Domains → Add, and enter `fitnessx-admin.vercel.app` for Production. Wait for the green check, then open https://fitnessx-admin.vercel.app. You should see the FITX Admin sign-in page. Do not continue until it loads.
2. **Set the environment variables.** In the **admin** project, open Settings → Environment Variables and set these for **Production**:
   - `ADMIN_SITE_URL` = `https://fitnessx-admin.vercel.app`. This replaces the old value, `https://admin-one-blond.vercel.app`.
   - `SUPABASE_SECRET_KEY` = a secret key from Supabase → Project Settings → API Keys → Secret keys. Create one named `fitx-admin` if none exists. In Vercel, tick **Sensitive** and choose **Production** only, not Preview or Development. Never give it a name that starts with `NEXT_PUBLIC_`.
   - `FITX_ADMIN_ALLOWED_EMAILS` = the Google email address you will sign in with. Separate several addresses with commas.
   - Check that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are already there.
3. **Allow the new sign-in address in Supabase.** In Supabase, open Authentication → URL Configuration → Redirect URLs → Add URL, and add `https://fitnessx-admin.vercel.app/auth/callback`. Leave the Site URL and the existing FITX entries as they are. While you are there, check that Authentication → Sign In / Providers → **Google** is enabled, because Admin signs in with Google only.
4. **Redeploy Admin** so it picks up the new variables. In the **admin** project, open Deployments and find the Production deployment marked **Current**, with the status Ready. Do not choose a row marked Canceled: redeploying a skipped deployment is usually skipped again, so the new variables would never reach a build. Choose ⋯ → Redeploy, untick **Use project's Ignore Build Step** in the dialog, and confirm. Unticking it makes Vercel build no matter which files changed. A later push that changes Admin also picks up the variables.
5. **Make yourself the first super-admin.** Sign in to FITX at https://fitnessx.vercel.app once with the same Google account, so that the account exists. Then run the SQL in [First super-admin](#first-super-admin) with your email address. The coordinating Claude session can run it for you through the Supabase connector once you give your OK.
6. **Sign in** at https://fitnessx-admin.vercel.app with that Google account.

After the switch, production visits to `admin-one-blond.vercel.app`, or to any other Admin address, are sent to `ADMIN_SITE_URL` automatically, so the old name keeps working as a shortcut. Once you have signed in on the new name, you can remove the old `https://admin-one-blond.vercel.app/auth/callback` entry from the Supabase Redirect URLs.

If Admin stops loading after step 4 (for example, every page redirects to an address that does not open), set `ADMIN_SITE_URL` back to `https://admin-one-blond.vercel.app` and redeploy as in step 4. Then check step 1 again.

### If sign-in does not work

| Message on the sign-in page | What to check |
| --- | --- |
| Admin sign-in is not configured on this environment yet. | Step 2: `ADMIN_SITE_URL`, the two public Supabase variables and `FITX_ADMIN_ALLOWED_EMAILS` must all be set. Then redeploy as in step 4. |
| Server data access is not configured. | Step 2: `SUPABASE_SECRET_KEY` is missing in this environment. Then redeploy as in step 4. Preview deployments show this on purpose, because the key is Production-only. |
| Google sign-in could not start. | Step 3: the redirect URL, and whether the Google provider is enabled. This also appears when the Google window is cancelled. |
| This Google account does not have FITX Admin access. | The Google email must be on `FITX_ADMIN_ALLOWED_EMAILS` (step 2) and have an active super-admin or admin row (step 5). |
| Admin access is not initialized yet. | The Admin tables are missing. See [First super-admin](#first-super-admin). |

Vercel → **admin** → Logs shows a `[fitx-admin]` line for each refused or failed check, saying which check failed. Emails, user IDs, tokens and keys are masked in these lines.

## Current capabilities and data boundaries

- **Overview and reports:** server-side aggregate counts from Supabase Auth, completed workout sessions, the shared exercise catalog, and meal-log volume. The reviewed SQL function returns counts only. "Active · 30 days" counts accounts that signed in during the last 30 days.
- **People:** recent Supabase Auth accounts, account creation and last sign-in dates (in IST), and Auth suspension state. The table deliberately omits fitness-profile, workout, and nutrition details.
- **Training:** reads the existing `exercise_library` (up to 100 records per search) and can publish or hide an exercise. Mutations use a database function that checks active Admin membership and writes an audit record in the same transaction.
- **Access control:** lists roles and lets an active super-admin grant, change, or disable Admin memberships by Supabase user ID. Database functions validate the actor, prevent client-side role escalation, keep at least one active super-admin, and write an audit record atomically.
- **Audit log:** shows the latest 100 events with actor, action, resource, and time in IST, without exposing event detail payloads.
- **Nutrition, billing, support, and notifications:** these screens explain which real data source is absent. The current FITX schema has personal meal logs but no admin food catalog, payment or refund ledger, support queue, or notification-delivery records. The app does not invent records or revenue.

The Admin application is not a replacement for the FITX user app. It has no public registration form, and every protected page and data read re-checks the signed-in Supabase user, the email allowlist, and active membership on the server.

## Architecture

```text
admin/
  src/app/                     Next.js App Router pages, robots.txt, icon, OAuth callback, Server Actions
  src/components/              FITX mark, navigation, data states, admin shell
  src/lib/                     Supabase SSR clients, access checks, server data access, logging, IST times
  src/proxy.ts                 Canonical-host redirect and Supabase session refresh
  scripts/deploy-filter.mjs    Path rules for both Vercel projects
  scripts/vercel-ignore.mjs    Vercel Ignored Build Step entry point
  supabase/migrations/         Reviewed additive Admin schema and privileged RPCs
  tests/                       node --test suites for the deploy filter and the access helpers
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

Open `http://localhost:3100`. Local sign-in needs the same setup as production: the variables in `.env.local`, `http://localhost:3100/auth/callback` in the Supabase Redirect URLs, the Admin schema, and an active membership. The customer app keeps its own `.env.local` at the repository root.

## Environment variables

Set these in a local `.env.local` or in the **admin Vercel project only**. `.env.example` contains placeholders, not working credentials.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-visible | Existing FITX Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-visible | Existing Supabase publishable key, used for the user session. |
| `SUPABASE_SECRET_KEY` | Server only, Sensitive, Production only | Preferred key for Admin data access, membership checks, and the Auth Admin API. Never use a `NEXT_PUBLIC_` prefix. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, legacy fallback | Use only if the project has no secret key. Do not set both. |
| `ADMIN_SITE_URL` | Server configuration | Canonical production origin, for example `https://fitnessx-admin.vercel.app`. Google sign-in returns here, and in production every other host redirects here. |
| `FITX_ADMIN_ALLOWED_EMAILS` | Server configuration | Comma-separated Google emails allowed into Admin. Checked after Google sign-in against the account's verified Google email, and again on every request. Membership in `fitx_admin_members` is still required. |

Do not add Supabase service or secret keys to frontend code, screenshots, logs, or source control. Never copy a key from FITX into the public client key field.

Vercel supplies `VERCEL_ENV` and `VERCEL_URL`. Preview deployments use their own deployment URL for the sign-in callback, while production uses `ADMIN_SITE_URL`. Keep the secret key out of Preview. Preview sign-in then shows "Server data access is not configured", which is intended.

## How sign-in and access checks work

1. Admin signs in with Google through the existing FITX Supabase project, and the Google-to-Supabase callback is unchanged. The email typed on the form only pre-selects the account in Google. Every valid email gets the same response, so the form never reveals who is approved.
2. After Google returns, `/auth/callback` exchanges the code and then checks on the server, in this order:
   - the account's email is confirmed and belongs to a verified Google identity on the same account;
   - that email, in any letter case, is on `FITX_ADMIN_ALLOWED_EMAILS`;
   - the account has an active `admin` or `super_admin` row in `fitx_admin_members`, read with the server-only key.

   If any check fails, Admin signs that browser out and shows the same "no access" message.
3. Every protected page, every data helper (`src/lib/admin-data.ts` and `src/lib/overview.ts`) and every Server Action calls `requireAdmin()`. It repeats the allowlist and membership checks on each request, so the layout is never the only guard. To remove someone's access, deactivate their membership on the Access screen, which takes effect on their next page load. Also remove their email from the allowlist and redeploy as in step 4 of the checklist.
4. Signing out, or being refused, ends only that Admin browser session (`signOut({ scope: "local" })`). Both apps share one Supabase project, but this does not sign the person out of FITX on their phone or other devices.
5. RLS is enabled and forced on the Admin tables. The only user-session read policy on membership lets a user read their own row. Privileged RPCs are executable by `service_role` only and validate the actor again in Postgres.
6. `fitx_admin_overview_metrics()` exposes aggregate counts only. Admin changes are audited. Users' health, workout, and individual meal details are not included in the directory or the aggregate reports.
7. In production, a request on any host other than `ADMIN_SITE_URL` is redirected there first, with a temporary 307 redirect that browsers do not remember. Google sign-in only works when it starts and finishes on the same host.
8. Failed checks and queries are written to the server logs as `[fitx-admin]` lines with error codes and short messages. Emails, user IDs, tokens, and keys are masked.

## First super-admin

The Admin schema is in `supabase/migrations/20261116000000_fitx_admin_control_plane.sql`. It is additive: it creates only the Admin tables and privileged functions described above, and seeds no Admin member. An earlier version of this README said it had already been applied to production, while the file's own header says not to apply it until the owner approves. Neither can be confirmed from the code. So check first: in Supabase → Table Editor, look for `fitx_admin_members` and `fitx_admin_audit_logs`. If they are missing, the schema must be applied before the SQL below. The coordinating session can apply it through the Supabase connector after your OK. Do not run a blanket migration command unless every pending root migration has also been reviewed.

After your Google account exists in FITX, run this in the Supabase SQL Editor. Replace `owner@example.com` with your exact Google email; the statement stops without changing anything unless exactly one account has that email.

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

## Commands and checks

```bash
npm run dev        # local server on port 3100
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # deploy filter (path rules, and the Vercel command run against temporary Git clones) plus access helpers
npm run build      # production Next.js build
npm start          # run the production build on port 3100
```

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
- Redeploying a Canceled (skipped) deployment is usually skipped again. Vercel compares it with the last Ready deployment, and if no relevant file changed in between, the filter skips it once more. To pick up new environment variables, redeploy the deployment marked Current (status Ready) and untick **Use project's Ignore Build Step**, as in step 4 of the checklist.
- A branch's first deployment compares with the point where the branch left `master`.
- Vercel clones only the last 10 commits. When the previous commit is older, the filter first fetches that commit, or the branch with more history.
- Any error, missing information, or unknown target builds. The filter skips only when it is sure that nothing relevant changed.
- Setting the project environment variable `FITX_FORCE_BUILD` to `1` makes every deployment of that project build. Because `vercel.json` overrides the dashboard's Ignored Build Step field, this is the switch that needs no code change, for example if the filter ever skips something it should not. Vercel documents only its own system variables for this step, so the first time you rely on it, check that the build log says "FITX_FORCE_BUILD is set". Remove the variable afterwards, or every push builds both apps.

Skipped builds appear as "Canceled" in Vercel. They still count toward Vercel's deployment limits.

## Maintenance

- Review every new database function for RLS, `search_path`, role checks, least privilege, and audit coverage.
- Apply only reviewed Admin migrations; never disable existing FITX RLS policies.
- Keep user health and activity details out of broad Admin lists and analytics.
- Connect billing, support, food catalog, and notifications only after their authoritative source and permissions are defined.
- Re-run lint, TypeScript, tests, and the production build after changes. When shared paths or the repository layout change, update `scripts/deploy-filter.mjs` and its tests.
- The root `npm test` also runs `tests/deploy-filter.test.mjs` and `tests/vercel-ignore.test.mjs` without Admin's dependencies installed. Keep the filter scripts and those two test files limited to Node built-ins and `git`; a test enforces this.
- Never commit `.env.local`, Vercel project linkage files, secrets, generated user exports, or screenshots containing personal data.
