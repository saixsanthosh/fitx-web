import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";
import { AUTH_STUBS, fake, resetFakes, setTestEnv, STUBS } from "./helpers/fakes.mjs";

const { describeError, redact } = await importTypeScriptModule("src/lib/log.ts");
const { normaliseUsername } = await importTypeScriptModule("src/lib/username.ts");
const auth = await importTypeScriptModule("src/lib/admin-auth.ts", AUTH_STUBS);
const { isSameOrigin, assertSameOrigin } = await importTypeScriptModule("src/lib/same-origin.ts", STUBS);
const { ADMIN_SECTIONS, visibleSections, sectionForPath } = await importTypeScriptModule("src/components/admin-sections.ts");
const { allowedPages, PAGE_PERMISSIONS } = await importTypeScriptModule("src/lib/roles.ts");

beforeEach(() => {
  resetFakes();
  setTestEnv();
});

function session(role, extra = {}) {
  return { sessionId: "s1", operator: { id: "o1", username: "test-operator", role, isRoot: false, mustChangePassword: false, ...extra } };
}

async function outcome(promise) {
  try {
    return { value: await promise };
  } catch (error) {
    if (error?.url) return { redirect: error.url };
    if (/403/.test(error?.message ?? "")) return { forbidden: true };
    throw error;
  }
}

test("usernames are lower case, 3 to 32 characters of a-z, 0-9, dot, dash and underscore", () => {
  assert.equal(normaliseUsername("  SaiX.Santhosh_1 "), "saix.santhosh_1");
  assert.equal(normaliseUsername("abc"), "abc");
  for (const value of [null, undefined, 3, "", "ab", "-starts-with-dash", ".dot", "has space", "x".repeat(33), "émile", "a@b.c", "semi;colon"]) {
    assert.equal(normaliseUsername(value), null, String(value));
  }
  assert.equal(normaliseUsername("x".repeat(32)), "x".repeat(32));
});

test("requireAdmin sends a request without a valid session to /login", async () => {
  assert.deepEqual(await outcome(auth.requireAdmin()), { redirect: "/login" });
  assert.deepEqual(await outcome(auth.requireAdmin("overview.view")), { redirect: "/login" });
  assert.equal(await auth.getAdminOperator(), null, "the login page gets null, never a redirect");
});

test("requireAdmin gives the operator with its role's permissions, and 403 for a permission the role lacks", async () => {
  fake.session = session("viewer");
  const { value } = await outcome(auth.requireAdmin("reports.view"));
  assert.deepEqual({ ...value, permissions: [...value.permissions] }, {
    id: "o1", username: "test-operator", role: "viewer", sessionId: "s1", isRoot: false, mustChangePassword: false, permissions: ["overview.view", "reports.view"],
  });
  assert.deepEqual(await outcome(auth.requireAdmin("people.view")), { forbidden: true });
  assert.deepEqual(await outcome(auth.requireAdmin("access.manage")), { forbidden: true });

  fake.session = session("support_agent");
  assert.ok((await outcome(auth.requireAdmin("support.reply"))).value);
  assert.deepEqual(await outcome(auth.requireAdmin("people.suspend")), { forbidden: true });

  fake.session = session("super_admin", { isRoot: true });
  for (const permission of ["access.manage", "people.delete", "settings.manage", "billing.manage", "security.view"]) {
    assert.ok((await outcome(auth.requireAdmin(permission))).value, permission);
  }
});

test("an operator with a temporary password reaches only /account", async () => {
  fake.session = session("admin", { mustChangePassword: true });
  assert.deepEqual(await outcome(auth.requireAdmin("overview.view")), { redirect: "/account" });
  assert.ok((await outcome(auth.requireAdmin())).value, "the account page itself needs only a session");
});

test("Route Handlers that change data need a same-origin Origin header", () => {
  assert.equal(isSameOrigin("https://admin.example", ["https://admin.example"]), true);
  assert.equal(isSameOrigin(null, ["https://admin.example"]), false);
  assert.equal(isSameOrigin("null", ["https://admin.example"]), false);
  assert.equal(isSameOrigin("https://evil.example", ["https://admin.example", null]), false);
  const request = (origin) => new Request("https://admin.example/audit/export", { method: "POST", headers: origin ? { origin } : {} });
  assert.doesNotThrow(() => assertSameOrigin(request("https://admin.example")));
  assert.throws(() => assertSameOrigin(request("https://evil.example")), /403/);
  assert.throws(() => assertSameOrigin(request(null)), /403/);
});

