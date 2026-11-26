// The menu's Support badge on a help request's own page (re-check of bug 64, side note): opening an unread request marks
// it read, but the console layout had counted the badge alongside the page, before the mark (Next.js draws a layout and
// its page in parallel), and it keeps that count while the operator moves between pages (a layout is not drawn again
// on a client-side move). So the menu said 5 on the page that had just made it 4. Now the page reads the count again
// after its own mark and tells the menu (src/components/section-counts.tsx); the inbox and the Dashboard tell it what
// they counted too. Every count carries the server time it was asked for, and the newest wins (src/lib/section-counts.ts).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fake, resetFakes, rpcCalls, SESSION_STUBS, setTestEnv, tableCalls } from "./helpers/fakes.mjs";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { shownCounts, withReport } = await importTypeScriptModule("src/lib/section-counts.ts");
const support = await importTypeScriptModule("src/lib/data/support.ts", SESSION_STUBS);
const explore = await importTypeScriptModule("src/lib/data/explore.ts", SESSION_STUBS);

const AGENT = { id: "00000000-0000-4000-8000-0000000000c6", username: "agent", role: "support_agent", sessionId: "s-own", isRoot: false, permissions: ["support.view", "explore.view"] };
const REQUEST = "e189cfcf-0dc9-4b57-9e4b-802b8ad393a3";
const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
const TIMEOUT = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  resetFakes();
  setTestEnv();
  fake.operator = AGENT;
});

async function logged(run) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    return { value: await run(), errors };
  } finally {
    console.error = original;
  }
}

test("the re-check: the layout counted 5 before the mark, the page 4 after it, so the menu shows 4", () => {
  const layout = { "/support": { count: 5, at: 1_000 }, "/explore": { count: 2, at: 1_000 } };
  assert.deepEqual(shownCounts(layout, {}), { "/support": 5, "/explore": 2 }, "until the page reports, as the server drew it");
  const reports = withReport({}, "/support", { count: 4, at: 1_040 });
  assert.deepEqual(shownCounts(layout, reports), { "/support": 4, "/explore": 2 }, "Explore's badge is left alone");
  // Asked for at the same moment as the layout's count: the page's count, read after its mark, wins.
  assert.deepEqual(shownCounts({ "/support": { count: 5, at: 1_040 } }, reports), { "/support": 4 });
  // A layout that asked later (a new request came in after the page's read) is newer, and wins.
  assert.deepEqual(shownCounts({ "/support": { count: 5, at: 1_050 } }, reports), { "/support": 5 });
});

test("moving between pages: a later page's count replaces the layout's, an older one changes nothing, a save's layout wins", () => {
  // Signed in on the Dashboard at 0 with 5 unread; then the inbox and a request, client-side (the layout stays as drawn).
  const layout = { "/support": { count: 5, at: 0 } };
  let held = withReport({}, "/support", { count: 5, at: 20_000 });
  held = withReport(held, "/support", { count: 4, at: 30_000 });
  assert.deepEqual(shownCounts(layout, held), { "/support": 4 });
  // Back to the inbox as it was drawn at 20 000 (it still says 5): older, so it changes nothing, not even the object.
  assert.equal(withReport(held, "/support", { count: 5, at: 20_000 }), held);
  // The same report again (React may run an effect twice): the same object, so nothing draws again.
  assert.equal(withReport(held, "/support", { count: 4, at: 30_000 }), held);
  // The inbox opened again later: its newer count wins, also when it is higher (a member sent a new request).
  held = withReport(held, "/support", { count: 6, at: 40_000 });
  assert.deepEqual(shownCounts(layout, held), { "/support": 6 });
  // A save draws the layout again (a refresh): its newer count wins over what the pages said before.
  assert.deepEqual(shownCounts({ "/support": { count: 3, at: 50_000 } }, held), { "/support": 3 });
});

test("a count that could not be known shows no badge: never 0, and never the older number", () => {
  // Marked read, but the count could not be read afterwards: the layout's 5 is known to be wrong, so no badge.
  assert.deepEqual(shownCounts({ "/support": { count: 5, at: 1_000 } }, { "/support": { count: null, at: 1_040 } }), {});
  assert.deepEqual(shownCounts({ "/support": { count: null, at: 1_000 } }, {}), {});
  assert.deepEqual(shownCounts({ "/explore": { count: 0, at: 1_000 } }, {}), { "/explore": 0 }, "a real 0 stays a 0 (the menu draws no badge for it)");
  assert.deepEqual(shownCounts({}, { "/support": { count: 4, at: 1_040 } }), { "/support": 4 }, "a page's count without one from the layout");
  assert.deepEqual(shownCounts({}, {}), {});
});

