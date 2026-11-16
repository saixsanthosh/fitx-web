# FITX AI (server-only)

Every AI feature in FITX goes through this folder. Each module starts with `import "server-only"`, so
none of it (and no key) can reach the browser. Providers are called with plain `fetch`; there is no SDK.

## How a request flows

1. `src/app/api/coach/*` checks the session, that the request came from FITX's own pages, and the body.
2. `coach.ts` checks consent, screens the message for safety (`safety.ts`), takes one request from the
   member's daily limit (`ai_coach_take_quota`), and reads the member's data under their own session
   (`context.ts`, row-level security applies).
3. `router.ts` tries the free models for the task in order (`registry.ts`) and moves on after a 429, a
   5xx, a timeout, a refusal, or a structured answer that is not valid JSON for the expected shape.
4. Plans are checked in code: diet and allergy rules (`diet-rules.ts`), every food matched against
   FITX's food data with the Nutrition search logic (`grounding.ts`), every exercise id checked against
   the exercise library. Then they are saved with their "Add" buttons (`ai_coach_actions`).
5. When nothing answers, the member sees "at capacity" and the request is handed back. Nothing is ever
   made up: no canned replies anywhere.

## Settings (environment variables, server-only)

| Name | What it does |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key. Free tier only while the Google Cloud project has no billing account. |
| `GROQ_API_KEY` | GroqCloud key on the Free plan. |
| `OPENROUTER_API_KEY` | OpenRouter key with no credits; only `:free` models and `openrouter/free` are used. |
| `AI_COACH_ENABLED` | Kill switch. `false` pauses every AI feature at once (the page says "paused"). |
| `AI_ALLOW_PAID` | Leave unset. `true` lets the router use models that are not on a free tier. |
| `AI_GEMINI_MODELS`, `AI_GROQ_MODELS`, `AI_OPENROUTER_MODELS` | Optional comma-separated lists replacing the default models. Models not known to be free are still refused unless `AI_ALLOW_PAID=true`. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local development only, see below. |

Any one key is enough for the coach to work; more keys mean more free capacity and better fallbacks.
Default models (checked on each provider's own pages on 2026-11-16) live only in `registry.ts`.

## Ollama: local development only

Ollama runs a model on your own computer. A Vercel function is a short-lived container without a GPU,
and "localhost" there is not your computer, so FITX never depends on Ollama in production.

To try the coach on your machine without any key:

```bash
ollama pull llama3.2
```

Then put `OLLAMA_BASE_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=llama3.2` in `.env.local` and run
`npm run dev`. The router uses Ollama last, after any free cloud provider that has a key. It is always
ignored on Vercel (production and preview) and for any host other than localhost.

## What the coach sends

A short summary (about 1-2k tokens) rebuilt on every request: age, sex, height, weight trend and target
weight, goal, training setup, injuries or limitations, diet, allergies, budget, 7-day food totals and
most-logged foods, saved food names, 28-day training, personal records, active goals, and how many
workouts and other planner items are planned for the next 7 days. Never a name, email, photo, account
or row id, private notes or exact times. Members who choose "Questions only", and every member under 18,
send no summary. Every prompt still carries the lowest daily calories the coach may suggest
(`calorieFloor`, which depends on sex), and an under-18 member's prompt says they are under 18.
`sharedSummaryLines` in `status.ts` is the consent screen's list; tests keep it and the privacy page in
step with the summary.

A chat message also carries the conversation's recent messages (up to the last 12 questions and
replies together, about 8,000 characters). With "Use my FITX data" off, only messages from after it was last switched off are
sent (`recentTurns`' `since`, from `ai_coach_consents.updated_at`), so replies written from the member's
data are not sent again; switching it off in Coach settings also starts a new conversation.

## Daily limits

Per account and per local day: 30 chat messages and 6 plans by default. Change them in the Supabase
SQL editor, for example `update public.ai_coach_limits set daily_limit = 50 where kind = 'chat';`.
Requests nobody answered are handed back and do not count.

## Tests

`npm test` runs `tests/ai/**` with mocked providers and a fake Supabase. With PostgreSQL installed,
`FITX_TEST_POSTGRES=1 npm test` also applies every migration to a throwaway local Postgres and checks
row-level security, the limits and "Add to My Food Plan" as two members
(`tests/ai/sql/run-local-postgres.sh`). Neither ever calls a real provider or database.
