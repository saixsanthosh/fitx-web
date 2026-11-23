import "server-only";
import type { AiConfig } from "../config";
import type { AiRequest, ProviderId } from "../types";
import { createGeminiAdapter } from "./gemini";
import { createOpenAiCompatibleAdapter } from "./openai-compatible";
import type { ProviderAdapter } from "./types";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
/** Workers AI's OpenAI-compatible endpoint lives under the owner's Cloudflare account. */
export const cloudflareBaseUrl = (accountId: string) => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`;

/** One adapter per provider that has a key (Ollama: a local URL in development). */
export function createAdapters(config: AiConfig): Partial<Record<ProviderId, ProviderAdapter>> {
  const adapters: Partial<Record<ProviderId, ProviderAdapter>> = {};
  if (config.keys.gemini) adapters.gemini = createGeminiAdapter(config.keys.gemini);
  if (config.keys.groq) {
    adapters.groq = createOpenAiCompatibleAdapter({
      id: "groq",
      baseUrl: GROQ_BASE_URL,
      apiKey: config.keys.groq,
      extraBody: groqExtras,
      // Groq's structured outputs accept a JSON schema on the gpt-oss models.
      jsonSchema: (model) => model.startsWith("openai/gpt-oss"),
    });
  }
  if (config.keys.cloudflare && config.cloudflareAccountId) {
    adapters.cloudflare = createOpenAiCompatibleAdapter({
      id: "cloudflare",
      baseUrl: cloudflareBaseUrl(config.cloudflareAccountId),
      apiKey: config.keys.cloudflare,
      // JSON mode only: Workers AI does not take a JSON schema on every model.
      jsonSchema: () => false,
    });
  }
  if (config.keys.cerebras) {
    adapters.cerebras = createOpenAiCompatibleAdapter({ id: "cerebras", baseUrl: CEREBRAS_BASE_URL, apiKey: config.keys.cerebras, jsonSchema: () => true });
  }
  if (config.keys.mistral) {
    adapters.mistral = createOpenAiCompatibleAdapter({ id: "mistral", baseUrl: MISTRAL_BASE_URL, apiKey: config.keys.mistral, jsonSchema: () => true });
  }
  if (config.keys.openrouter) {
    adapters.openrouter = createOpenAiCompatibleAdapter({
      id: "openrouter",
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: config.keys.openrouter,
      // OpenRouter asks apps to identify themselves; no member data goes in these headers.
      headers: { "HTTP-Referer": config.siteUrl, "X-Title": "FITX" },
      // Route only to providers that do not collect prompts, and, for plans, that honour the JSON schema.
      extraBody: (_model, request) => ({ provider: { data_collection: "deny", ...(request.json ? { require_parameters: true } : {}) } }),
      jsonSchema: () => true,
    });
  }
  if (config.ollama) adapters.ollama = createOpenAiCompatibleAdapter({ id: "ollama", baseUrl: config.ollama.baseUrl });
  return adapters;
}

/** gpt-oss models reason before they answer: keep that short for chat and hide it from the reply. */
export function groqExtras(model: string, request: AiRequest): Record<string, unknown> {
  if (!model.startsWith("openai/gpt-oss")) return {};
  return { reasoning_effort: request.task === "chat" ? "low" : "medium", include_reasoning: false };
}
