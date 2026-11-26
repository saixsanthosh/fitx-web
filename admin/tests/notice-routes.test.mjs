// Every result an Admin action seals reaches a page that opens it (review finding admin-tests-scans-miss-cases, part b;
// BUGS.md 1). An action seals its result into ?notice= or ?state= of the address it redirects to
// (noticeHref(path, code, binding, { param })); the page there opens it with pageNotice(<that parameter>, actor.id)
// and shows its own words for the code. Nothing tied the two together: Users, Support, Explore and Announcements read
// "notice"; Training, Nutrition, Security, Access control, Account, Billing and the sign-in page read "state". A page
// reading the other one, opening it for anyone but the operator who acted, or without words for a code, would drop
// those results without a sound, and every test passed. This reads the code as the compiler does
// (tests/helpers/notice-routes.mjs): each noticeHref's addresses, parameter, binding and codes, through the module's
// own helpers and the modules it imports, and then the page each address belongs to.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseTsx } from "./helpers/jsx-scan.mjs";
import { hasWords, localImports, pageFor, pageReads, routeOf, sealedResults, wordKeys } from "./helpers/notice-routes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const SRC = new URL("../src/", import.meta.url);
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

/** admin/src's .ts and .tsx files by their src-relative names. */
async function adminSources() {
  const files = {};
  for (const name of await readdir(SRC, { recursive: true })) {
    if (/\.tsx?$/.test(name)) files[name] = await readFile(new URL(name, SRC), "utf8");
  }
  return files;
}

/** load() for sealedResults: the parsed module an "@/…" import names, from a set of sources. */
function loaderOf(files) {
  const parsed = new Map();
  return (specifier) => {
    if (!specifier.startsWith("@/")) return null;
    const name = [".ts", ".tsx"].map((extension) => `${specifier.slice(2)}${extension}`).find((candidate) => Object.hasOwn(files, candidate));
    if (!name) return null;
    if (!parsed.has(name)) parsed.set(name, parseTsx(files[name], name));
    return parsed.get(name);
  };
}

/**
 * Whether a page opens a result for the operator it was sealed for: actor.id in the action is the operator who acted,
 * so the page must open it with the id of the operator requireAdmin gave it; SIGN_IN_NOTICE is the sign-in page's own.
 */
function opensFor(read, sealedFor, pageSource) {
  if (sealedFor === "SIGN_IN_NOTICE") return read.binding === "SIGN_IN_NOTICE";
  const holder = /^(\w+)\.id$/.exec(read.binding ?? "")?.[1];
  return sealedFor === "actor.id" && Boolean(holder) && new RegExp(`const ${holder} = await requireAdmin\\(`).test(pageSource);
}

/**
 * What is wrong with where the results sealed in these sources go. `followed` says what an expression the code cannot
 * follow can be: "<file> <expression>" → { paths } or { codes }. Returns the problems and how many results were checked.
 */
function routeProblems(files, followed = {}) {
  const load = loaderOf(files);
  const pages = Object.keys(files).filter((name) => name.endsWith("page.tsx"));
  const words = (page) => {
    const keys = wordKeys(files[page], page);
    for (const specifier of localImports(files[page], page).filter((name) => /notices$/.test(name))) {
      const table = [`${specifier}.ts`, `${specifier}.tsx`].find((candidate) => Object.hasOwn(files, candidate));
      if (table) for (const key of wordKeys(files[table], table)) keys.add(key);
    }
    return keys;
  };
  const problems = [];
  let checked = 0;
  for (const [name, source] of Object.entries(files)) {
    if (name === "lib/notice.ts" || name.endsWith("page.tsx") || !source.includes("noticeHref(")) continue;
    for (const site of sealedResults(source, name, load)) {
      checked += 1;
      const where = `${name}:${site.where}`;
      const paths = [...site.paths.strings];
      const codes = [...site.codes.strings];
      for (const text of new Set(site.paths.unknown)) {
        if (followed[`${name} ${text}`]?.paths) paths.push(...followed[`${name} ${text}`].paths);
        else problems.push(`${where}: cannot tell where ${text} leads`);
      }
      for (const text of new Set(site.codes.unknown)) {
        if (followed[`${name} ${text}`]?.codes) codes.push(...followed[`${name} ${text}`].codes);
        else problems.push(`${where}: cannot tell which codes ${text} can be`);
      }
      if (site.param === null) problems.push(`${where}: the parameter is not a fixed name`);
      const sealedFor = [...new Set(site.bindings)];
      for (const binding of sealedFor) if (!["actor.id", "SIGN_IN_NOTICE"].includes(binding)) problems.push(`${where}: sealed for ${binding}, not the operator who acted`);
      for (const path of new Set(paths)) {
        const page = pageFor(path, pages);
        if (!page) {
          problems.push(`${where}: ${path} is no Admin page`);
          continue;
        }
        const reads = pageReads(files[page], page);
        for (const binding of sealedFor) {
          if (!reads.some((read) => read.param === site.param && opensFor(read, binding, files[page]))) {
            problems.push(`${where}: ${page} does not open ?${site.param}= for ${binding} (it opens ${JSON.stringify(reads)})`);
          }
        }
        const keys = words(page);
        for (const code of new Set(codes)) if (!hasWords(code, keys)) problems.push(`${where}: ${page} has no words for "${code}"`);
      }
    }
  }
  return { problems, checked };
}

