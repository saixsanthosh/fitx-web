#!/usr/bin/env node
// The landing page's scenes: node scripts/media/generate-landing.mjs [--only=<id>] [--dry-run] [--encode-only] [--raw=<dir>]
// A thin wrapper over generate-images.mjs with --set=landing (prompts in landing.prompts.json).
import { main } from "./generate-images.mjs";
import { safeError } from "./generate-images.mjs";

main(["--set=landing", ...process.argv.slice(2)]).catch((error) => {
  console.error(safeError(error?.message ?? error));
  process.exitCode = 1;
});
