// Local stand-in for Supabase (Auth + PostgREST + RPC + Storage) over a throwaway PostgreSQL 17 cluster with
// every FITX migration applied (the pg_cron schedule is skipped when pg_cron is not installed). Started from
// the home phase's dev-backend/server.mjs and grown for the signed-in e2e flows. Each request runs as the
// role its JWT names (anon, authenticated with the JWT's claims, or service_role), so row level security,
// grants, triggers and RPCs are the database's own. Test fixtures only: it listens on loopback and nothing
// leaves this machine.
//
//   E2E_OUT=<dir> node tests/e2e/support/server.mjs
//     E2E_DB_HOST (fitx-e2e-db.localhost) and E2E_DB_PORT (3721) name the address the app is built against;
//     E2E_ACCESS_TTL sets the access-token lifetime in seconds (3600, as on Supabase).
//   Writes <E2E_OUT>/standin.json (URL, keys, cluster folder) when ready and logs every request to
//   <E2E_OUT>/standin-requests.jsonl. SIGTERM / SIGINT stop the server and remove the cluster.
import http from "node:http";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalPostgres, MIGRATIONS_DIR } from "../../support/local-postgres.mjs";
import { AuthService } from "./auth.mjs";
import { apiKeys, E2E_JWT_SECRET, verifyJwt } from "./jwt.mjs";
import { lit, PgPool, qi } from "./pg-wire.mjs";
import { handleRest, RestError, restErrorFromPg, SchemaCache } from "./postgrest.mjs";
import { StorageService } from "./storage.mjs";

const HOST = process.env.E2E_DB_HOST ?? "fitx-e2e-db.localhost";
const PORT = Number(process.env.E2E_DB_PORT ?? 3721);
const PUBLIC_URL = `http://${HOST}:${PORT}`;
const OUT = process.env.E2E_OUT ?? mkdtempSync(path.join(tmpdir(), "fitx-e2e-"));
const ACCESS_TTL = Number(process.env.E2E_ACCESS_TTL ?? 3600);
const ROLES = new Set(["anon", "authenticated", "service_role"]);
mkdirSync(OUT, { recursive: true });
const REQUEST_LOG = path.join(OUT, "standin-requests.jsonl");

const keys = apiKeys(E2E_JWT_SECRET);
const servers = [];
let pool = null;
let stopping = false;

const pg = new LocalPostgres().start();
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const server of servers) server.close();
  try { pool?.close(); } catch { /* already closed */ }
  pg.stop();
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(0));
process.on("uncaughtException", (error) => {
  console.error("[standin] fatal", error);
  stop(1);
});

// Every migration, the free-exercise-db catalogue parts included; applyMigrations skips pg_cron ones itself.
const started = Date.now();
const applied = pg.applyMigrations({ skip: /^$/ });
const skipped = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql") && !applied.includes(name));
console.log(`[standin] ${applied.length} migrations applied in ${((Date.now() - started) / 1000).toFixed(1)} s; skipped: ${skipped.join(", ") || "none"}`);

pool = await new PgPool(pg.socket, 8).open();
const schema = await new SchemaCache(pool).load();

/** A transaction as the request's role, the way PostgREST and Storage open one. */
function transaction(ctx) {
  let connection = null;
  let open = false;
  const release = () => {
    if (connection) pool.release(connection);
    connection = null;
    open = false;
  };
  return {
    async run(statements, { readOnly = false } = {}) {
      if (!connection) {
        connection = await pool.acquire();
        open = true;
        const begin = await connection.query(`begin${readOnly ? " read only" : ""}; set local role ${qi(ctx.role)}; set local statement_timeout = '8s';
          select set_config('request.jwt.claims', ${lit(JSON.stringify(ctx.claims))}, true), set_config('request.method', ${lit(ctx.method)}, true),
                 set_config('request.path', ${lit(ctx.path)}, true), set_config('request.headers', ${lit(JSON.stringify(ctx.headers))}, true)`);
        if (begin.error) throw begin.error;
      }
      const out = await connection.query(statements.join(";\n"));
      if (out.error) throw out.error;
      return out.results.filter((result) => result.fields.length).map((result) => result.rows);
    },
    async finish(commit) {
      if (!connection) return;
      const out = await connection.query(commit ? "commit" : "rollback");
      release();
      if (out.error) throw out.error;
    },
    async abort() {
      if (!connection) return;
      if (open) await connection.query("rollback").catch(() => undefined);
      release();
    },
  };
}

const auth = new AuthService({ pool, issuer: `${PUBLIC_URL}/auth/v1`, secret: E2E_JWT_SECRET, accessTtl: ACCESS_TTL });
const storage = new StorageService({ pool, dir: path.join(OUT, "storage-files"), secret: E2E_JWT_SECRET, transaction });

function bearerOf(req) {
  const header = String(req.headers.authorization ?? "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/** The database role and claims for a request, as PostgREST derives them from the JWT. */
function roleOf(req) {
  const token = bearerOf(req) || String(req.headers.apikey ?? "");
  if (!token) return { role: "anon", claims: { role: "anon" } };
  const verified = verifyJwt(token, E2E_JWT_SECRET);
  if (verified.error === "expired") throw new RestError(401, "PGRST303", "JWT expired", null, null);
  if (verified.error) throw new RestError(401, "PGRST301", "No suitable key or wrong key type", null, null);
  const role = verified.claims.role ?? "anon";
  if (!ROLES.has(role)) throw new RestError(401, "PGRST301", `role "${role}" does not exist`, null, null);
  return { role, claims: verified.claims };
}

function corsHeaders(req) {
  if (!req.headers.origin) return {};
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile, range, x-upsert, cache-control, x-supabase-api-version, x-retry-count",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD",
    "access-control-expose-headers": "content-range, content-location, x-supabase-api-version, x-total-count, link, content-disposition",
    "access-control-max-age": "600",
  };
}

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseJson(raw) {
  if (!raw.length) return undefined;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new RestError(400, "PGRST102", "Empty or invalid json", null, null);
  }
}

