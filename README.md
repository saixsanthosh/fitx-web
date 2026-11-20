# FITX

FITX is a fitness app for planning and logging workouts, tracking food and water, and following progress, with an AI coach. It runs at https://fitnessx.vercel.app. The private Admin console is a separate app in `admin/`.

## Folder map

```text
src/                 The FITX app (Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4)
  app/               Routes: (marketing) landing, (auth) sign-in, (dashboard) the signed-in app, api/
  components/        UI by area (home, workouts, nutrition, coach, brand intro, ...)
  lib/               Data access, domain rules, Supabase clients, AI router, billing
  data/              Static data and media manifests (sources in src/data/DATA_SOURCES.md)
  proxy.ts           Request proxy: session refresh and the platform gate
admin/               FITX Admin, its own Next.js app and Vercel project (see admin/README.md)
supabase/migrations/ Every database change, applied in file-name order
tests/               node:test suites; tests/integration needs local PostgreSQL; tests/e2e is the browser run
scripts/
  checks/            Colour-token and contrast checks (npm run check:colors, check:contrast)
  catalog/           Exercise catalogue and programme builders, media mirror, local migration check
  media/             AI image generator for landing and Home workout pictures, with its prompt files
  food/              USDA FoodData Central importers for the food catalogue seed
  brand/             Regenerates the logo PNGs and favicon
public/              Static files: brand marks and intro film, media, pose models
docs/runbooks/       Owner runbooks: database changes, Razorpay billing
```

## Run locally

Needs Node.js 20 or newer.

```bash
npm ci
cp .env.example .env.local   # fill in the Supabase URL and publishable key at least
npm run dev                  # http://localhost:3000
```

Admin runs on its own:

```bash
cd admin
npm ci
cp .env.example .env.local
npm run admin:hash           # paste the printed line into FITX_ADMIN_PASSWORD_HASH
npm run dev                  # http://localhost:3100/login
```

## Checks and tests

```bash
npm run lint
npm run typecheck
npx tsc --noEmit -p tsconfig.test.json   # type-checks the tests
npm test                                 # every unit and integration suite
npm run check:colors                     # no hard-coded colours outside the theme tokens
npm run check:contrast                   # text contrast in light, dark and system themes
npm run build
npm run test:e2e -- --build              # signed-in browser run on a throwaway database
```

The integration tests and the e2e run start a throwaway local PostgreSQL 17 (server binaries on `PATH`); without it those suites are skipped. The e2e run also needs Google Chrome and `playwright-core` (see the top of `tests/e2e/run.mjs`). Nothing in the tests touches a real Supabase project.

Admin: from `admin/`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `bash tests/database/run-database-checks.sh [port]` for its database checks.

## Runbooks and owner setup

- `docs/runbooks/platform-database.md`: every pending database change, its check query and undo, and the Vercel variables for each project.
- `docs/runbooks/billing-razorpay.md`: turning on Razorpay subscriptions.
- `admin/README.md`: the Admin owner checklist, roles, migrations and deployment.
- `docs/runbooks/ai-coach.md`: the AI coach providers and switches.

## Environment variables

`.env.example` lists every variable with a note; copy it to `.env.local`. Never commit `.env.local` or put a server key in a `NEXT_PUBLIC_` variable.

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`), and server-only `SUPABASE_SECRET_KEY`.
- Site: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APPLE_OAUTH_ENABLED`, `GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_FITX_INSTAGRAM_URL`, `NEXT_PUBLIC_FITX_CONTACT_EMAIL`.
- Food search: `USDA_API_KEY`, `OPEN_FOOD_FACTS_USER_AGENT`.
- AI coach: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `AI_COACH_ENABLED`, `AI_GEMINI_WITH_MEMBER_DATA`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`.
- Billing: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CRON_SECRET`, `BILLING_TEST_EMAILS`.
- Activity map: `NEXT_PUBLIC_ACTIVITY_MAP_STYLE_LIGHT`, `NEXT_PUBLIC_ACTIVITY_MAP_STYLE_DARK`.

Admin's variables are in `admin/.env.example` and `admin/README.md`.

## Deployment

Pushing to `master` deploys both Vercel projects, `fitnessx` (repository root) and `admin` (`admin/`). A path filter (`admin/scripts/vercel-ignore.mjs`, set in each `vercel.json`) skips a project's build when none of its files changed. Database migrations are applied separately, by following the database runbook.
