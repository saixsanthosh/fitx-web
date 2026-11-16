import "server-only";
import type { ProviderId } from "./types";

/**
 * AI settings from the environment. Keys stay on the server: none of these names has the
 * NEXT_PUBLIC_ prefix, so Next never sends them to the browser.
 *
 *   AI_COACH_ENABLED     kill switch: "false", "0", "off" or "no" pauses every AI feature at once.
 *   AI_ALLOW_PAID        "true" allows models that are not on a free tier. Off unless set.
 *   GEMINI_API_KEY       Google AI Studio key (free tier while the Cloud project has no billing).
 *   GROQ_API_KEY         GroqCloud key (free plan).
 *   OPENROUTER_API_KEY   OpenRouter key; only ":free" models and the free router are used.
 *   AI_GEMINI_MODELS, AI_GROQ_MODELS, AI_OPENROUTER_MODELS
 *                        optional comma-separated model lists that replace the defaults in registry.ts.
 *   OLLAMA_BASE_URL, OLLAMA_MODEL
 *                        local development only: an Ollama server on this machine (http://127.0.0.1:11434).
 *                        Ignored in production and for any host other than localhost.
 */
export type AiConfig = {
  enabled: boolean;
  allowPaid: boolean;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string[]>>;
  ollama: { baseUrl: string; model: string } | null;
  /** Sent to OpenRouter as the HTTP-Referer it asks apps to identify themselves with. */
  siteUrl: string;
};

type Env = Record<string, string | undefined>;

const OFF = new Set(["false", "0", "off", "no", "disabled"]);
const ON = new Set(["true", "1", "on", "yes"]);

export function readAiConfig(env: Env = process.env): AiConfig {
  const key = (name: string) => {
    const value = (env[name] ?? "").trim();
    // A pasted key with spaces or quotes would only fail later with a confusing 401.
    return value && /^[\x21-\x7e]+$/.test(value) ? value.replace(/^["']|["']$/g, "") : "";
  };
  const keys: AiConfig["keys"] = {};
  const gemini = key("GEMINI_API_KEY");
  const groq = key("GROQ_API_KEY");
  const openrouter = key("OPENROUTER_API_KEY");
  if (gemini) keys.gemini = gemini;
  if (groq) keys.groq = groq;
  if (openrouter) keys.openrouter = openrouter;

  const models: AiConfig["models"] = {};
  for (const [provider, name] of [["gemini", "AI_GEMINI_MODELS"], ["groq", "AI_GROQ_MODELS"], ["openrouter", "AI_OPENROUTER_MODELS"]] as const) {
    const list = modelList(env[name]);
    if (list.length) models[provider] = list;
  }

  return {
    enabled: !OFF.has((env.AI_COACH_ENABLED ?? "").trim().toLowerCase()),
    allowPaid: ON.has((env.AI_ALLOW_PAID ?? "").trim().toLowerCase()),
    keys,
    models,
    ollama: localOllama(env),
    siteUrl: siteUrl(env),
  };
}

/** True when at least one provider can be called. */
export function hasAnyProvider(config: AiConfig) {
  return Boolean(config.keys.gemini || config.keys.groq || config.keys.openrouter || config.ollama);
}

function modelList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z0-9._:/-]{1,120}$/.test(item))
    .slice(0, 6);
}

/** Ollama runs on a developer's own machine. Vercel functions cannot reach it, so production ignores it. */
function localOllama(env: Env) {
  const raw = (env.OLLAMA_BASE_URL ?? "").trim();
  if (!raw || env.VERCEL_ENV === "production" || env.NODE_ENV === "production") return null;
  try {
    const url = new URL(raw);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^https?:$/.test(url.protocol)) return null;
    const path = url.pathname.replace(/\/+$/, "");
    const model = (env.OLLAMA_MODEL ?? "").trim();
    if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) return null;
    return { baseUrl: `${url.origin}${path.endsWith("/v1") ? path : `${path}/v1`}`, model };
  } catch {
    return null;
  }
}

function siteUrl(env: Env) {
  try {
    if (env.NEXT_PUBLIC_SITE_URL) return new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  } catch {
    // Fall back to the production site.
  }
  return "https://fitnessx.vercel.app";
}
