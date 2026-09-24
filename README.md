# FITX — Stronger Everyday

A personal fitness app with Supabase-backed authentication and a Postgres schema protected by row-level security.

**Designed & Developed by B SAI SANTHOSH** · ✉ saisanthosh102030@gmail.com · ☎ +91 8925075593

---

## Tech Stack

- **Frontend:** Next.js 16 (App Router) + TypeScript + React
- **Styling:** TailwindCSS v4 + custom CSS variables + Framer Motion
- **Icons:** Lucide React
- **Canvas:** HTML Canvas (fire particles, confetti)
- **API:** Next.js Route Handlers (`/api/v1/*`)
- **Auth and database:** Supabase Auth + PostgreSQL + Row Level Security

## Getting Started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

For local Supabase authentication, copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project. Keep service-role and database credentials in server-side environment variables only; never add them to client code or commit them.

## White-Label Rebranding

Change **one file** — `src/config/brand.ts` — to rebrand the entire site:

```ts
export const BRAND = {
  name: "FITX",
  tagline: "Stronger Everyday",
  logoUrl: "/images/logo.png",
  primaryColor: "#E8160C",
  accentColor: "#D4A040",
  // ...colors, creator info, SEO meta
};
```

Every color token, name, and logo across the site reads from this config (and the CSS variables in `src/app/globals.css`).

## Pages (24)

**Marketing:** `/` (landing) · `/features` · `/pricing` · `/for-gyms` · `/about`
**Auth:** `/signin` · `/signup` · `/verify` · `/forgot-password` · `/onboarding` (7-step wizard)
**App:** `/dashboard` · `/exercises` · `/exercises/[id]` · `/nutrition` · `/tasks` · `/workouts` · `/workouts/active` · `/progress` · `/ai-coach` · `/social` · `/achievements` · `/profile` · `/settings` · `/subscription` · `/admin` (gym dashboard)

## API (`/api/v1`)

| Endpoint | Methods | Description |
|---|---|---|
| `/auth/login` | POST | Issue auth token |
| `/users/me` | GET, PATCH | Current user profile |
| `/exercises` | GET | List/filter/paginate exercises |
| `/exercises/[id]` | GET | Single exercise |
| `/workouts` | GET, POST | Workout history / log workout |
| `/nutrition` | GET, POST | Diary totals / log food |
| `/tasks` | GET, POST | Tasks / create task |
| `/progress` | GET | Progress analytics |
| `/social` | GET | Feed + leaderboard |
| `/challenges` | GET | Group challenges |
| `/programs` | GET | Workout programs |
| `/ai/chat` | POST | Prototype response endpoint; no AI provider is configured |
| `/gym-admin` | GET | Members + revenue |

**Response format:**
```json
{ "success": true, "data": ..., "meta": { "page": 1, "total": 45 } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

## Supabase

The initial database schema is in `supabase/migrations/0001_init.sql`. It creates user profiles, workouts, meals, tasks, habits, and body metrics with row-level security policies. The FITX Vercel project uses a Supabase resource provisioned through the Vercel Marketplace integration. Apply future database changes as new migrations under `supabase/migrations/`.

The browser and server Supabase clients use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Supabase service-role keys and database passwords must remain server-only and must not be committed.

## Project Structure

```
src/
  config/brand.ts        # white-label config
  app/
    (marketing)/         # public site
    (auth)/              # auth + onboarding
    (dashboard)/         # logged-in app
    api/v1/              # backend route handlers
  components/
    ui/                  # FitxButton, FitxCard, MacroRing, AchievementBadge, ...
    layout/              # Navbar, Sidebar, BottomNav, Footer
    marketing/           # hero, features grid, testimonials, pricing
  data/                  # exercises + seed data
  lib/                   # utils, api helpers
  types/                 # shared TypeScript types
```
