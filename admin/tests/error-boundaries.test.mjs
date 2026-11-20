// Admin's error screens: an unexpected throw shows a FITX screen, never Next's unstyled default, and the screens obey
// the strict nonce CSP (no style attributes, which style-src would block).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

for (const path of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
  test(`${path} is a client error boundary that uses classes only`, () => {
    const source = read(path);
    assert.match(source, /^"use client";/);
    assert.match(source, /export default function \w+\(\{ error, retry \}/, "takes Next 16's retry");
    assert.match(source, /onClick=\{\(\) => retry\(\)\}/, "offers Try again");
    assert.doesNotMatch(source, /\sstyle=\{/, "no style attributes under the nonce CSP");
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|error\.message/, "never shows the error's own text");
  });
}

test("global-error brings its own document and the Admin styles", () => {
  const source = read("src/app/global-error.tsx");
  assert.match(source, /<html lang="en-GB">/);
  assert.match(source, /<body>/);
  assert.match(source, /import "\.\/globals\.css";/);
});
