// A stand-in for a local Ollama server (its OpenAI-compatible /v1 API) for the AI coach's consent check. FITX
// accepts an Ollama URL only on localhost, so with this the coach is "set up" while nothing leaves the machine.
// Every request is appended to <E2E_OUT>/fake-ollama.jsonl so a flow can check exactly what the coach sent.
//
//   E2E_OUT=<dir> E2E_OLLAMA_PORT=3724 node tests/e2e/support/fake-ollama.mjs
import http from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.E2E_OLLAMA_PORT ?? 3724);
const OUT = process.env.E2E_OUT ?? ".";
mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, "fake-ollama.jsonl");
export const FAKE_REPLY = "For general fitness, try 3 sets of 8 to 12 push-ups with a minute of rest between sets. Stop if anything hurts.";

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), method: req.method, path: req.url, body })}\n`);

  if (req.method === "GET" && /\/v1\/models$/.test(req.url ?? "")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [{ id: body?.model ?? "fitx-e2e-fake", object: "model" }] }));
  }
  if (req.method !== "POST" || !/\/v1\/chat\/completions$/.test(req.url ?? "")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "not found" } }));
  }
  const content = body?.response_format ? JSON.stringify({ reply: FAKE_REPLY }) : FAKE_REPLY;
  const usage = { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(content.length / 4) };
  if (body?.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    for (const piece of content.match(/.{1,24}/gs) ?? []) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage })}\n\n`);
    return res.end("data: [DONE]\n\n");
  }
  res.writeHead(200, { "content-type": "application/json" });
  return res.end(JSON.stringify({ id: "fake", object: "chat.completion", model: body?.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage }));
});

server.listen(PORT, "127.0.0.1", () => console.log(`[fake-ollama] on http://127.0.0.1:${PORT}/v1`));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => server.close(() => process.exit(0)));
