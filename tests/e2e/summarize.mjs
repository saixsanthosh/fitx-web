// Summarises an e2e browser pass: per flow run the status and failed steps, then per page what needs a look
// (page errors, console errors, failed or 4xx/5xx requests to the app or the stand-in, horizontal overflow on
// phones), with the noise this harness causes on purpose set apart, and the outside hosts that were refused.
//
//   node tests/e2e/summarize.mjs <out dir> [results file]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? ".");
const file = process.argv[3] ? path.resolve(process.argv[3]) : path.join(out, "results-latest.json");
const results = JSON.parse(readFileSync(file, "utf8"));

/** Noise that only exists because of how this harness runs the app (see each reason). */
const HARNESS_NOISE = [
  { test: (e) => /\/_vercel\/insights\/script\.js/.test(`${e.url ?? ""} ${e.source ?? ""} ${e.text ?? ""}`), reason: "Vercel Web Analytics script only exists on Vercel deployments" },
  { test: (e) => /\/_next\/image\?url=https?%3A%2F%2F/.test(`${e.url ?? ""} ${e.source ?? ""}`), reason: "Next image optimizer could not fetch an outside image (server outbound blocked)" },
  { test: (e) => e.kind === "console.error" && e.external, reason: "request to a blocked outside host" },
  { test: (e) => e.kind === "requestfailed" && /ERR_ABORTED/.test(e.failure ?? "") && /[?&]_rsc=/.test(e.url ?? ""), reason: "React Server Component prefetch aborted by a navigation" },
  { test: (e) => e.kind === "requestfailed" && /ERR_ABORTED/.test(e.failure ?? "") && e.type === "media", reason: "intro film video request aborted when the film was skipped" },
  // exercise_favorites exists on production (experience 2.0) but no repo migration creates it, so the stand-in answers
  // 404 once per tab and the exercise library keeps saved exercises on the device (checked by flow 13-exercise-discovery).
  { test: (e) => /\/rest\/v1\/exercise_favorites/.test(`${e.url ?? ""} ${e.source ?? ""} ${e.text ?? ""}`), reason: "exercise_favorites is a production-only table; the library falls back to device storage" },
  // Flows 6 and 10 call the coach and billing APIs on purpose to check that they refuse without keys.
  { test: (e) => /\/api\/(coach|billing)\//.test(`${e.url ?? ""} ${e.source ?? ""}`) && /APIs/.test(e.label ?? ""), reason: "refusal from an API a flow called on purpose (checked by that flow)" },
];

function classify(event) {
  const noise = HARNESS_NOISE.find((rule) => rule.test(event));
  return noise ? noise.reason : null;
}

const describe = (event) => {
  if (event.kind === "http") return `HTTP ${event.status} ${event.method} ${event.host}${event.url}`;
  if (event.kind === "requestfailed") return `request failed (${event.failure}) ${event.method} ${event.host}${event.url}`;
  return `${event.kind}: ${event.text?.split("\n")[0]}`;
};

const summary = { runs: [], findings: [], noise: {}, blocked: {}, serverOutbound: {}, overflow: [] };
for (const run of results) {
  const failed = run.steps.filter((step) => step.status === "fail");
  summary.runs.push({ flow: run.flow, size: run.size, scheme: run.scheme, status: run.status, steps: `${run.steps.length - failed.length}/${run.steps.length}`, failed: failed.map((step) => `${step.name}: ${step.error?.split("\n")[0]}`) });
  for (const checkpoint of run.checkpoints) {
    if (run.size === "phone" && checkpoint.overflow?.overflow) {
      summary.overflow.push({ flow: run.flow, scheme: run.scheme, page: checkpoint.name, url: checkpoint.url, scrollWidth: checkpoint.overflow.scrollWidth, offenders: checkpoint.overflow.offenders });
    }
    for (const event of checkpoint.events ?? []) {
      if (event.kind === "console.warning") continue;
      const noise = classify(event);
      if (noise) {
        summary.noise[noise] = (summary.noise[noise] ?? 0) + 1;
        continue;
      }
      summary.findings.push({ flow: run.flow, size: run.size, scheme: run.scheme, page: checkpoint.name, at: event.page ?? checkpoint.url, step: event.label, what: describe(event), detail: event.kind === "pageerror" ? event.text?.slice(0, 600) : undefined });
    }
  }
  for (const entry of run.blocked) {
    const host = new URL(entry.url).host;
    summary.blocked[host] = (summary.blocked[host] ?? 0) + 1;
  }
}
const outboundFile = path.join(out, "server-outbound.jsonl");
if (existsSync(outboundFile)) {
  for (const line of readFileSync(outboundFile, "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    const host = new URL(entry.target).host;
    summary.serverOutbound[host] = (summary.serverOutbound[host] ?? 0) + 1;
  }
}

writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
const lines = [];
lines.push("Flow runs:");
for (const run of summary.runs) lines.push(`  ${run.status === "pass" ? "PASS" : "FAIL"} ${run.flow} ${run.size} ${run.scheme} (${run.steps} steps)${run.failed.length ? `\n      ${run.failed.join("\n      ")}` : ""}`);
const grouped = new Map();
for (const finding of summary.findings) {
  const key = finding.what.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>").slice(0, 220);
  const entry = grouped.get(key) ?? { count: 0, where: new Set() };
  entry.count += 1;
  entry.where.add(`${finding.flow}/${finding.size}/${finding.scheme}: ${finding.page}`);
  grouped.set(key, entry);
}
lines.push("", `Page findings (${summary.findings.length}):`);
for (const [what, entry] of [...grouped.entries()].sort((a, b) => b[1].count - a[1].count)) {
  lines.push(`  ${entry.count}× ${what}`);
  for (const where of [...entry.where].slice(0, 4)) lines.push(`      at ${where}`);
}
lines.push("", `Horizontal overflow at 390 px (${summary.overflow.length}):`);
for (const item of summary.overflow) lines.push(`  ${item.flow}/${item.scheme}: ${item.page} (${item.scrollWidth}px) ${item.offenders.map((offender) => offender.element).join(" | ")}`);
lines.push("", "Harness-only noise (not app bugs):");
for (const [reason, count] of Object.entries(summary.noise)) lines.push(`  ${count}× ${reason}`);
lines.push("", "Outside hosts refused in the browser:");
for (const [host, count] of Object.entries(summary.blocked)) lines.push(`  ${count}× ${host}`);
lines.push("", "Outside hosts refused on the app server:");
for (const [host, count] of Object.entries(summary.serverOutbound)) lines.push(`  ${count}× ${host}`);
console.log(lines.join("\n"));