test("markSupportRead says whether it marked the request read: only the database's own true", async () => {
  const cases = [
    [{ data: true, error: null }, true, "it was unread"],
    [{ data: false, error: null }, false, "already read"],
    [{ data: "true", error: null }, false, "not the database's boolean"],
    [{ data: null, error: { code: "P0002", message: "Support request not found" } }, false, "gone"],
    [MISSING, false, "an older database"],
  ];
  for (const [answer, marked, why] of cases) {
    resetFakes();
    fake.operator = AGENT;
    fake.handler = (call) => (call.rpc === "fitx_admin_op_support_mark_seen" ? answer : { data: null, error: null });
    const { value, errors } = await logged(() => support.markSupportRead(REQUEST));
    assert.equal(value, marked, why);
    assert.deepEqual(errors, [], why);
    assert.deepEqual(rpcCalls("fitx_admin_op_support_mark_seen")[0].args, { p_operator_id: AGENT.id, p_request_id: REQUEST });
  }
  fake.handler = (call) => (call.rpc === "fitx_admin_op_support_mark_seen" ? TIMEOUT : { data: null, error: null });
  const failed = await logged(() => support.markSupportRead(REQUEST));
  assert.equal(failed.value, false, "a failed call changed nothing");
  assert.ok(failed.errors.some((line) => line.includes("data.support_mark_read")), failed.errors.join("\n"));

  resetFakes();
  fake.operator = AGENT;
  assert.equal(await support.markSupportRead("not-an-id"), false);
  setTestEnv({ SUPABASE_SECRET_KEY: "" });
  assert.equal(await support.markSupportRead(REQUEST), false, "no data access");
  assert.equal(fake.calls.length, 0, "nothing is sent for either");
});

/** The inbox function answers after a short wait, noting when it was called. */
function slowInbox(answer, calledAt) {
  return async (call) => {
    if (call.rpc === "fitx_admin_support_inbox") {
      calledAt.push(Date.now());
      await pause();
      return answer;
    }
    if (call.rpc === "fitx_admin_support_counts") return MISSING;
    if (call.table === "support_requests") return { data: [], count: 0, error: null };
    return { data: [], error: null };
  };
}

const INBOX = { data: { by_status: { open: 4, in_progress: 1 }, unread: 4, open_by_category: {}, unread_by_category: {} }, error: null };

test("the badge's count, the inbox's and the Dashboard's carry the time they were asked for, taken before the read", async () => {
  for (const [name, read, countOf, stampOf] of [
    ["menu", () => support.getSupportUnread(), (value) => value.count, (value) => value.at],
    ["inbox", () => support.listSupportRequests({ status: "active", category: null, mine: false, unread: false, page: 1 }), (value) => value.inbox.unread, (value) => value.countedAt],
    ["Dashboard", () => support.getSupportSummary(), (value) => value.unread, (value) => value.countedAt],
  ]) {
    resetFakes();
    fake.operator = AGENT;
    const calledAt = [];
    fake.handler = slowInbox(INBOX, calledAt);
    const before = Date.now();
    const value = await read();
    assert.equal(countOf(value), 4, name);
    assert.equal(calledAt.length, 1, name);
    assert.ok(stampOf(value) >= before && stampOf(value) <= calledAt[0], `${name}: the stamp is taken before the count is asked for`);
  }
});

test("an unread count that cannot be known reaches the menu as unknown, with its stamp, never as 0", async () => {
  for (const [answer, why] of [[TIMEOUT, "a failed read"], [MISSING, "an older database"], [{ data: { by_status: {}, unread: "lots" }, error: null }, "not a count"]]) {
    resetFakes();
    fake.operator = AGENT;
    fake.handler = slowInbox(answer, []);
    const { value } = await logged(() => support.getSupportUnread());
    assert.equal(value.count, null, why);
    assert.equal(typeof value.at, "number", why);
  }
  setTestEnv({ SUPABASE_SECRET_KEY: "" });
  const keyless = await support.getSupportUnread();
  assert.equal(keyless.count, null, "no data access");
  assert.equal(typeof keyless.at, "number");
  setTestEnv();
});

