// The site's own photos (src/data/images.ts, hosted on images.unsplash.com) reach the browser only through the
// image optimizer. Found by the signed-in e2e run: phones fetched the home page's photos from Unsplash directly (a
// <source> with the raw URL in front of next/image), which the privacy page doesn't mention.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SRC = new URL("../../src/", import.meta.url);
const files = readdirSync(SRC, { recursive: true }).map(String).filter((file) => /\.tsx?$/.test(file));
const read = (file: string) => readFileSync(new URL(file, SRC), "utf8");

test("no page hands the browser a photo URL of its own: no <source srcSet> or srcSet outside next/image", () => {
  const raw = files.filter((file) => /\bsrcSet=|<source[^>]*\bsrcset\b/i.test(read(file)));
  assert.deepEqual(raw, []);
  assert.deepEqual(files.filter((file) => /\bmobileSrc\b/.test(read(file))), [], "the home page's phone-only photo sources are gone");
});

test("the site's photos are never shown unoptimized, so the browser never asks the photo host", () => {
  const users = files.filter((file) => /from "@\/data\/images"/.test(read(file)));
  assert.ok(users.length > 0);
  assert.deepEqual(users.filter((file) => /\bunoptimized\b/.test(read(file))), []);
  // The URLs themselves stay in one place.
  const hosts = files.filter((file) => /images\.unsplash\.com/.test(read(file)));
  assert.deepEqual(hosts.map((file) => file.split(path.sep).join("/")), ["data/images.ts"]);
});