// A made-up console: one action module sealing into ?state= for the operator, and its page.
const ACTIONS = `
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { noticeHref } from "@/lib/notice";
import { saveThing } from "@/lib/things";
function done(actorId: string, path: string, state: string): never {
  redirect(noticeHref(path, state, actorId, { param: "state" }));
}
export async function save(formData: FormData) {
  const actor = await requireAdmin("things.manage");
  const back = formData.get("back") === "detail" ? \`/things/\${formData.get("id")}\` : "/things";
  const result = await saveThing(formData);
  done(actor.id, back, result.ok ? "saved" : result.error);
}`;
const LIB = `
export async function saveThing(form: FormData) {
  if (!form.get("name")) return { ok: false, error: "invalid_name" };
  return form.get("id") ? { ok: true } : { ok: false, error: refusal() };
}
function refusal() { return Math.random() > 0.5 ? "taken" : "failed"; }`;
const LIST = `
import { noticeWords, pageNotice } from "@/lib/notice";
import { requireAdmin } from "@/lib/admin-auth";
const NOTICES = { saved: "Saved.", invalid_name: "Give it a name.", taken: "That name is taken.", failed: "That did not complete." };
export default async function Things({ searchParams }) {
  const actor = await requireAdmin("things.view");
  const params = await searchParams;
  return noticeWords(NOTICES, pageNotice(params.state, actor.id));
}`;
const DETAIL = `
import { THING_NOTICES } from "@/components/things/thing-notices";
import { noticeWords, pageNotice } from "@/lib/notice";
import { requireAdmin } from "@/lib/admin-auth";
export default async function Thing({ searchParams }) {
  const operator = await requireAdmin("things.view");
  const { state } = await searchParams;
  return noticeWords(THING_NOTICES, pageNotice(state, operator.id));
}`;
const WORDS = `export const THING_NOTICES = { saved: "Saved.", invalid_name: "Give it a name.", taken: "That name is taken.", failed: "That did not complete." };`;
const world = (changes = {}) => ({
  "app/(control)/things/actions.ts": ACTIONS,
  "lib/things.ts": LIB,
  "app/(control)/things/page.tsx": LIST,
  "app/(control)/things/[id]/page.tsx": DETAIL,
  "components/things/thing-notices.ts": WORDS,
  ...changes,
});

test("the check follows an action's helper, its constants and the module it imports, to both pages it can open on", () => {
  const [site] = sealedResults(ACTIONS, "app/(control)/things/actions.ts", loaderOf(world()));
  assert.deepEqual([...site.paths.strings].sort(), ["/things", "/things/*"]);
  assert.deepEqual([...site.codes.strings].sort(), ["failed", "invalid_name", "saved", "taken"], "the imported function's errors, and its own helper's");
  assert.deepEqual([site.param, site.bindings], ["state", ["actor.id"]]);
  assert.deepEqual([routeOf("app/(control)/things/[id]/page.tsx"), routeOf("app/login/page.tsx")], ["/things/*", "/login"]);
  assert.deepEqual(routeProblems(world()), { problems: [], checked: 1 }, "a console that is right has nothing wrong");
});