test("Explore's badge is stamped the same way, and a count that fails is unknown, never 0", async () => {
  const calledAt = [];
  let failing = false;
  fake.handler = async (call) => {
    if (call.rpc === "fitx_admin_role_permissions") return { data: ["explore.view"], error: null };
    if (call.table === "social_reports") {
      calledAt.push(Date.now());
      await pause();
      return failing ? { data: null, count: null, ...TIMEOUT } : { data: null, count: 3, error: null };
    }
    return { data: [], error: null };
  };
  const before = Date.now();
  const waiting = await explore.getExploreWaiting();
  assert.equal(waiting.count, 3);
  assert.ok(waiting.at >= before && waiting.at <= calledAt[0], "the stamp is taken before the count is asked for");
  assert.deepEqual(tableCalls("social_reports")[0].ops.find(([op]) => op === "in"), ["in", "status", ["open", "reviewing"]]);
  failing = true;
  const { value, errors } = await logged(() => explore.getExploreWaiting());
  assert.equal(value.count, null);
  assert.ok(errors.some((line) => line.includes("data.explore_waiting")), errors.join("\n"));
});

test("the request page counts again only after its own mark, and only when that marked it, and tells the menu", async () => {
  const page = await source("app/(control)/support/[id]/page.tsx");
  assert.match(page, /const unread = \(await markSupportRead\(thread\.id\)\) \? await getSupportUnread\(\) : null;/);
  assert.match(page, /\{unread && <SectionCountReport href="\/support" count=\{unread\.count\} at=\{unread\.at\} \/>\}/);
  assert.equal(page.match(/getSupportUnread\(\)/g).length, 1, "no count of its own before the mark");
  assert.equal(page.match(/markSupportRead\(/g).length, 1);
});

test("the inbox and the Dashboard tell the menu what they counted, so the badge says what they say", async () => {
  const inbox = await source("app/(control)/support/page.tsx");
  assert.match(inbox, /\{result\.state === "ready" && <SectionCountReport href="\/support" count=\{result\.inbox\.unread\} at=\{result\.countedAt\} \/>\}/);
  const overview = await source("app/(control)/overview/page.tsx");
  assert.match(overview, /\{support && <SectionCountReport href="\/support" count=\{support\.unread\} at=\{support\.countedAt\} \/>\}/);
  assert.match(overview, /const banner = supportBanner\(support\);/, "the banner reads the same summary");
});

test("the layout gives the menu stamped counts, the shell holds them for the whole console, and both menus draw from it", async () => {
  const layout = await source("app/(control)/layout.tsx");
  assert.match(layout, /hasPermission\(operator, "support\.view"\) && working \? getSupportUnread\(\) : Promise\.resolve\(null\)/);
  assert.match(layout, /hasPermission\(operator, "explore\.view"\) && working \? getExploreWaiting\(\) : Promise\.resolve\(null\)/);
  assert.match(layout, /const counts = \{ \.\.\.\(unread \? \{ "\/support": unread \} : \{\}\), \.\.\.\(waiting \? \{ "\/explore": waiting \} : \{\}\) \};/);
  assert.match(layout, /counts=\{counts\}/);

  const shell = await source("components/admin-shell.tsx");
  const opens = shell.indexOf("<SectionCountsProvider counts={counts}>");
  const at = (text) => shell.indexOf(text);
  assert.ok(opens > 0, "the shell holds the counts");
  assert.ok(opens < at("<AdminNavigation allowed={pages} />") && at("<AdminNavigation") < at("<MobileMenu allowed={pages} theme={theme} />"), "around both menus");
  assert.ok(at("{children}") < at("</SectionCountsProvider>") && at("</main>") < at("</SectionCountsProvider>"), "and around the page, which reports");

  const navigation = await source("components/admin-navigation.tsx");
  assert.match(navigation, /function SectionList\(\{ sections, onNavigate, idPrefix \}: [^\n]*\) \{\n  const pathname = usePathname\(\);\n  const counts = useSectionCounts\(\);/);
  assert.doesNotMatch(navigation, /counts=\{|counts\?:/, "no menu takes counts from the layout directly any more");

  const counts = await source("components/section-counts.tsx");
  assert.match(counts, /^"use client";/);
  assert.match(counts, /setReports\(\(held\) => withReport\(held, href, count\)\)/);
  assert.match(counts, /useMemo\(\(\) => shownCounts\(counts, reports\), \[counts, reports\]\)/, "the layout's newer counts apply as soon as it is drawn again");
  assert.match(counts, /useIsomorphicLayoutEffect\(\(\) => \{\n    report\?\.\(href, \{ count, at \}\);\n  \}, \[report, href, count, at\]\);\n  return null;/, "a report draws nothing, and reports again when its count changes");
  assert.match(counts, /const useIsomorphicLayoutEffect = typeof window === "undefined" \? useEffect : useLayoutEffect;/, "before the browser paints the page");
});
