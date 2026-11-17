# FITX AI (server-only)

Every AI feature in FITX goes through this folder. Each module starts with `import "server-only"`, so
none of it (and no key) can reach the browser. Providers are called with plain `fetch`; there is no SDK.

## How a request flows

1. `src/app/api/coach/*` checks the session, that the request came from FITX's own pages, and the body.
2. `coach.ts` checks consent, screens the message for safety (`safety.ts`), takes one request from the
   member's 24-hour limit (`ai_coach_take_quota`), and reads the member's data under their own session
   (`context.ts`, row-level security applies). A message the screen stopped is marked and never sent
   to a model, in that turn or later ones.
3. `router.ts` tries the free models for the task in order (`registry.ts`) and moves on after a 429, a
   5xx, a timeout, a refusal, or a structured answer that is not valid JSON for the expected shape.
   Structured tasks send their JSON schema to every provider (Gemini `responseSchema`, OpenAI-style
   `json_schema` for Groq's gpt-oss models and OpenRouter) and describe the shape in the prompt too.
   A turn has about 45 seconds for the model and food checks, inside the route's 60.
4. Plans are checked in code: diet and allergy rules (`diet-rules.ts`), every food matched against
   FITX's food data with the Nutrition search logic (`grounding.ts`), the member's calorie minimum,
   every exercise id checked against the exercise library. Then they are saved with their "Add"
   buttons (`ai_coach_actions`).
5. When nothing answers, the member sees "at capacity" and the request is handed back. Nothing is ever
   made up: no canned replies anywhere.

## Safety rules FITX enforces itself

- Self-harm, eating-disorder and emergency messages (English, Hinglish and Devanagari) get FITX's own
  note with help lines instead of a model reply. Every prompt also tells the model what to do for those
  topics in any other language.
- After the eating-disorder note, meal plans and swaps pause for 30 days (`CARE_DAYS`) and no calorie
  targets or weight numbers go to the model. Workouts and gentle questions still work. The note is also
  kept apart from its conversation (`ai_coach_safety_notes`: topic and time only), so deleting that
  conversation doesn't end the 30 days; "Delete my coach data" does.
- Pregnancy or breastfeeding in a conversation stops meal plans, workouts and swaps in it; a medical condition
  stops meal plans and swaps. The member is told why.
- A meal plan below the member's minimum (`calorieFloor`) is resized or refused, never shown.
- Plans for members with allergies always say that FITX checks food names, not recipes.

## Settings (environment variables, server-only)

| Name | What it does |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key. Free tier only while the Google Cloud project has no billing account. |
| `GROQ_API_KEY` | GroqCloud key on the Free plan. |
| `OPENROUTER_API_KEY` | OpenRouter key with no credits; only `:free` models and `openrouter/free` are used. |
| `AI_COACH_ENABLED` | Kill switch. `false` pauses every AI feature at once (the page says "paused"). |
| `AI_ALLOW_PAID` | Leave unset. `true` lets the router use models that are not on a free tier. |
| `AI_GEMINI_WITH_MEMBER_DATA` | Leave unset unless the owner accepts it. On Gemini's free tier Google may use prompts to improve its products and people at Google may read them, so by default Gemini gets only "Questions only" requests, never the member's FITX summary. `true` lets it answer chats with the summary and plans too. |
| `AI_GEMINI_MODELS`, `AI_GROQ_MODELS`, `AI_OPENROUTER_MODELS` | Optional comma-separated lists replacing the default models. Models not known to be free are still refused unless `AI_ALLOW_PAID=true`. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Local development only, see below. |

Any one key is enough for "Questions only". "Use my FITX data" and plans need a Groq or OpenRouter key
(or `AI_GEMINI_WITH_MEMBER_DATA=true`); until then the page says so. More keys mean more free capacity
and better fallbacks.
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
or row id, private notes or exact times. Members who choose "Questions only", every member under 18, and
every account without an age in its profile send no summary: only a profile age of 18 or over
(`facts.adult`) lets "Use my FITX data" on. Every prompt still carries the lowest daily calories the coach may suggest
(`calorieFloor`, which depends on sex), and an under-18 member's prompt says they are under 18.
`sharedSummaryLines` in `status.ts` is the consent screen's list; tests keep it and the privacy page in
step with the summary.

A chat message also carries the conversation's recent messages (up to the last 12 questions and
replies together, about 8,000 characters). With "Use my FITX data" off, only messages from after it was last switched off are
sent (`recentTurns`' `since`, from `ai_coach_consents.updated_at`), so replies written from the member's
data are not sent again; switching it off in Coach settings also starts a new conversation. The
database sets `updated_at`, so it and the messages' `created_at` share one clock. If the profile turns
under 18 or loses its age while "Use my FITX data" is on (an age corrected or removed in Profile), the
coach asks again on the consent screen before it sends anything, and agreeing there moves the cut-off to
that moment.
A message the safety screen stopped, and FITX's own safety notes, are never sent.

## Limits

Per account, over any 24 hours (a rolling window, so changing time zone frees nothing): 30 chat
messages and 6 plans by default. Change them in the Supabase SQL editor, for example
`update public.ai_coach_limits set daily_limit = 50 where kind = 'chat';`. Requests nobody answered
are handed back and do not count. A question that only looks like a plan request ("what should I eat
today?") is answered as a chat message when the plan limit is used up.

## Tests

`npm test` runs `tests/ai/**` with mocked providers and a fake Supabase. With PostgreSQL installed,
`FITX_TEST_POSTGRES=1 npm test` also applies every migration to a throwaway local Postgres and checks
row-level security, the limits and "Add to My Food Plan" as two members
(`tests/ai/sql/run-local-postgres.sh`), including Nutrition v2's custom_foods columns. Neither ever
calls a real provider or database.