test("the check finds each mistake that would drop a result: another parameter, another binding, no words, no page", () => {
  const problems = (changes) => routeProblems(world(changes)).problems;
  // The list reads ?notice= while the action seals into ?state=.
  assert.match(problems({ "app/(control)/things/page.tsx": LIST.replace("params.state", "params.notice") }).join("\n"), /things\/page\.tsx does not open \?state= for actor\.id/);
  // The detail page opens it for the sign-in page's binding instead of the operator.
  assert.match(problems({ "app/(control)/things/[id]/page.tsx": DETAIL.replace("operator.id", "SIGN_IN_NOTICE") }).join("\n"), /\[id\]\/page\.tsx does not open \?state= for actor\.id/);
  // A code the imported function can return has no words on the detail page (its notices module lacks it).
  const noWords = problems({ "components/things/thing-notices.ts": WORDS.replace(' taken: "That name is taken.",', "") });
  assert.equal(noWords.length, 1, noWords.join("\n"));
  assert.match(noWords[0], /^app\/\(control\)\/things\/actions\.ts:13 → 7: app\/\(control\)\/things\/\[id\]\/page\.tsx has no words for "taken"$/, "named by the action's call and the helper's noticeHref");
  // An address with no page, and a binding that is not the operator who acted.
  assert.match(problems({ "app/(control)/things/actions.ts": ACTIONS.replace('"/things";', '"/thingz";') }).join("\n"), /\/thingz is no Admin page/);
  assert.match(problems({ "app/(control)/things/actions.ts": ACTIONS.replace("done(actor.id,", 'done("someone",') }).join("\n"), /sealed for someone/);
  // What the code cannot follow must be named, with what it can be.
  const fromForm = { "app/(control)/things/actions.ts": ACTIONS.replace('result.ok ? "saved" : result.error', 'String(formData.get("state"))') };
  assert.match(problems(fromForm).join("\n"), /cannot tell which codes String\(formData\.get\("state"\)\) can be/);
  assert.deepEqual(routeProblems(world(fromForm), { 'app/(control)/things/actions.ts String(formData.get("state"))': { codes: ["saved"] } }).problems, []);
});

/** The codes moderationNotice() passes on from the database: the explore_<code> refusals (P0002, 22023) the migrations raise. */
async function exploreRefusals() {
  const codes = new Set();
  for (const name of await readdir(MIGRATIONS)) {
    if (!name.endsWith(".sql")) continue;
    const sql = await readFile(new URL(name, MIGRATIONS), "utf8");
    for (const match of sql.matchAll(/errcode = '(?:P0002|22023)', message = 'explore_([a-z_]+)'/g)) codes.add(match[1]);
  }
  return [...codes];
}

test("every result Admin's actions seal opens on a page that reads its parameter, for the operator who acted, in its own words", async () => {
  const files = await adminSources();
  const { ANNOUNCEMENT_STATUSES } = await importTypeScriptModule("src/lib/announcement-input.ts");
  const refusals = await exploreRefusals();
  assert.ok(refusals.length >= 30 && refusals.includes("report_closed"), `${refusals.length} Explore refusals from the database`);
  // listReturn() keeps only a /users address (the list's filters and sealed search), else "/users".
  assert.ok(files["app/(control)/users/actions.ts"].includes('/^\\/users(\\?[^\\s]*)?$/.test(value) && !value.startsWith("//") ? value : "/users"'));
  // setAnnouncementStatus seals the status only after checking it is one of ANNOUNCEMENT_STATUSES.
  assert.match(files["app/(control)/announcements/actions.ts"], /!\(ANNOUNCEMENT_STATUSES as readonly string\[\]\)\.includes\(status\)\) redirect\(noticeHref\(back, "invalid", actor\.id\)\);/);
  const { problems, checked } = routeProblems(files, {
    'app/(control)/users/actions.ts formData.get("return")': { paths: ["/users"] },
    'app/(control)/announcements/actions.ts formData.get("status")': { codes: [...ANNOUNCEMENT_STATUSES] },
    "app/(control)/explore/actions.ts known[1]": { codes: refusals },
  });
  assert.deepEqual(problems, []);
  assert.ok(checked >= 20, `${checked} sealed results checked`);
});
