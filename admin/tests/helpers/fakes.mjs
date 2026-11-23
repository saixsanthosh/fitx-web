// Small stand-ins for Next.js and Supabase so the Admin server modules run under `node --test`.
// Pass `STUBS` to importTypeScriptModule; each test sets what the fakes return through `fake`.

/** What the fakes read and record. Reset it with resetFakes() in a beforeEach. */
export const fake = (globalThis.__fitxAdminFake ??= {});

export function resetFakes() {
  fake.cookies = new Map();
  fake.cookieWrites = [];
  fake.headers = new Headers();
  fake.calls = [];
  fake.handler = () => ({ data: null, error: null });
  fake.session = null;
  fake.operator = null;
}

const navigation = `
export class RedirectSignal extends Error { constructor(url) { super("NEXT_REDIRECT " + url); this.url = url; } }
export class ForbiddenSignal extends Error { constructor() { super("NEXT_HTTP_ERROR_FALLBACK;403"); } }
export function redirect(url) { throw new RedirectSignal(url); }
export function forbidden() { throw new ForbiddenSignal(); }
`;

const headers = `
const fake = globalThis.__fitxAdminFake;
export async function cookies() {
  return {
    get: (name) => (fake.cookies.has(name) ? { name, value: fake.cookies.get(name) } : undefined),
    has: (name) => fake.cookies.has(name),
    set: (name, value, options) => { fake.cookieWrites.push({ name, value, options }); fake.cookies.set(name, value); },
    delete: (name) => { fake.cookieWrites.push({ name, deleted: true }); fake.cookies.delete(name); },
  };
}
export async function headers() { return fake.headers; }
`;

const supabase = `
const fake = globalThis.__fitxAdminFake;
function query(table) {
  const call = { table, ops: [] };
  fake.calls.push(call);
  const builder = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") return (resolve, reject) => Promise.resolve().then(() => fake.handler(call)).then(resolve, reject);
      if (prop === "maybeSingle" || prop === "single") return () => { call.final = prop; return Promise.resolve().then(() => fake.handler(call)); };
      return (...args) => { call.ops.push([prop, ...args]); return builder; };
    },
  });
  return builder;
}
export function createClient() {
  return {
    from: (table) => query(table),
    rpc: (name, args) => { const call = { rpc: name, args }; fake.calls.push(call); return Promise.resolve().then(() => fake.handler(call)); },
    // Storage and Auth calls are recorded the same way: { storage: bucket, op, args } and { auth: method, args }.
    storage: {
      from: (bucket) => {
        const record = (op) => (...args) => { const call = { storage: bucket, op, args }; fake.calls.push(call); return Promise.resolve().then(() => fake.handler(call)); };
        return { list: record("list"), remove: record("remove") };
      },
    },
    auth: {
      admin: new Proxy({}, {
        get: (_target, method) => (...args) => { const call = { auth: method, args }; fake.calls.push(call); return Promise.resolve().then(() => fake.handler(call)); },
      }),
    },
  };
}
`;

const react = `export const cache = (fn) => fn;`;

const adminSession = `
const fake = globalThis.__fitxAdminFake;
export async function readSessionOperator() { return fake.session; }
`;

const adminAuth = `
const fake = globalThis.__fitxAdminFake;
export async function requireAdmin() { if (!fake.operator) throw new Error("no operator"); return fake.operator; }
export function hasPermission(operator, permission) { return operator.permissions.includes(permission); }
`;

export const STUBS = {
  "next/navigation": navigation,
  "next/headers": headers,
  "next/cache": "export function revalidatePath() {}",
  "@supabase/supabase-js": supabase,
  react,
};

/** STUBS plus a fake readSessionOperator, for loading admin-auth.ts on its own. */
export const AUTH_STUBS = { ...STUBS, "@/lib/admin-session": adminSession };
/** STUBS plus a fake requireAdmin, for loading admin-session.ts on its own. */
export const SESSION_STUBS = { ...STUBS, "@/lib/admin-auth": adminAuth };

/** The calls the fake Supabase saw: database functions by name, table queries by table. */
export function rpcCalls(name) {
  return fake.calls.filter((call) => call.rpc === name);
}
export function tableCalls(table) {
  return fake.calls.filter((call) => call.table === table);
}

/** Server-only configuration the modules read; all values are made up. */
export function setTestEnv(extra = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example-project.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "made-up-test-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  Object.assign(process.env, extra);
}
