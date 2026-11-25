import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cameFromSetup, inSetupMode, onboardedFrom, openDuringSetup, SETUP_PATH } from "../../src/components/layout/setup-mode.ts";
import { OPEN_BEFORE_ONBOARDING } from "../../src/lib/auth/before-onboarding.ts";

// Bug 35: Help opened from setup showed the whole app menu, the account button and the AI Coach button, and every
// one of them silently went back to step 1 (the proxy sends an account in setup from every other page to
// /onboarding). In setup mode the shell hides them and offers "Back to setup" instead.
const source = (file: string) => readFileSync(file, "utf8");

test("Help is the one page open during setup besides setup itself", () => {
  assert.ok(OPEN_BEFORE_ONBOARDING.includes("/help") && OPEN_BEFORE_ONBOARDING.includes(SETUP_PATH));
  assert.equal(openDuringSetup("/help"), true);
  for (const path of [SETUP_PATH, "/dashboard", "/workouts", "/help/requests", "/settings"]) assert.equal(openDuringSetup(path), false, path);
});

test("setup's own Get help link (?from=/onboarding) counts as coming from setup; anything else does not", () => {
  assert.equal(cameFromSetup("/onboarding"), true);
  assert.equal(cameFromSetup("/onboarding?step=2"), true);
  for (const from of [null, undefined, "", "/dashboard", "/onboardingx", "https://example.com/onboarding", "//onboarding"]) {
    assert.equal(cameFromSetup(from), false, String(from));
  }
});

test("the account's own answer decides once it has loaded; until then the link it came by", () => {
  const help = "/help";
  // Still in setup: setup mode whichever way Help was opened.
  assert.equal(inSetupMode({ pathname: help, from: null, onboarded: false }), true);
  assert.equal(inSetupMode({ pathname: help, from: "/onboarding", onboarded: false }), true);
  // Finished: the app's menu, even when an old link from setup was followed.
  assert.equal(inSetupMode({ pathname: help, from: "/onboarding", onboarded: true }), false);
  assert.equal(inSetupMode({ pathname: help, from: null, onboarded: true }), false);
  // Not loaded yet (or it failed): opened from setup means setup mode, so the menu never shows first.
  assert.equal(inSetupMode({ pathname: help, from: "/onboarding", onboarded: null }), true);
  assert.equal(inSetupMode({ pathname: help, from: null, onboarded: null }), false);
  // Never on any other page.
  assert.equal(inSetupMode({ pathname: "/dashboard", from: "/onboarding", onboarded: false }), false);
});

test("the shared user context: finished, in setup, or not known", () => {
  assert.equal(onboardedFrom(null), null, "no provider");
  assert.equal(onboardedFrom({ status: "loading", data: null }), null);
  assert.equal(onboardedFrom({ status: "error", data: null }), null);
  assert.equal(onboardedFrom({ status: "signed_out", data: null }), null);
  assert.equal(onboardedFrom({ status: "ready", data: { profile: { onboarded: true } } }), true);
  assert.equal(onboardedFrom({ status: "ready", data: { profile: { onboarded: false } } }), false);
  assert.equal(onboardedFrom({ status: "ready", data: { profile: null } }), false, "no profile row is not finished, as in the proxy");
});

test("the layout marks setup mode in its own Suspense boundary and shows the setup header", () => {
  const layout = source("src/app/(dashboard)/layout.tsx");
  assert.match(layout, /<Suspense fallback=\{null\}><SetupModeMarker \/><\/Suspense>/);
  assert.ok(layout.indexOf("<SetupHeader />") > -1 && layout.indexOf("<SetupHeader />") < layout.indexOf("<WorkspaceHeader />"), "the setup header sits where the app header does");
  const marker = source("src/components/layout/SetupMode.tsx");
  assert.match(marker, /<span hidden data-fitx-setup="" \/>/);
  assert.match(marker, /<div className="fitx-setup-only sticky top-0 z-30">/);
  assert.match(marker, /<Link href=\{SETUP_PATH\}[^>]*>\s*<ArrowLeft[^>]*\/>Back to setup\s*<\/Link>/);
  assert.match(marker, /<SkipLink \/>/, "the only skip link while the menu is hidden");
  // Only the marker reads the address's query: the rest of the shell stays in static pages' HTML.
  for (const file of ["Sidebar.tsx", "BottomNav.tsx", "WorkspaceHeader.tsx", "CoachLauncher.tsx", "SetupMode.tsx"]) {
    const uses = (source(`src/components/layout/${file}`).match(/useSearchParams\(/g) ?? []).length;
    assert.equal(uses, file === "SetupMode.tsx" ? 1 : 0, file);
  }
});

test("in setup mode the app's menu, account menu and AI Coach button are hidden and the setup header shown", () => {
  const globals = source("src/app/globals.css");
  assert.match(globals, /^\.fitx-setup-only \{ display: none; \}$/m, "hidden unless in setup mode, also without :has()");
  assert.match(globals, /^:root:has\(\[data-fitx-setup\]\) \.fitx-setup-only \{ display: block; \}$/m);
  assert.match(globals, /^:root:has\(\[data-fitx-setup\]\) \.fitx-app-only \{ display: none !important; \}$/m);
  const tokens = (file: string, pattern: RegExp) => (source(`src/components/layout/${file}`).match(pattern)?.[1] ?? "").split(/\s+/);
  assert.ok(tokens("Sidebar.tsx", /<aside data-coach-edge="" className="([^"]+)"/).includes("fitx-app-only"), "the sidebar and rail");
  assert.ok(tokens("BottomNav.tsx", /<nav ref=\{bar\} aria-label="Main navigation" data-coach-avoid="" className="([^"]+)"/).includes("fitx-app-only"), "the phone's bar");
  assert.ok(tokens("WorkspaceHeader.tsx", /className=\{`\$\{scrolled \? "fitx-glass " : ""\}([^`$]+)/).includes("fitx-app-only"), "the header and its account menu");
  assert.match(source("src/components/layout/CoachLauncher.tsx"), /className=\{cn\("fitx-app-only", styles\.launcher,/, "the AI Coach button");
});
