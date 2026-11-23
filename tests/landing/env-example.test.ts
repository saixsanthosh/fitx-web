// .env.example lists every setting the app reads from its environment, so the owner can see each one before a
// deploy. Names Vercel or Next set themselves are left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLATFORM = new Set(["NODE_ENV", "NEXT_PHASE", "NEXT_RUNTIME", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "NEXT_PUBLIC_VERCEL_ENV"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return sources(file);
    return /\.(ts|tsx|mjs)$/.test(name) ? [file] : [];
  });
}

/** Every environment name the app's code reads: process.env.X, env.X on an env object, and the AI key names it looks up by string. */
function namesRead(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of [...sources(path.join(ROOT, "src")), path.join(ROOT, "next.config.ts")]) {
    const text = readFileSync(file, "utf8");
    const patterns = [
      /process\.env\.([A-Z][A-Z0-9_]+)/g,
      /process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g,
      /\benv\.([A-Z][A-Z0-9_]+)/g,
      /["']([A-Z][A-Z0-9]*_(?:API_KEY|API_TOKEN|MODELS|WITH_MEMBER_DATA))["']/g,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) if (!PLATFORM.has(match[1]) && !found.has(match[1])) found.set(match[1], path.relative(ROOT, file));
    }
  }
  return found;
}

/** Names in .env.example, set (NAME=) or shown commented out (# NAME=). */
function namesListed(): Set<string> {
  const text = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  return new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]));
}

test(".env.example lists every environment setting the app reads", () => {
  const listed = namesListed();
  const missing = [...namesRead()].filter(([name]) => !listed.has(name)).map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(missing, [], `add these to .env.example with a one-line note: ${missing.join(", ")}`);
});

test("the AI services the coach can use are all listed, Workers AI with its account ID", () => {
  const listed = namesListed();
  for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CEREBRAS_API_KEY", "MISTRAL_API_KEY"]) {
    assert.ok(listed.has(name), name);
  }
});

test(".env.example carries no value that looks like a real key or secret", () => {
  const text = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, name, value] = match;
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(name)) assert.equal(value.trim(), "", `${name} is left empty`);
  }
});
