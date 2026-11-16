# FITX Admin

FITX Admin is a private operations console that lives in `/admin` of the existing `saixsanthosh/fitx-web` repository. It is a separate Next.js application and Vercel project; the FITX customer website remains at the repository root and keeps its current project and URL.

## Current capabilities and data boundaries

- **Overview and reports:** server-side aggregate counts from Supabase Auth, completed workout sessions, the shared exercise catalog, and meal-log volume. The reviewed SQL function returns counts only.
- **People:** recent Supabase Auth accounts, account creation and last sign-in timestamps, and Auth suspension state. The table deliberately omits fitness-profile, workout, and nutrition details.
- **Training:** reads the existing `exercise_library` and can publish or hide an exercise. Mutations use a database function that checks active Admin membership and writes an audit record in the same transaction.
- **Access control:** lists roles and lets an active super-admin grant, change, or disable Admin memberships. Database functions validate the actor, prevent client-side role escalation, retain an active super-admin, and write an audit record atomically.
- **Audit log:** shows the recent actor, action, resource, and time without exposing event detail payloads.
- **Nutrition, billing, support, and notifications:** these screens explain which real data source is absent. The current FITX schema has personal meal logs but no admin food catalog, payment/refund ledger, support queue, or notification-delivery records. The app does not invent records or revenue.

The Admin application is not a replacement for the FITX user app. It contains no public registration form and all protected routes re-check the authenticated Supabase user and active membership on the server.

## Architecture

```text
admin/
  src/app/                 Next.js App Router pages, OAuth callback, server actions
  src/components/          FITX mark, navigation, data states, admin shell
  src/lib/                 Supabase SSR clients, role checks, and server data access
  scripts/vercel-ignore.mjs  Path-aware Git deployment filter
  supabase/migrations/     Reviewed additive Admin schema and privileged RPCs
  tests/                   Deployment-filter tests
```

Tech stack: Next.js 16, React 19, TypeScript, Supabase Auth/Postgres, `@supabase/ssr`, and Lucide icons. Admin uses its own `package.json` and `package-lock.json` so Vercel can install and build from the Admin root directory independently.

## Local setup

Use Node.js 20 or newer and npm.

```powershell
cd admin
npm ci
Copy-Item .env.example .env.local
# Fill in local values using a private secret manager; do not commit .env.local.
npm run dev
```

Open `http://localhost:3100`. Before a successful Admin login, configure the environment, apply the reviewed schema, and provision at least one active super-admin. The existing root app can continue using its own `.env.local` from the repository root.

## Environment variables

Set these in local `.env.local` or in the **Admin Vercel project only**. `.env.example` contains placeholders, not working credentials.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-visible | Existing FITX Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-visible | Existing Supabase publishable key used for the user session. |
| `SUPABASE_SECRET_KEY` | Server only | Preferred key for admin data access, role checks, and Auth Admin API. Never use a `NEXT_PUBLIC_` prefix. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only, legacy fallback | Use only if the project does not provide a secret key. Do not set both unless migration needs it. |
| `ADMIN_SITE_URL` | Server configuration | Canonical production origin; currently `https://admin-one-blond.vercel.app` until the requested custom domain is accessible. |
| `FITX_ADMIN_ALLOWED_EMAILS` | Server configuration | Comma-separated owner-managed email allowlist for starting Google sign-in. The database membership check runs again after OAuth. |

Do not add Supabase service or secret keys to frontend code, screenshots, logs, or source control. Never copy a key from FITX into the public client key field.

Vercel supplies `VERCEL_ENV` and `VERCEL_URL`. Preview callback URLs use the deployment URL; production uses `ADMIN_SITE_URL`.

## Supabase authentication and authorization

1. Google OAuth continues to use the existing Supabase provider and its original Google-to-Supabase callback. FITX Admin does not replace that callback or change provider credentials.
2. The server-only allowlist prevents arbitrary emails from starting Admin sign-in.
3. The OAuth callback exchanges the code using the existing Supabase SSR session and checks `fitx_admin_members` with the server-only key. Missing, inactive, or unrecognized roles are signed out and denied.
4. Every protected route and mutation calls `requireAdmin()` on the server. Client metadata and hidden form fields are not trusted for authorization.
5. RLS is enabled and forced on the new Admin tables. The only user-session read policy on membership allows a user to read their own row. Privileged RPCs are executable by `service_role` only and validate the actor again in Postgres.
6. `fitx_admin_overview_metrics()` exposes aggregate counts only. Admin operations are audited. Users' health, workout, and individual meal details are not included in the directory or aggregate report output.

