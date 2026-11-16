#!/usr/bin/env node
// Copies the exercise photos listed in public.exercise_media from the pinned Free Exercise DB revision
// (Unlicense) into this project's own public Storage bucket `exercise-media`, then marks each row
// mirrored, so the app stops loading photos from GitHub. Run by a person, never automatically:
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> \
//     node scripts/catalog/mirror-media.mjs [--dry-run] [--limit 50]
//
// Needs migrations 20261118130010 (source_ref) and 20261118130020 (exercise_media, bucket) applied.
// The service-role key is read from the environment only; it is never written or printed. Only URLs
// under the pinned revision are fetched, only for rows the database lists, at most 4 at a time.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export const SOURCE_PREFIX = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/exercises/";
export const BUCKET = "exercise-media";
const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function parseArgs(argv) {
  const options = { dryRun: false, limit: Infinity };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--dry-run") options.dryRun = true;
    else if (argv[index] === "--limit") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit needs a positive whole number");
      options.limit = value;
    } else throw new Error(`Unknown option ${argv[index]}`);
  }
  return options;
}

/** Only pinned-revision photos with a safe storage path are copied. */
export function isMirrorable(row) {
  return row?.kind === "still" && !row.mirrored_at && typeof row.source_url === "string" && row.source_url.startsWith(SOURCE_PREFIX)
    && !row.source_url.slice(SOURCE_PREFIX.length).includes("..") && typeof row.storage_path === "string"
    && /^free-exercise-db\/[A-Za-z0-9_-]+\/\d+\.jpg$/.test(row.storage_path);
}

async function mirrorOne(supabase, row, dryRun) {
  const response = await fetch(row.source_url, { redirect: "error" });
  if (!response.ok) return `HTTP ${response.status}`;
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!IMAGE_TYPES.has(type)) return `unexpected type ${type || "none"}`;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return `unexpected size ${bytes.length}`;
  if (dryRun) return null;
  const uploaded = await supabase.storage.from(BUCKET).upload(row.storage_path, bytes, { contentType: type, upsert: true, cacheControl: "31536000" });
  if (uploaded.error) return `upload failed: ${uploaded.error.message}`;
  const marked = await supabase.from("exercise_media").update({ mirrored_at: new Date().toISOString() }).eq("id", row.id);
  return marked.error ? `could not mark mirrored: ${marked.error.message}` : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let done = 0; let skipped = 0; const failures = [];
  // Keyset pagination by id: each row is read once, whether it is copied, skipped or fails.
  let afterId = "00000000-0000-0000-0000-000000000000";
  while (done + failures.length < options.limit) {
    const page = await supabase.from("exercise_media").select("id,exercise_id,kind,storage_path,source_url,mirrored_at")
      .is("mirrored_at", null).eq("kind", "still").gt("id", afterId).order("id").limit(200);
    if (page.error) throw new Error(`Could not read exercise_media: ${page.error.message}`);
    const rows = page.data ?? [];
    if (!rows.length) break;
    afterId = rows[rows.length - 1].id;
    const queue = rows.filter((row) => { const ok = isMirrorable(row); if (!ok) skipped++; return ok; }).slice(0, options.limit - done - failures.length);
    for (let index = 0; index < queue.length; index += 4) {
      const batch = queue.slice(index, index + 4);
      const results = await Promise.all(batch.map((row) => mirrorOne(supabase, row, options.dryRun).catch((error) => String(error?.message ?? error))));
      results.forEach((problem, position) => (problem ? failures.push(`${batch[position].exercise_id} ${batch[position].storage_path}: ${problem}`) : done++));
    }
    if (rows.length < 200) break;
  }
  console.log(`${options.dryRun ? "Checked" : "Mirrored"} ${done} photo(s); skipped ${skipped}; ${failures.length} failed.`);
  for (const line of failures.slice(0, 50)) console.log(`  ${line}`);
  if (failures.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
