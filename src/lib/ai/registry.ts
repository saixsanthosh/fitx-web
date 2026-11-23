import "server-only";
import { CLOUD_PROVIDERS, type AiConfig } from "./config";
import type { AiTask, ProviderId } from "./types";

/**
 * Which models each task may use, in order, and the free-only guard.
 *
 * Model IDs were checked against each provider's own pages on 2026-11-16:
 *  - Gemini API pricing lists these as "Free of charge" on the free tier. The free tier may use
 *    prompts to improve Google's products; the paid tier does not.
 *  - GroqCloud lists the gpt-oss models on its free plan (about 30 requests a minute and 1,000 a day).
 *  - OpenRouter's free models end in ":free"; "openrouter/free" picks one of them per request at no charge.
 * Added 2026-11-23 (not re-checked live: model IDs come from each provider's documentation as FITX last knew it, and an
 * unknown model only costs one 404 attempt, after which the router leaves it alone for an hour):
 *  - Cloudflare Workers AI: every "@cf/" model runs inside the daily free allocation on the Workers Free plan, and
 *    stops (rather than bills) when it is used up. Smoke-tested 2026-11-23: the token is valid.
 *  - Cerebras and Mistral: free tiers with rate limits; their free plans may use prompts (see mayReadPrompts).
 * Free tiers change. The guard below refuses anything not known to be free unless AI_ALLOW_PAID=true,
 * but the real guarantee is account-side: no billing on the Gemini project, Groq on the Free plan,
 * and no credits on the OpenRouter key.
 */

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  cloudflare: "Cloudflare Workers AI",
  cerebras: "Cerebras",
  mistral: "Mistral AI",
  openrouter: "OpenRouter",
  ollama: "Ollama (this computer)",
};

/** The name shown for a provider: Ollama says whether it runs on this computer or on the owner's own server. */
export function providerLabel(provider: ProviderId, config: Pick<AiConfig, "ollama">): string {
  if (provider === "ollama" && config.ollama?.kind === "remote") return "Ollama (FITX's own server)";
  return PROVIDER_LABELS[provider];
}

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
    case "cloudflare":
      // Account-side: the Workers Free plan has a daily allocation and no billing.
      return /^@(?:cf|hf)\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(model);
    case "cerebras":
    case "mistral":
      // Account-side: the free tier covers its models with rate limits; the owner keeps the account on it.
      return true;
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
    ["cloudflare", ["@cf/openai/gpt-oss-20b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]],
    ["cerebras", ["gpt-oss-120b"]],
    ["mistral", ["mistral-small-latest"]],
    ["openrouter", ["openrouter/free"]],
  ],
  meal_plan: [
    ["gemini", ["gemini-3.6-flash", "gemini-3.5-flash-lite"]],
    ["groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]],
    ["cerebras", ["gpt-oss-120b"]],
    ["mistral", ["mistral-small-latest"]],
    ["cloudflare", ["@cf/openai/gpt-oss-120b"]],
    ["openrouter", ["openrouter/free"]],
  ],
  workout_plan: [
    ["gemini", ["gemini-3.6-flash", "gemini-3.5-flash-lite"]],
    ["groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]],
    ["cerebras", ["gpt-oss-120b"]],
    ["mistral", ["mistral-small-latest"]],
    ["cloudflare", ["@cf/openai/gpt-oss-120b"]],
    ["openrouter", ["openrouter/free"]],
  ],
  swap: [
    ["gemini", ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]],
    ["groq", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]],
    ["cerebras", ["gpt-oss-120b"]],
    ["mistral", ["mistral-small-latest"]],
    ["cloudflare", ["@cf/openai/gpt-oss-120b"]],
    ["openrouter", ["openrouter/free"]],
  ],
};

export type Candidate = { provider: ProviderId; model: string };

/**
 * Providers whose free tier may use prompts to improve the provider's products or let people read them: Gemini's
 * unpaid tier, Mistral's Experiment plan (may train on prompts unless the account opts out) and Cerebras (FITX could not
 * confirm its free tier's terms, so it is treated the cautious way). Requests carrying a member's FITX summary skip
 * them unless the owner opts in (AI_GEMINI_WITH_MEMBER_DATA, AI_CEREBRAS_WITH_MEMBER_DATA, AI_MISTRAL_WITH_MEMBER_DATA).
 */
export function mayReadPrompts(provider: ProviderId) {
  return provider === "gemini" || provider === "mistral" || provider === "cerebras";
}

/** The owner allowed member data on this provider although its free tier may read prompts. */
export function memberDataAllowed(provider: ProviderId, config: Pick<AiConfig, "geminiWithMemberData" | "memberDataOptIn">) {
  if (!mayReadPrompts(provider)) return true;
  return provider === "gemini" ? config.geminiWithMemberData : Boolean(config.memberDataOptIn?.[provider]);
}

/**
 * The first consent version (store.CONSENT_VERSION) whose consent screen could name each AI service. Version 1 screens
 * (before wave 1 of the next-level job) knew only Gemini, Groq, OpenRouter and Ollama; Cloudflare Workers AI, Cerebras
 * and Mistral arrived with version 2. A member who agreed to an earlier version never saw a later service named, so
 * requests carrying their FITX data never go there (they still get "Questions only" requests, which carry none).
 */
const FIRST_CONSENT_VERSION: Partial<Record<ProviderId, number>> = { cloudflare: 2, cerebras: 2, mistral: 2 };

/** The member's consent (of version `consentVersion`) covers sending their FITX data to this provider. */
export function consentCovers(provider: ProviderId, consentVersion: number) {
  return (FIRST_CONSENT_VERSION[provider] ?? 1) <= consentVersion;
}

/**
 * The models a task tries, in order: providers take turns (first model of each, then the second of
 * each…), so one provider being down or rate-limited costs one attempt, not several in a row.
 * Only providers with a key are listed, and only free models unless the config allows paid ones.
 * `consentVersion`: the version of the consent the member agreed to; with `personalData`, providers their consent
 * screen could not have named are left out (see FIRST_CONSENT_VERSION). Every coach request passes it.
 */
export function candidatesFor(task: AiTask, config: AiConfig, options: { personalData?: boolean; consentVersion?: number } = {}): Candidate[] {
  const lists: Candidate[][] = [];
  for (const [provider, defaults] of DEFAULTS[task]) {
    if (!config.keys[provider]) continue;
    if (options.personalData && !memberDataAllowed(provider, config)) continue;
    if (options.personalData && options.consentVersion !== undefined && !consentCovers(provider, options.consentVersion)) continue;
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

/** True when at least one configured provider may receive requests that carry member data (of a member with this consent version, when given). */
export function canSendMemberData(config: AiConfig, consentVersion?: number) {
  return CLOUD_PROVIDERS.some((provider) => config.keys[provider] && memberDataAllowed(provider, config) && (consentVersion === undefined || consentCovers(provider, consentVersion))) || Boolean(config.ollama);
}

/** Providers that will receive requests, for the consent screen. */
export function configuredProviders(config: AiConfig): ProviderId[] {
  const providers: ProviderId[] = [];
  for (const provider of CLOUD_PROVIDERS) if (config.keys[provider]) providers.push(provider);
  if (config.ollama) providers.push("ollama");
  return providers;
}