### One-time schema and first super-admin setup

The migration in `supabase/migrations/20261116000000_fitx_admin_control_plane.sql` is additive and has been applied to the existing FITX Supabase project. It creates only the Admin tables and privileged functions described above. For a separate Supabase environment, review and apply only this file; do not run a blanket migration command unless every pending root migration has also been reviewed. The production database contains no seeded Admin member.

After the owner account exists in Supabase Auth, the owner must grant the first super-admin directly in the SQL Editor. Replace the placeholder with the exact owner-controlled Google email and verify one Auth account is returned before running:

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
end;
$$;
```

This intentional owner-only bootstrap avoids a public “first user becomes admin” race. Subsequent role changes belong in the protected Access screen.

In Supabase Auth URL Configuration, preserve the current FITX Site URL and redirect settings. The current Admin Vercel project has the generated production origin `https://admin-one-blond.vercel.app`; add `https://admin-one-blond.vercel.app/auth/callback` to the allowed redirect URLs before enabling sign-in. Add a narrowly scoped Preview callback pattern only if Preview sign-in is needed. The requested `admin.fitx.vercel.app` alias could not be attached because the connected Vercel team does not control the `*.fitx.vercel.app` domain. The existing Google OAuth redirect URI remains the Supabase callback shown in the current provider configuration.

## Commands and checks

```powershell
npm run dev        # local server on port 3100
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # isolated deployment-filter tests
npm run build      # production Next.js build
npm start          # run the production build on port 3100
```

The site sends `noindex` metadata and `X-Robots-Tag: noindex, nofollow`; it is a private console, not public SEO content.

## Separate Vercel project

Create or configure the existing repository's separate Vercel project as follows:

- Project name: `admin`
- Git repository: `saixsanthosh/fitx-web`
- Root Directory: `admin`
- Production Branch: `master`
- Framework: Next.js
- Build command: `npm run build` (or Vercel's detected Next.js command)
- Install command: `npm ci`
- Current generated production hostname: `admin-one-blond.vercel.app`
- Requested domain: `admin.fitx.vercel.app`, only after the domain owner grants the connected Vercel team access to `*.fitx.vercel.app`
- Environment variables: add the public Supabase URL and publishable key to Production, Preview, and Development; add server-only secret key, `ADMIN_SITE_URL`, and owner-approved `FITX_ADMIN_ALLOWED_EMAILS` to the environments where Admin access is intended

Do not create a second FITX customer project or change `fitnessx.vercel.app`. If `fitx.vercel.app` is owned by a different Vercel team/account, that domain owner must grant access or configure DNS before `admin.fitx.vercel.app` can be attached. A project can use its generated `.vercel.app` hostname until then.

### Automatic deployments and path filters

Keep Vercel's native Git integration connected to the same repository. Configure the existing FITX project’s **Ignored Build Step** command as:

```text
node admin/scripts/vercel-ignore.mjs fitx
```

Configure the Admin project's command (its working directory is the `admin` root) as:

```text
node scripts/vercel-ignore.mjs admin
```

Each script compares the Vercel previous/current Git SHAs and evaluates additions, changes, deletions, and both sides of renames. It exits successfully to skip only an unrelated app deployment. Shared dependency paths trigger both apps. Missing Git metadata or a diff error fails open and runs the build. Pushes to `master` remain Production deployments, and other branches remain Preview deployments; this filter only prevents irrelevant builds.

Do not add a separate GitHub Actions deployment workflow. Vercel's native Git integration handles builds and deployment aliases.

## Custom domain setup

The Admin project currently serves through its generated Vercel hostname, and `ADMIN_SITE_URL` is set to that origin for Production. The attempted assignment of `admin.fitx.vercel.app` was rejected because the connected team has no access to `*.fitx.vercel.app`. The owner of that Vercel domain must grant the team access or move/verify the domain before it can be assigned. Afterward, change `ADMIN_SITE_URL` and add the new callback URL while keeping the FITX production hostname and Supabase Google-to-Supabase callback unchanged.

## Maintenance

- Review every new database function for RLS, `search_path`, role checks, least privilege, and audit coverage.
- Apply only reviewed Admin migrations; never disable existing FITX RLS policies.
- Keep user health and activity details out of broad Admin lists and analytics.
- Connect billing, support, food catalog, and notifications only after their authoritative source and permissions are defined.
- Re-run lint, TypeScript, tests, and production build after changes. Validate both Vercel projects' deployment filters when shared paths or repository layout change.
- Never commit `.env.local`, Vercel project linkage files, secrets, generated user exports, or screenshots containing personal data.
