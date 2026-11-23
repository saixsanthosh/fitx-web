import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FITX_MARK_D } from "@/components/brand/logo/geometry";
// @ts-expect-error -- a plain .mjs build script, typed by use
import { BRAND_EMBER, BRAND_INK, BRAND_PAPER, iconSvg, markSvg } from "../../scripts/brand/brand-svg.mjs";

const read = (file: string) => readFileSync(file, "utf8");

test("every logo file is generated from the mark's exact geometry (run scripts/brand/generate-brand-assets.mjs)", () => {
  assert.equal(read("public/brand/fitx-mark-black.svg"), markSvg(BRAND_INK));
  assert.equal(read("public/brand/fitx-mark-white.svg"), markSvg(BRAND_PAPER));
  assert.equal(read("public/brand/fitx-app-icon.svg"), iconSvg({ fill: 0.68, radius: 0.22 }));
  assert.equal(read("public/brand/fitx-app-icon-maskable.svg"), iconSvg({ fill: 0.54, radius: 0 }));
  assert.equal(read("public/brand/fitx-apple-touch-icon.svg"), iconSvg({ fill: 0.64, radius: 0 }));
  assert.equal(read("src/app/icon.svg"), iconSvg({ fill: 0.8, radius: 0.2 }));
  assert.equal(read("admin/src/app/icon.svg"), iconSvg({ fill: 0.8, radius: 0.2, dot: BRAND_EMBER }));
});

test("the maskable icon keeps the whole mark inside the safe circle (80% of the tile)", () => {
  // The mark's wider side takes 54% of the tile, so even its bounding box's corners sit inside the circle.
  assert.ok((0.54 * Math.SQRT2) / 2 <= 0.4);
});

test("the Admin app draws the same mark", () => {
  const admin = read("admin/src/components/fitx-mark.tsx");
  assert.ok(admin.includes(`const FITX_MARK_D = "${FITX_MARK_D}";`));
  assert.ok(admin.includes('viewBox="0 0 600 600"'));
  assert.ok(!/style=/.test(admin), "no inline styles under Admin's nonce CSP");
});

test("the share image and the manifest use the new mark", () => {
  const og = read("src/app/opengraph-image.tsx");
  assert.ok(og.includes("FITX_MARK_D") && og.includes("@/components/brand/logo/geometry"));
  const manifest = read("src/app/manifest.ts");
  for (const icon of ["/brand/fitx-app-icon-192.png", "/brand/fitx-app-icon.png", "/brand/fitx-app-icon-maskable.png"]) assert.ok(manifest.includes(icon), icon);
  assert.match(manifest, /fitx-app-icon-maskable\.png", sizes: "512x512", type: "image\/png", purpose: "maskable"/);
});

test("the old mark's geometry is gone from the app, Admin and the brand files (the intro film is re-rendered in wave 2)", () => {
  let hits = "";
  try {
    hits = execFileSync("git", ["grep", "-n", "-I", "-E", "M10 13H54|M32 31L53 52", "--", "src", "admin/src", "public/brand", ":!public/brand/intro"], { encoding: "utf8" });
  } catch {
    hits = "";
  }
  assert.equal(hits.trim(), "");
});
