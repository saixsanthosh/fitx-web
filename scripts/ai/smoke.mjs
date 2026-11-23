#!/usr/bin/env node
// One smoke-test request per configured AI provider, from this computer. Usage:
//   node scripts/ai/smoke.mjs <path to an env file with the keys> [--only=gemini,groq,cloudflare,cerebras,mistral]
// The env file is read here and never copied, logged or printed. Output is one line per provider: the HTTP status,
// the model asked for and, for Cloudflare without CLOUDFLARE_ACCOUNT_ID, how many accounts the token can see.
// No key, account ID, prompt or reply text is printed. The prompt carries no member data.
import { readFileSync } from "node:fs";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/ai/smoke.mjs <env file> [--only=a,b]");
  process.exit(2);
}
const only = rest.find((arg) => arg.startsWith("--only="))?.slice(7).split(",").filter(Boolean) ?? null;

/** KEY=value lines; quotes stripped. */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !line.trimStart().startsWith("#")) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = parseEnv(readFileSync(file, "utf8"));
const PROMPT = "Reply with the single word: ready";
const timeout = () => AbortSignal.timeout(20_000);

async function openAiCompatible(url, key, model) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT }], max_tokens: 64, temperature: 0 }),
    signal: timeout(),
  });
  await response.arrayBuffer();
  return response.status;
}

const checks = {
  async gemini() {
    const key = env.GEMINI_API_KEY;
    if (!key) return null;
    const model = (env.AI_GEMINI_MODELS ?? "").split(",")[0]?.trim() || "gemini-3.5-flash-lite";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT }] }], generationConfig: { maxOutputTokens: 64, temperature: 0 } }),
      signal: timeout(),
    });
    await response.arrayBuffer();
    return { status: response.status, model };
  },
  async groq() {
    const key = env.GROQ_API_KEY;
    if (!key) return null;
    const model = (env.AI_GROQ_MODELS ?? "").split(",")[0]?.trim() || "openai/gpt-oss-20b";
    return { status: await openAiCompatible("https://api.groq.com/openai/v1/chat/completions", key, model), model };
  },
  async cloudflare() {
    const key = env.CLOUDFLARE_API_TOKEN;
    if (!key) return null;
    const account = (env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
    const model = (env.AI_CLOUDFLARE_MODELS ?? "").split(",")[0]?.trim() || "@cf/openai/gpt-oss-20b";
    if (account) {
      return { status: await openAiCompatible(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/v1/chat/completions`, key, model), model };
    }
    // Without an account ID the one request is the account lookup FITX falls back to.
    const response = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=5", { headers: { Authorization: `Bearer ${key}` }, signal: timeout() });
    const body = await response.json().catch(() => null);
    const count = Array.isArray(body?.result) ? body.result.length : null;
    return { status: response.status, model: "(account lookup, no model called)", note: count === null ? "no account list" : `${count} account(s) visible to the token` };
  },
  async cerebras() {
    const key = env.CEREBRAS_API_KEY;
    if (!key) return null;
    const model = (env.AI_CEREBRAS_MODELS ?? "").split(",")[0]?.trim() || "gpt-oss-120b";
    return { status: await openAiCompatible("https://api.cerebras.ai/v1/chat/completions", key, model), model };
  },
  async mistral() {
    const key = env.MISTRAL_API_KEY;
    if (!key) return null;
    const model = (env.AI_MISTRAL_MODELS ?? "").split(",")[0]?.trim() || "mistral-small-latest";
    return { status: await openAiCompatible("https://api.mistral.ai/v1/chat/completions", key, model), model };
  },
};

for (const [name, check] of Object.entries(checks)) {
  if (only && !only.includes(name)) continue;
  try {
    const result = await check();
    if (!result) console.log(`${name}: skipped (no key in the file)`);
    else console.log(`${name}: HTTP ${result.status} · ${result.model}${result.note ? ` · ${result.note}` : ""}`);
  } catch (error) {
    console.log(`${name}: no answer (${error instanceof Error ? error.name : "error"})`);
  }
}
