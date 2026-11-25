// A deep Admin link survives sign-in (BUGS.md 62, admin-5): the proxy (no session cookie) and requireAdmin (a session
// that ended while its cookie stayed) both send the operator to /login?next=<the page>, the sign-in page keeps it and
// signing in goes back to it. Only a console page of this site: never another origin, a file route or the sign-in page.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";
import { AUTH_STUBS, fake, resetFakes, SESSION_STUBS, setTestEnv } from "./helpers/fakes.mjs";

const { ADMIN_PATH_HEADER, safeNextPath, signInPath } = await importTypeScriptModule("src/lib/next-path.ts");
const auth = await importTypeScriptModule("src/lib/admin-auth.ts", AUTH_STUBS);

// A small stand-in for next/server: what the proxy returns is recorded, not sent.
const nextServer = `
export class NextResponse {
  static redirect(url, status) { return { kind: "redirect", url: String(url), status, headers: new Headers() }; }
  static next(init) { return { kind: "next", request: init?.request ?? null, headers: new Headers() }; }
}`;
const { proxy } = await importTypeScriptModule("src/proxy.ts", { "next/server": nextServer });

// Made-up names and passwords only.
const ROOT_NAME = "test-owner";
const ROOT_PASSWORD = "made-up root passphrase";
const { hashPassword } = await importTypeScriptModule("src/lib/password.ts");
const ROOT_HASH = await hashPassword(ROOT_PASSWORD);
setTestEnv({ FITX_ADMIN_USERNAME: ROOT_NAME, FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
const login = await importTypeScriptModule("src/app/login/actions.ts", SESSION_STUBS);

const REQUEST = "/support/29df6037-1222-4497-8b17-82de78e7a09f";
const MEMBER = "/users/00000000-0000-4000-8000-0000000000a1";
const REPORT = "/explore/reports/bfc986a6-c220-41f1-916e-c02c397565d6";

beforeEach(() => {
  resetFakes();
  setTestEnv({ FITX_ADMIN_USERNAME: ROOT_NAME, FITX_ADMIN_PASSWORD_HASH: ROOT_HASH });
});

test("a console page below a section is a sign-in destination, with its query (filters, a sealed search)", () => {
  for (const path of [REQUEST, MEMBER, REPORT, "/overview", "/account", "/explore/communities/new", "/training/exercises/dumbbell_bench_press", "/billing/plans/fitx-monthly"]) {
    assert.equal(safeNextPath(path), path, path);
  }
  assert.equal(safeNextPath("/users?status=suspended&method=google&page=2"), "/users?status=suspended&method=google&page=2");
  assert.equal(safeNextPath("/users?s=AbC_-123"), "/users?s=AbC_-123", "the sealed search token comes back too");
  assert.equal(safeNextPath("/users/"), "/users", "a trailing slash is the same page");
  assert.equal(safeNextPath("/support?unread=1&notice=bulk_suspended.3.abc.def&_rsc=1x2y"), "/support?unread=1", "a result notice and Next.js's fetch marker are left behind");
  assert.equal(safeNextPath("/settings?state=saved"), "/settings");
});

test("anything else is not: other sites, odd paths, the sign-in page, file routes, long or malformed values", () => {
  for (const value of [
    "https://evil.example/overview", "//evil.example/overview", "/\\evil.example", "/%5Cevil.example", "javascript:alert(1)",
    "/login", "/login?next=/overview", "/", "", "/overviewx", "/robots.txt", "/audit/export?actor=x", "/reports/export?kind=daily&days=30",
    "/users/../login", "/support/%2F%2Fevil.example", "/support/a b", "/support/a\tb", "/users\n/x", "/users/x?y=" + "z".repeat(520),
    "overview", null, undefined, 42, ["/overview"],
  ]) {
    assert.equal(safeNextPath(value), null, JSON.stringify(value));
  }
});

test("the sign-in address names the page only when it is one", () => {
  assert.equal(signInPath(REQUEST), `/login?next=${encodeURIComponent(REQUEST)}`);
  assert.equal(signInPath("/users?status=suspended"), "/login?next=%2Fusers%3Fstatus%3Dsuspended");
  assert.equal(signInPath("https://evil.example"), "/login");
  assert.equal(signInPath(null), "/login");
});

test("requireAdmin sends an ended session to sign in with the page it was on (the proxy names it)", async () => {
  const outcome = async () => auth.requireAdmin("support.view").then(() => null, (error) => error.url);
  assert.equal(await outcome(), "/login", "no header, no next");
  fake.headers = new Headers({ [ADMIN_PATH_HEADER]: REQUEST });
  assert.equal(await outcome(), `/login?next=${encodeURIComponent(REQUEST)}`);
  fake.headers = new Headers({ [ADMIN_PATH_HEADER]: "//evil.example" });
  assert.equal(await outcome(), "/login", "a header that is not a console page is ignored");
});

function request(path, { cookie = false, method = "GET", headers = {} } = {}) {
  const url = `https://admin.example${path}`;
  const nextUrl = new URL(url);
  return {
    url,
    method,
    nextUrl,
    headers: new Headers({ host: "admin.example", ...headers }),
    cookies: { has: (name) => cookie && name === "__Host-fitx_admin" },
  };
}

test("the proxy keeps the whole deep link for a request without a session cookie", async () => {
  for (const path of [REQUEST, MEMBER, REPORT, "/users?status=suspended", "/overview"]) {
    const response = await proxy(request(path));
    assert.equal(response.kind, "redirect", path);
    assert.equal(response.status, 307);
    assert.equal(new URL(response.url).pathname, "/login");
    assert.equal(new URL(response.url).searchParams.get("next"), path, path);
  }
  const outside = await proxy(request("/no-such-page"));
  assert.equal(new URL(outside.url).searchParams.has("next"), false, "a path outside the console gets plain /login");
  const signIn = await proxy(request("/login?next=%2Fusers"));
  assert.equal(signIn.kind, "next", "the sign-in page itself opens without a session");
});

test("the proxy tells the page where it is, and a header sent by the browser is never passed on", async () => {
  const opened = await proxy(request(`${REQUEST}?notice=x`, { cookie: true, headers: { [ADMIN_PATH_HEADER]: "/overview" } }));
  assert.equal(opened.kind, "next");
  assert.equal(opened.request.headers.get(ADMIN_PATH_HEADER), REQUEST);
  const robots = await proxy(request("/robots.txt", { headers: { [ADMIN_PATH_HEADER]: "/audit" } }));
  assert.equal(robots.request.headers.get(ADMIN_PATH_HEADER), null);
  const action = await proxy(request("/settings", { cookie: true, method: "POST" }));
  assert.equal(action.request.headers.get(ADMIN_PATH_HEADER), "/settings", "a Server Action posts to its page");
});

/** A database where the root signs in. */
function database() {
  fake.handler = (call) => {
    if (call.rpc === "fitx_admin_login_check") return { data: "ok", error: null };
    if (call.rpc === "fitx_admin_login_record") return { data: "recorded", error: null };
    if (call.rpc === "fitx_admin_op_root_sign_in") return { data: "00000000-0000-4000-8000-0000000000aa", error: null };
    if (call.rpc) return { data: 1, error: null };
    if (call.table === "admin_operators") {
      return { data: { id: "00000000-0000-4000-8000-0000000000aa", username: ROOT_NAME, role: "super_admin", is_active: true, is_root: true, password_hash: null, must_change_password: false }, error: null };
    }
    if (call.table === "admin_web_sessions") return { data: { id: "00000000-0000-4000-8000-0000000000ss" }, error: null };
    return { data: [], error: null };
  };
}

async function signIn(next) {
  const form = new FormData();
  form.set("username", ROOT_NAME);
  form.set("password", ROOT_PASSWORD);
  form.set("next", next);
  return login.signIn(null, form).then(() => null, (error) => error.url);
}

test("signing in goes back to the deep link, and anything else goes to the Dashboard", async () => {
  database();
  assert.equal(await signIn(REQUEST), REQUEST);
  assert.equal(await signIn("/users?status=suspended"), "/users?status=suspended");
  assert.equal(await signIn("https://evil.example/"), "/overview");
  assert.equal(await signIn("//evil.example/support"), "/overview");
  assert.equal(await signIn(""), "/overview");
});

test("the sign-in page reads next through the same check", async () => {
  const page = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const next = safeNextPath\(firstParam\(params\.next\)\) \?\? "";/);
  assert.match(page, /redirect\(operator\.mustChangePassword \? "\/account" : next \|\| "\/overview"\)/);
  assert.match(page, /<LoginForm next=\{next\} \/>/);
});
