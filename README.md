# FITX

FITX is a personal fitness tracker for planning workouts, recording training, tracking meals and water, and following body measurements and goals. The app uses a responsive dark interface with Supabase authentication and per-user data protection.

## Stack

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS 4
- Supabase Auth, Postgres, private Storage, and row-level security
- Open Food Facts for product and barcode nutrition lookups
- Optional USDA FoodData Central search, enabled with a server-only API key

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) to the project URL and public client key. Never place Supabase service-role keys or other private credentials in client-side variables.

Google and Apple sign-in buttons are hidden unless their matching `NEXT_PUBLIC_*_OAUTH_ENABLED` flag is set to `true` and the provider is configured in Supabase. `USDA_API_KEY` is optional and must remain server-side. Food searches use Open Food Facts without it.

## Product areas

- Sign up, sign in, email confirmation, password reset, and a first-run setup flow
- Account profile, training preferences, private profile image uploads
- Personalized or custom workout plans, scheduling, in-session set logging, workout history, and personal records
- Nutrition search, barcode lookup, custom foods, meal logging, daily macros, and water tracking
- Body measurements, progress history, goals, and a weekly planner
- Exercise library with movement instructions, equipment, and alternatives

Every dashboard and API request uses the signed-in user's Supabase session. Personal tables and uploaded profile media are protected by row-level security and per-user storage policies. The exercise catalog is read-only and contains curated reference information.

## Database

Database migrations live in `supabase/migrations/`. The FITX Supabase project uses the initial account/log tables plus additive migrations for plans, workout sessions, nutrition, water, goals, planner events, and private profile media. Apply new changes as migrations; avoid editing an already applied migration.

## Deployment

The `fitx-web` GitHub repository is connected to the FITX Vercel project. Pushing to the production branch starts a Vercel deployment. Configure Supabase public variables in Vercel for Production, Preview, and Development as needed. Optional provider keys should be added only if the matching integration is configured.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
