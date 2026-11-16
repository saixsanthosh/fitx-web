import "server-only";
import type { AiConfig } from "../config";
import type { AiRequest, ProviderId } from "../types";
import { createGeminiAdapter } from "./gemini";
import { createOpenAiCompatibleAdapter } from "./openai-compatible";
import type { ProviderAdapter } from "./types";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** One adapter per provider that has a key (Ollama: a local URL in development). */
export function createAdapters(config: AiConfig): Partial<Record<ProviderId, ProviderAdapter>> {
  const adapters: Partial<Record<ProviderId, ProviderAdapter>> = {};
  if (config.keys.gemini) adapters.gemini = createGeminiAdapter(config.keys.gemini);
  if (config.keys.groq) {
    adapters.groq = createOpenAiCompatibleAdapter({ id: "groq", baseUrl: GROQ_BASE_URL, apiKey: config.keys.groq, extraBody: groqExtras });
  }
  if (config.keys.openrouter) {
    adapters.openrouter = createOpenAiCompatibleAdapter({
      id: "openrouter",
      baseUrl: OPENROUTER_BASE_URL,
      apiKey: config.keys.openrouter,
      // OpenRouter asks apps to identify themselves; no member data goes in these headers.
      headers: { "HTTP-Referer": config.siteUrl, "X-Title": "FITX" },
      // Route only to providers that do not collect prompts.
      extraBody: () => ({ provider: { data_collection: "deny" } }),
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
