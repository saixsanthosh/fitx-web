import "server-only";
import type { ProviderId } from "./types";

/**
 * AI settings from the environment. Keys stay on the server: none of these names has the
 * NEXT_PUBLIC_ prefix, so Next never sends them to the browser.
 *
 *   AI_COACH_ENABLED     kill switch: "false", "0", "off" or "no" pauses every AI feature at once.
 *   AI_ALLOW_PAID        "true" allows models that are not on a free tier. Off unless set.
 *   AI_GEMINI_WITH_MEMBER_DATA
 *                        "true" also sends requests that carry a member's FITX summary to Gemini. Off unless set:
 *                        on Google's unpaid tier prompts may be used to improve Google's products and read by
 *                        people at Google, so by default Gemini only gets "Questions only" requests.
 *   GEMINI_API_KEY       Google AI Studio key (free tier while the Cloud project has no billing).
 *   GROQ_API_KEY         GroqCloud key (free plan).
 *   OPENROUTER_API_KEY   OpenRouter key; only ":free" models and the free router are used.
 *   AI_GEMINI_MODELS, AI_GROQ_MODELS, AI_OPENROUTER_MODELS
 *                        optional comma-separated model lists that replace the defaults in registry.ts.
 *   OLLAMA_BASE_URL, OLLAMA_MODEL
 *                        optional: an Ollama server the owner runs. An https:// address works everywhere; a
 *                        localhost address (http://127.0.0.1:11434) only outside Vercel, for development. Any
 *                        other address is ignored. Only ever read from the server's environment: never from a
 *                        member, a request or the database.
 */
export type AiConfig = {
  enabled: boolean;
  allowPaid: boolean;
  /** Owner opt-in: requests carrying member data may also go to Gemini's unpaid tier. */
  geminiWithMemberData: boolean;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string[]>>;
  /** "local": this computer (development); "remote": an https server the owner runs. */
  ollama: { baseUrl: string; model: string; kind: "local" | "remote" } | null;
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
    geminiWithMemberData: ON.has((env.AI_GEMINI_WITH_MEMBER_DATA ?? "").trim().toLowerCase()),
    keys,
    models,
    ollama: ollamaFrom(env),
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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Ollama is optional and comes only from the server's own environment. An https:// address (a server the owner
 * runs and keeps private) is used anywhere. A localhost address is the developer's own machine, which a Vercel
 * function cannot reach ("localhost" there is the function itself), so it is used only outside Vercel. Plain
 * http to any other host, addresses with a user name or password, a query or a fragment are refused.
 */
function ollamaFrom(env: Env): AiConfig["ollama"] {
  const raw = (env.OLLAMA_BASE_URL ?? "").trim();
  if (!raw) return null;
  const model = (env.OLLAMA_MODEL ?? "").trim();
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const local = LOCAL_HOSTS.has(url.hostname);
  const onVercel = Boolean(env.VERCEL || env.VERCEL_ENV);
  let kind: "local" | "remote";
  if (local) {
    if (onVercel || !/^https?:$/.test(url.protocol)) return null;
    kind = "local";
  } else {
    if (url.protocol !== "https:") return null;
    kind = "remote";
  }
  const path = url.pathname.replace(/\/+$/, "");
  return { baseUrl: `${url.origin}${path.endsWith("/v1") ? path : `${path}/v1`}`, model, kind };
}

function siteUrl(env: Env) {
  try {
    if (env.NEXT_PUBLIC_SITE_URL) return new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  } catch {
    // Fall back to the production site.
  }
  return "https://fitnessx.vercel.app";
}
