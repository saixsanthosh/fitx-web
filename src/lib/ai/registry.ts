import "server-only";
import type { AiConfig } from "./config";
import type { AiTask, ProviderId } from "./types";

/**
 * Which models each task may use, in order, and the free-only guard.
 *
 * Model IDs were checked against each provider's own pages on 2026-11-16:
 *  - Gemini API pricing lists these as "Free of charge" on the free tier. The free tier may use
 *    prompts to improve Google's products; the paid tier does not.
 *  - GroqCloud lists the gpt-oss models on its free plan (about 30 requests a minute and 1,000 a day).
 *  - OpenRouter's free models end in ":free"; "openrouter/free" picks one of them per request at no charge.
 * Free tiers change. The guard below refuses anything not known to be free unless AI_ALLOW_PAID=true,
 * but the real guarantee is account-side: no billing on the Gemini project, Groq on the Free plan,
 * and no credits on the OpenRouter key.
 */

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  ollama: "Ollama (this computer)",
};

/** Gemini models with a free tier on the pricing page (2026-11-16). */
const GEMINI_FREE = new Set([
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
]);

/** Groq models on the free plan (2026-11-16). */
const GROQ_FREE = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);

export function isFreeModel(provider: ProviderId, model: string): boolean {
  switch (provider) {
    case "gemini":
      return GEMINI_FREE.has(model);
    case "groq":
      return GROQ_FREE.has(model);
    case "openrouter":
      return model === "openrouter/free" || /^[a-z0-9._-]+\/[a-z0-9._-]+:free$/i.test(model);
    case "ollama":
      return true;
  }
}

/**
 * Default models per task. Plans want the strongest free model first (Gemini Flash has a small daily
 * allowance, so it falls through to the next one when used up); chat wants the fastest first.
 */
const DEFAULTS: Record<AiTask, Array<[Exclude<ProviderId, "ollama">, string[]]>> = {
  chat: [
    ["groq", ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]],
    ["gemini", ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]],
    ["openrouter", ["openrouter/free"]],
  ],
  meal_plan: [
    ["gemini", ["gemini-3.6-flash", "gemini-3.5-flash-lite"]],
    ["groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]],
    ["openrouter", ["openrouter/free"]],
  ],
  workout_plan: [
    ["gemini", ["gemini-3.6-flash", "gemini-3.5-flash-lite"]],
    ["groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]],
    ["openrouter", ["openrouter/free"]],
  ],
  swap: [
    ["gemini", ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]],
    ["groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]],
    ["openrouter", ["openrouter/free"]],
  ],
};

export type Candidate = { provider: ProviderId; model: string };

/**
 * Providers whose free tier may use prompts to improve the provider's products or let people read them.
 * Requests carrying a member's FITX summary skip them unless the owner opts in (AI_GEMINI_WITH_MEMBER_DATA).
 */
export function mayReadPrompts(provider: ProviderId) {
  return provider === "gemini";
}

/**
 * The models a task tries, in order: providers take turns (first model of each, then the second of
 * each…), so one provider being down or rate-limited costs one attempt, not several in a row.
 * Only providers with a key are listed, and only free models unless the config allows paid ones.
 */
export function candidatesFor(task: AiTask, config: AiConfig, options: { personalData?: boolean } = {}): Candidate[] {
  const lists: Candidate[][] = [];
  for (const [provider, defaults] of DEFAULTS[task]) {
    if (!config.keys[provider]) continue;
    if (options.personalData && mayReadPrompts(provider) && !config.geminiWithMemberData) continue;
    const models = config.models[provider] ?? defaults;
    lists.push(models.filter((model) => config.allowPaid || isFreeModel(provider, model)).map((model) => ({ provider, model })));
  }
  const ordered: Candidate[] = [];
  for (let round = 0; lists.some((list) => list.length > round); round += 1) {
    for (const list of lists) if (list[round]) ordered.push(list[round]);
  }
  if (config.ollama) ordered.push({ provider: "ollama", model: config.ollama.model });
  return ordered;
}

/** True when at least one configured provider may receive requests that carry member data. */
export function canSendMemberData(config: AiConfig) {
  return (["gemini", "groq", "openrouter"] as const).some((provider) => config.keys[provider] && (!mayReadPrompts(provider) || config.geminiWithMemberData)) || Boolean(config.ollama);
}

/** Providers that will receive requests, for the consent screen. */
export function configuredProviders(config: AiConfig): ProviderId[] {
  const providers: ProviderId[] = [];
  for (const provider of ["gemini", "groq", "openrouter"] as const) if (config.keys[provider]) providers.push(provider);
  if (config.ollama) providers.push("ollama");
  return providers;
}