async function handle(req, res) {
  const startedAt = Date.now();
  const url = new URL(req.url ?? "/", PUBLIC_URL);
  const entry = { at: new Date().toISOString(), method: req.method, path: `${url.pathname}${url.search}`.slice(0, 600), origin: req.headers.origin ?? null };
  const send = (status, payload, headers = {}) => {
    entry.status = status;
    const body = payload === undefined ? "" : Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
    const type = payload === undefined || Buffer.isBuffer(payload) ? {} : { "content-type": "application/json; charset=utf-8" };
    res.writeHead(status, { ...corsHeaders(req), ...type, ...headers });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  try {
    if (req.method === "OPTIONS") return send(204);
    const raw = await readRaw(req);
    const query = url.searchParams;
    const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value]));

    if (url.pathname.startsWith("/auth/v1/")) {
      const route = url.pathname.slice("/auth/v1".length);
      const out = await auth.handle({ method: req.method, route, query, body: parseJson(raw), bearer: bearerOf(req), headers });
      if (out.body?.error_code) entry.code = out.body.error_code;
      return send(out.status, out.body);
    }

    if (url.pathname.startsWith("/storage/v1/")) {
      const route = url.pathname.slice("/storage/v1".length);
      const signedDownload = req.method === "GET" && (route.startsWith("/object/sign/") || route.startsWith("/object/public/"));
      const ctx = signedDownload ? { role: "anon", claims: { role: "anon" } } : roleOf(req);
      entry.role = ctx.role;
      entry.sub = ctx.claims.sub ?? null;
      const isJson = /json/i.test(String(req.headers["content-type"] ?? ""));
      const out = await storage.handle(
        { method: req.method, route, query, body: isJson ? parseJson(raw) : undefined, rawBody: raw, headers },
        { ...ctx, method: req.method, path: route, headers },
      );
      if (out.body?.error) entry.code = out.body.error;
      return out.raw ? send(out.status, out.raw, out.headers) : send(out.status, out.body, out.headers);
    }

    if (url.pathname === "/rest/v1/" || url.pathname === "/rest/v1") return send(200, { swagger: "2.0", info: { title: "FITX e2e stand-in" } });
    if (url.pathname.startsWith("/rest/v1/")) {
      if (!req.headers.apikey && !req.headers.authorization) return send(401, { message: "No API key found in request", hint: "No `apikey` request header or url param was found." });
      const ctx = roleOf(req);
      entry.role = ctx.role;
      entry.sub = ctx.claims.sub ?? null;
      const resource = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
      const tx = transaction({ ...ctx, method: req.method, path: `/${resource}`, headers });
      try {
        const out = await handleRest(schema, tx, { method: req.method, resource, params: query, headers, body: parseJson(raw) });
        return send(out.status, out.body, out.headers);
      } catch (error) {
        await tx.abort();
        throw error.name === "PgError" ? restErrorFromPg(error, ctx.role) : error;
      }
    }

    if (url.pathname.startsWith("/__e2e/")) {
      const ctx = roleOf(req);
      if (ctx.role !== "service_role") return send(403, { message: "service role only" });
      if (url.pathname === "/__e2e/sql" && req.method === "POST") {
        const body = parseJson(raw);
        const results = await pool.exec(String(body?.sql ?? ""));
        return send(200, { results: results.map((result) => ({ command: result.command, fields: result.fields.map((field) => field.name), rows: result.rows })) });
      }
      if (url.pathname === "/__e2e/reload" && req.method === "POST") {
        await schema.load();
        return send(200, { ok: true });
      }
      if (url.pathname === "/__e2e/info") return send(200, { applied, skipped, cluster: pg.dir });
    }

    return send(404, { message: `e2e stand-in: no route for ${req.method} ${url.pathname}` });
  } catch (error) {
    const rest = error instanceof RestError ? error : error?.name === "PgError" ? restErrorFromPg(error, "authenticated") : new RestError(500, "XX000", String(error?.message ?? error));
    entry.code = rest.code;
    entry.error = rest.message.slice(0, 300);
    if (rest.status >= 500) console.error("[standin]", req.method, url.pathname, error);
    return send(rest.status, rest.body());
  } finally {
    entry.ms = Date.now() - startedAt;
    try { appendFileSync(REQUEST_LOG, `${JSON.stringify(entry)}\n`); } catch { /* the log is best effort */ }
  }
}

await Promise.all(["127.0.0.1", "::1"].map((address) => new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => void handle(req, res));
  server.keepAliveTimeout = 5000;
  server.once("error", reject);
  server.listen(PORT, address, () => resolve());
  servers.push(server);
})));

const info = { url: PUBLIC_URL, anonKey: keys.anon, serviceRoleKey: keys.serviceRole, pid: process.pid, cluster: pg.dir, socket: pg.socket, applied: applied.length, skipped };
writeFileSync(path.join(OUT, "standin.json"), JSON.stringify(info, null, 2));
console.log(`[standin] Supabase stand-in on ${PUBLIC_URL} (127.0.0.1 and ::1), cluster ${pg.dir}`);