test("every page, Server Action and Route Handler under (control) calls requireAdmin", async () => {
  const root = new URL("../src/app/(control)/", import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter((name) => /(page\.tsx|actions\.ts|route\.ts|billing-data\.ts)$/.test(name));
  assert.ok(files.length >= 20, String(files.length));
  for (const name of files) {
    const source = await readFile(new URL(name, root), "utf8");
    if (/^import \{ redirect \} from "next\/navigation";\s*\n[^]*export default function \w+\(\) \{\s*redirect\("[^"]+"\);\s*\}\s*$/.test(source)) continue; // a plain redirect page
    assert.match(source, /requireAdmin\(/, name);
    for (const fn of source.matchAll(/export async function (\w+)\(/g)) {
      const body = source.slice(fn.index, source.indexOf("\n}\n", fn.index));
      assert.match(body, /await requireAdmin\(|await getBillingData\(|return \w+\(/, `${name}: ${fn[1]} must call requireAdmin first`);
    }
  }
});

test("the old Google, allowlist and authenticator sign-in is gone and its addresses redirect to /login", async () => {
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  for (const path of ["/signin", "/auth/callback", "/auth/expired", "/mfa", "/mfa/setup", "/access"]) assert.ok(config.includes(`"${path}"`), path);
  assert.match(config, /destination: "\/login",\s*permanent: false/);
  assert.match(config, /authInterrupts: true/);
  const sources = [];
  const src = new URL("../src/", import.meta.url);
  for (const name of await readdir(src, { recursive: true })) if (/\.(ts|tsx)$/.test(name)) sources.push([name, await readFile(new URL(name, src), "utf8")]);
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /signInWithOAuth|FITX_ADMIN_ALLOWED_EMAILS|mfa\.(enroll|verify|challenge)|@supabase\/ssr|createUserSupabase/, name);
  }
  assert.doesNotMatch(await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"), /createServerClient|getClaims|@supabase|\.from\(|\.rpc\(/);
});

test("the ten sections sit at their fixed routes, in order, and show only what a role may open", () => {
  assert.deepEqual(ADMIN_SECTIONS.map((section) => [section.number, section.label, section.routes.map((route) => route.href)]), [
    ["01", "Dashboard", ["/overview"]],
    ["02", "Users", ["/users"]],
    ["03", "Workouts", ["/training"]],
    ["04", "Nutrition", ["/nutrition"]],
    ["05", "Subscriptions", ["/billing"]],
    ["06", "Support", ["/support"]],
    ["07", "Notifications", ["/notifications", "/announcements"]],
    ["08", "Reports", ["/reports"]],
    ["09", "Admin and security", ["/access-control", "/audit", "/security"]],
    ["10", "Settings", ["/settings"]],
  ]);
  for (const section of ADMIN_SECTIONS) for (const route of section.routes) assert.ok(Object.hasOwn(PAGE_PERMISSIONS, route.href), route.href);
  assert.equal(visibleSections(allowedPages("super_admin")).length, 10);
  assert.deepEqual(visibleSections(allowedPages("viewer")).map((section) => section.label), ["Dashboard", "Reports"]);
  const editor = visibleSections(allowedPages("content_editor"));
  assert.deepEqual(editor.map((section) => section.label), ["Dashboard", "Workouts", "Nutrition", "Notifications"]);
  assert.equal(editor[3].href, "/notifications");
  assert.equal(sectionForPath("/users/00000000-0000-4000-8000-000000000001")?.number, "02");
  assert.equal(sectionForPath("/announcements/new")?.number, "07");
  assert.equal(sectionForPath("/account"), null);
});

test("log lines mask emails, IDs, tokens and keys", () => {
  const text = redact(
    "user owner@example.com id 9f1c2b3a-1111-4222-8333-444455556666 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln " +
    "key sb_secret_abc123XYZ hash 0123456789abcdef0123456789abcdef01\nnext line",
  );
  for (const secret of ["owner@example.com", "9f1c2b3a-1111", "eyJhbGci", "sb_secret_abc123XYZ", "0123456789abcdef0123456789abcdef01", "\n"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.match(text, /\[email\].*\[id\].*\[token\].*\[key\].*\[redacted\]/);
});

test("describeError keeps names, codes, statuses and short messages only", () => {
  const error = { code: "PGRST205", message: "Could not find the table 'public.admin_operators'", details: "row detail", hint: "hint" };
  assert.equal(describeError(error), "code=PGRST205 message=\"Could not find the table 'public.admin_operators'\"");
  assert.equal(describeError({ name: "AuthApiError", status: 400, message: "Invalid owner@example.com" }), "name=AuthApiError status=400 message=\"Invalid [email]\"");
  assert.equal(describeError(undefined), "");
  assert.equal(describeError("plain owner@example.com"), "message=\"plain [email]\"");
  assert.ok(describeError({ message: "x ".repeat(500) }).length <= 220);
});
