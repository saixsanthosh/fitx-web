// FITX's own cookies against the cookie policy and the privacy page (integration audit
// edits-flows-db:auth-fix-round-policy-edits-untracked). A cookie used to reach the two pages only if someone remembered
// to ask: auth's review fixes (claude/nx3-auth, e79d8d9 to d7e0318) add fitx_signin_notice and ask home and the
// integrator for the two policy lines (reports-3/auth.md, "Edits needed from other streams or the integrator"), but
// nothing tied those lines to the merge that brings the cookie. Now the code and the pages must agree both ways: a cookie
// FITX sets fails here until both pages describe it, and a page that describes a cookie FITX doesn't set fails too.
// The pages are JSX, which `node --test` can't load, so their source text is read.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

const cookiePage = read("src/app/(marketing)/cookies/page.tsx");
const ownSection = cookiePage.match(/<h2>FITX’s own cookies<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? "";
const ownItems = ownSection.match(/<li>[\s\S]*?<\/li>/g) ?? [];
const itemFor = (name: string) => ownItems.find((item) => item.includes(`<strong>${name}</strong>`)) ?? "";
const privacyPage = read("src/app/(marketing)/privacy/page.tsx");
const storage = (privacyPage.match(/<h2>Analytics and storage<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? "").replace(/<[^>]+>/g, " ");

/** Text a page must hold: a pattern, or wording agreed word for word (shown in full when it is missing). */
type Says = RegExp | string;
const holds = (text: string, says: Says) => (typeof says === "string" ? text.includes(says) : says.test(text));
const wanted = (says: Says) => (typeof says === "string" ? `: it should read ${says}` : "");

/**
 * What each page says about each cookie: the cookie page's list item, and the privacy page's "Analytics and storage".
 * A cookie FITX sets that has no entry here fails until someone decides what both pages say about it.
 */
const DESCRIBED: Record<string, { item: Says; privacy: Says }> = {
  fitx_auth: { item: /: says a session exists, so public pages can show “Open dashboard”\./, privacy: /\bone that says you are signed in\b/ },
  fitx_intro: { item: /: whether this device still has to play your account’s one-time welcome film\./, privacy: /\bone for your account’s one-time welcome film\b/ },
  fitx_onboarded: { item: /: hold your account ID, so FITX knows you finished setup\b/, privacy: /\btwo that hold your account ID so pages load without an extra check\b/ },
  fitx_intro_checked: { item: /: hold your account ID, so FITX knows you finished setup and checked the film\b/, privacy: /\btwo that hold your account ID so pages load without an extra check\b/ },
  fitx_welcome: { item: /: set for two minutes when an account that has finished setup signs in again\b/, privacy: /\bplus one \(fitx_welcome\) that lasts two minutes after you sign in again, so the next page plays the short FITX logo animation\b/ },
  // Left by Sign out everywhere (LogoutButton) for the sign-in page; it comes with auth's review fix for R3-SEC-1. These
  // are the two lines reports-3/auth.md asks for: they land in the same merge as the cookie, never before it.
  fitx_signin_notice: {
    item: "<li><strong>fitx_signin_notice</strong>: set for two minutes when you use “Sign out everywhere”, just before FITX opens the sign-in page, so that page can say what happened. It holds only the word “everywhere” or “ended”, only the sign-in page can read it, and it is removed as soon as that page has read it.</li>",
    privacy: "plus one (fitx_welcome) that lasts two minutes after you sign in again, so the next page plays the short FITX logo animation, and one (fitx_signin_notice) that lasts two minutes after you use Sign out everywhere, so the sign-in page can say what happened.",
  },
};

/** FITX's own cookies, as src/lib/auth/cookies.ts names them (each `*_COOKIE`), next to Supabase's session cookies. */
async function ownCookies(): Promise<string[]> {
  return Object.entries(await import("@/lib/auth/cookies"))
    .filter(([key, value]) => key.endsWith("_COOKIE") && typeof value === "string")
    .map(([, value]) => value as string);
}

/**
 * The cookies FITX's code writes, each with a file that writes it: a cookie string with attributes, as document.cookie
 * takes it ("name=value; Path=…", the name written out or a `${CONSTANT}`), or a response's cookies.set(CONSTANT or
 * "name", …). The Supabase session cookies are written under names held in variables (SESSION_COOKIE_RE tells them
 * apart), so they never show here; the cookie page's "Essential sign-in storage" covers them.
 */
function writtenCookies(): Map<string, string> {
  const src = new URL("src/", root);
  const files = readdirSync(src, { recursive: true }).map(String).filter((file) => /\.(ts|tsx|mjs|js)$/.test(file));
  const texts = files.map((file) => [file, readFileSync(new URL(file, src), "utf8")] as const);
  const constants = new Map<string, string | null>();
  for (const [, text] of texts) {
    for (const [, name, value] of text.matchAll(/\bconst ([A-Z][A-Z0-9_]*) = "([^"]+)"/g)) {
      constants.set(name, constants.has(name) && constants.get(name) !== value ? null : value);
    }
  }
  const written = new Map<string, string>();
  const note = (file: string, constant: string | undefined, literal: string | undefined) => {
    const name = literal ?? constants.get(constant ?? "");
    assert.ok(name, `${file} sets a cookie named by ${constant}: say which cookie that is`);
    if (!written.has(name)) written.set(name, file);
  };
  for (const [file, text] of texts) {
    for (const found of text.matchAll(/(?:\$\{([A-Z][A-Z0-9_]*)\}|(?<![\w$.-])([a-z][a-z0-9_]*))=[^"'`;\n]*;\s*Path=/g)) note(file, found[1], found[2]);
    for (const found of text.matchAll(/\.cookies\.set\(\s*(?:([A-Z][A-Z0-9_]*)|["'`]([a-z][a-z0-9_-]*)["'`])\s*,/g)) note(file, found[1], found[2]);
  }
  return written;
}

describe("FITX’s own cookies, the cookie policy and the privacy page", () => {
  test("cookies.ts names every cookie FITX’s code writes, and each one it names is written somewhere", async () => {
    const own = await ownCookies();
    const written = writtenCookies();
    assert.ok(own.length > 0 && written.size > 0, "both lists are still found");
    for (const [name, file] of written) {
      assert.ok(own.includes(name), `${file} sets the cookie ${name}: name it in src/lib/auth/cookies.ts, then describe it on the cookie and privacy pages`);
    }
    for (const name of own) assert.ok(written.has(name), `src/lib/auth/cookies.ts names ${name}, but no code here sets it`);
  });

  test("the cookie policy’s “FITX’s own cookies” lists exactly those, each saying what it is for", async () => {
    const own = await ownCookies();
    assert.ok(ownItems.length > 0, "the list is still there, under the same heading");
    const listed = ownItems.flatMap((item) => [...item.matchAll(/<strong>([^<]+)<\/strong>/g)].map((found) => found[1]));
    assert.equal(new Set(listed).size, listed.length, "each cookie is listed once");
    const extra = listed.filter((name) => !own.includes(name));
    assert.deepEqual(extra, [], `the cookie page lists ${extra.join(" and ")}, which FITX doesn’t set`);
    for (const name of own) {
      const described = DESCRIBED[name];
      assert.ok(described, `decide what the cookie page and the privacy page say about ${name}`);
      assert.ok(itemFor(name), `the cookie page’s “FITX’s own cookies” must list ${name}${wanted(described.item)}`);
      assert.ok(holds(itemFor(name), described.item), `the cookie page must say what ${name} is for${wanted(described.item)}`);
    }
  });

  test("the privacy page’s “Analytics and storage” accounts for each of them, and names no other", async () => {
    const own = await ownCookies();
    assert.match(storage, /\bFITX sets a few small cookies of its own: /, "the section still lists FITX’s own cookies");
    for (const name of own) {
      const described = DESCRIBED[name];
      assert.ok(described, `decide what the cookie page and the privacy page say about ${name}`);
      assert.ok(holds(storage, described.privacy), `the privacy page’s “Analytics and storage” must account for ${name}${wanted(described.privacy)}`);
    }
    for (const [name] of storage.matchAll(/\bfitx_[a-z0-9_]+\b/g)) assert.ok(own.includes(name), `the privacy page names ${name}, which FITX doesn’t set`);
  });

  test("a page never describes a cookie before the code sets it", async () => {
    const own = await ownCookies();
    for (const name of Object.keys(DESCRIBED).filter((cookie) => !own.includes(cookie))) {
      assert.doesNotMatch(cookiePage + privacyPage, new RegExp(`\\b${name}\\b`), `${name} is named before FITX sets it`);
    }
  });
});
