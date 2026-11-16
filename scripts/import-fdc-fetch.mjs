// Saves the USDA FoodData Central search pages that scripts/import-fdc.mjs reads, resuming where it stopped.
//
//   USDA_API_KEY=<api.data.gov key> node scripts/import-fdc-fetch.mjs <dir>
//   node --import ./tests/setup/hooks.mjs scripts/import-fdc.mjs <dir> --append
//
// Fetches every Survey (FNDDS) and Foundation page (200 foods each, by FDC id) into <dir> as fndds-pN.json and
// foundation-pN.json, skipping pages already saved there. With a free key (https://api.data.gov/signup/, 1,000
// requests an hour) the 31 pages take about a minute. Without USDA_API_KEY it uses DEMO_KEY, whose small allowance is
// shared by everyone on the same IP address; it then waits out each Retry-After and can take a day or more.
// The bulk downloads are quicker still and need no key (src/data/DATA_SOURCES.md).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const API = process.env.USDA_FDC_API_URL?.trim() || "https://api.nal.usda.gov/fdc/v1";
const DATA_TYPES = [["Survey (FNDDS)", "fndds"], ["Foundation", "foundation"]];
const PAGE_SIZE = 200;

const dir = process.argv[2];
if (!dir) {
  console.error("usage: USDA_API_KEY=<key> node scripts/import-fdc-fetch.mjs <dir>");
  process.exit(2);
}
const key = process.env.USDA_API_KEY?.trim() || "DEMO_KEY";
const demo = key === "DEMO_KEY";
mkdirSync(dir, { recursive: true });

const stamp = () => new Date().toISOString().slice(11, 19);

/** A page saved by an earlier run, or null when it is missing or incomplete. */
function savedPage(file) {
  try {
    const page = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(page.foods) ? page : null;
  } catch {
    return null;
  }
}

for (const [dataType, prefix] of DATA_TYPES) {
  let total = null;
  let page = 1;
  while (total === null || page <= total) {
    const file = path.join(dir, `${prefix}-p${page}.json`);
    const saved = savedPage(file);
    if (saved && Number.isFinite(saved.totalPages)) {
      total ??= saved.totalPages;
      page += 1;
      continue;
    }
    let response;
    try {
      response = await fetch(`${API}/foods/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": key },
        body: JSON.stringify({ query: "*", dataType: [dataType], pageSize: PAGE_SIZE, pageNumber: page, sortBy: "fdcId", sortOrder: "asc" }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      console.log(`${stamp()} ${dataType} page ${page}: ${error.message}; trying again in 60 s`);
      await sleep(60_000);
      continue;
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = (Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 600) + 5;
      console.log(`${stamp()} ${dataType} page ${page}: rate limited; waiting ${wait} s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`${dataType} page ${page}: HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.foods) || !Number.isFinite(body.totalPages)) throw new Error(`${dataType} page ${page}: no list of foods in the answer`);
    writeFileSync(file, JSON.stringify(body));
    total = body.totalPages;
    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    console.log(`${stamp()} ${dataType} page ${page} of ${total}: ${body.foods.length} foods${Number.isFinite(remaining) ? `, ${remaining} calls left` : ""}`);
    page += 1;
    // Leave a couple of calls for the app's live search, and go easy on DEMO_KEY, which everyone shares.
    if (page <= total) await sleep(Number.isFinite(remaining) && remaining <= 2 ? 15 * 60_000 : demo ? 15_000 : 1_000);
  }
  console.log(`${stamp()} ${dataType}: all ${total} pages saved`);
}
