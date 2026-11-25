// The revenue charts' top line (BUGS.md 66, admin-7): money is scaled in whole rupees and reads ₹0 when nothing was
// earned, never "₹0.05" (5 paise). The chart pictures are named with their time span, not by their axis labels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { chartName, chartTop } = await importTypeScriptModule("src/components/content/chart-scale.ts");
const { formatInr } = await importTypeScriptModule("src/app/(control)/billing/format.ts");

test("money: nothing earned reads ₹0; otherwise a round number of whole rupees at or above the largest month", () => {
  assert.equal(formatInr(chartTop(0, "paise")), "₹0");
  assert.equal(formatInr(chartTop(Math.max(0, 0, 0), "paise")), "₹0");
  assert.equal(formatInr(chartTop(19_900, "paise")), "₹200", "₹199 at most");
  assert.equal(formatInr(chartTop(50, "paise")), "₹1", "50 paise at most");
  assert.equal(formatInr(chartTop(1_234_567, "paise")), "₹20,000");
  assert.equal(chartTop(Number.NaN, "paise"), 0);
  assert.equal(chartTop(-500, "paise"), 0);
});

test("counts keep their round scale of at least 5", () => {
  assert.equal(chartTop(0), 5);
  assert.equal(chartTop(3), 5);
  assert.equal(chartTop(7), 10);
  assert.equal(chartTop(140), 200);
  assert.equal(chartTop(20), 20);
});

test("a chart picture is named with its stretch of time", () => {
  assert.equal(chartName("Captured payments by month", "Jun 2026", "Nov 2026"), "Captured payments by month, Jun 2026 to Nov 2026");
  assert.equal(chartName("Captured revenue by month", "Nov 2026", "Nov 2026"), "Captured revenue by month, Nov 2026");
  assert.equal(chartName("Meals logged each week", undefined, undefined), "Meals logged each week");
});

test("both revenue charts are scaled as money, and no chart takes its axis labels as its caption", async () => {
  const billing = await readFile(new URL("../src/app/(control)/billing/page.tsx", import.meta.url), "utf8");
  const reports = await readFile(new URL("../src/app/(control)/reports/page.tsx", import.meta.url), "utf8");
  assert.match(billing, /<BarChart label="Captured payments by month" tone="accent" unit="paise" format=\{formatInr\}/);
  assert.match(reports, /<BarChart label="Captured revenue by month" tone="accent" unit="paise" format=\{formatInr\}/);
  const charts = await readFile(new URL("../src/components/content/charts.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(charts, /figcaption/);
  assert.doesNotMatch(charts, /const nice =/, "one scale rule, in chart-scale.ts");
  assert.equal((charts.match(/aria-label=\{chartName\(/g) ?? []).length, 2);
});
