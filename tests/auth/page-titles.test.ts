// Bug 78 (public-7), the sign-in pages' part: /forgot-password and /reset-password carried the home page's title
// ("FITX — Train smart. Live fit."), so tabs, history and the route announcer could not tell them apart. Their pages
// are client components, which can't export metadata, so a layout beside each one gives the title. Every page that
// draws the sign-in screen now names itself; the root layout's template adds " | FITX".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { OWN_SCREEN_PATHS } from "@/components/auth/screen-paths";

const read = (file: string) => readFileSync(new URL(`../../src/app/${file}`, import.meta.url), "utf8");

/** Where each sign-in screen's title is declared, and the title. */
const TITLES: Record<string, [file: string, title: string]> = {
  "/signin": ["(auth)/signin/page.tsx", "Sign in"],
  "/signup": ["(auth)/signup/page.tsx", "Create your FITX account"],
  "/forgot-password": ["(auth)/forgot-password/layout.tsx", "Reset password"],
  "/reset-password": ["(auth)/reset-password/layout.tsx", "New password"],
};

test("every page that draws the sign-in screen has a title of its own", () => {
  assert.deepEqual(Object.keys(TITLES).sort(), [...OWN_SCREEN_PATHS].sort(), "each own-screen page is listed here");
  const seen = new Set<string>();
  for (const [path, [file, title]] of Object.entries(TITLES)) {
    const text = read(file);
    assert.match(text, new RegExp(`export const metadata: Metadata = \\{\\s*title: "${title}",?\\s*\\}`), `${path}: ${file} sets the title "${title}"`);
    assert.ok(!seen.has(title), `${path}: "${title}" is not another page's title`);
    seen.add(title);
  }
  assert.match(read("layout.tsx"), /title: \{ default: BRAND\.meta\.title, template: "%s \| FITX" \}/, "the root layout adds \" | FITX\"");
});

test("the password pages stay client components, with the title in a pass-through layout beside them", () => {
  for (const folder of ["forgot-password", "reset-password"]) {
    const page = read(`(auth)/${folder}/page.tsx`);
    assert.match(page, /^"use client";/, `${folder}/page.tsx is a client component, so it can't export metadata itself`);
    assert.doesNotMatch(page, /export const metadata/);
    const layout = read(`(auth)/${folder}/layout.tsx`);
    assert.match(layout, /return children;/, `${folder}/layout.tsx draws nothing of its own`);
    assert.doesNotMatch(layout, /"use client"/, "metadata needs a server component");
  }
  assert.ok(!existsSync(new URL("../../src/app/(auth)/verify/layout.tsx", import.meta.url)), "/verify only redirects to /signin");
});
