// Just enough of Supabase (GET /auth/v1/user and PostgREST reads and RPC calls) for the billing routes,
// executed against the throwaway PostgreSQL in pg.ts. The role follows the request like on Supabase:
// the secret key runs as service_role, a signed-in user's token as authenticated with that user's id,
// anything else as anon. So grants, RLS and the security definer functions are the real ones.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { makeJwt } from "../../support/fake-supabase.ts";
import { lit, SqlError, type SqlRole, type TestDatabase } from "./pg.ts";

export type TestUser = { id: string; email: string; name?: string };

const IDENT = /^[a-z_][a-z0-9_]*$/;

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("bad number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return lit(value);
  return lit(JSON.stringify(value));
}

/** PostgREST's HTTP status for a Postgres error, roughly. */
function statusFor(code: string) {
  if (code === "42501") return 403;
  if (code === "42883" || code === "42P01") return 404;
  if (code === "23505") return 409;
  return 400;
}

export class PgRest {
  readonly db: TestDatabase;
  readonly serviceKey: string;
  url = "";
  calls: Array<{ method: string; path: string; role: string }> = [];
  private server!: Server;
  private readonly users = new Map<string, TestUser>();
  private readonly setReturning = new Map<string, boolean>();

  constructor(db: TestDatabase, serviceKey: string) {
    this.db = db;
    this.serviceKey = serviceKey;
  }

  /** Port 0 picks a free port; a fixed one is for serving a built app to a browser. */
  async start(port = 0) {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** A session as @supabase/ssr stores it in the sb-127-auth-token cookie. */
  session(user: TestUser) {
    const token = makeJwt(user.id, 3600);
    this.users.set(token, user);
    return {
      access_token: token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `refresh-${user.id}`,
      user: {
        id: user.id,
        email: user.email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "google" },
        user_metadata: user.name ? { full_name: user.name } : {},
        identities: [],
        created_at: new Date().toISOString(),
      },
    };
  }

  private roleOf(req: IncomingMessage): SqlRole {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (bearer === this.serviceKey) return { role: "service_role" };
    const user = this.users.get(bearer);
    if (user) return { role: "authenticated", userId: user.id };
    return { role: "anon" };
  }

  private async body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    return text ? JSON.parse(text) : undefined;
  }

  private async returnsSet(fn: string) {
    if (!this.setReturning.has(fn)) {
      const rows = await this.db.rows<{ proretset: boolean }>(`select proretset from pg_proc where proname = ${lit(fn)} and pronamespace = 'public'::regnamespace`);
      this.setReturning.set(fn, rows[0]?.proretset ?? false);
    }
    return this.setReturning.get(fn)!;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", this.url);
    // A browser page on another local port may call this server too (local screenshots only).
    const cors: Record<string, string> = req.headers.origin
      ? {
          "access-control-allow-origin": req.headers.origin,
          "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, accept, accept-profile, content-profile, prefer, x-supabase-api-version",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        }
      : {};
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "content-type": "application/json", ...cors });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const role = this.roleOf(req);
    this.calls.push({ method: req.method ?? "GET", path: url.pathname, role: role.role });

    try {
      if (url.pathname === "/auth/v1/user") {
        const user = this.users.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
        if (!user) return send(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
        return send(200, { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: user.name ? { full_name: user.name } : {} });
      }

      const rpc = /^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);
      if (rpc && req.method === "POST") {
        const fn = rpc[1];
        const args = ((await this.body(req)) ?? {}) as Record<string, unknown>;
        const named = Object.entries(args).map(([key, value]) => {
          if (!IDENT.test(key)) throw new Error("bad argument name");
          return `${key} => ${sqlLiteral(value)}`;
        });
        const call = `public.${fn}(${named.join(", ")})`;
        const out = (await this.returnsSet(fn))
          ? await this.db.exec(`select coalesce(json_agg(t), '[]'::json) from ${call} t`, role)
          : await this.db.exec(`select to_json(${call})`, role);
        return send(200, JSON.parse(out || "null"));
      }

      const table = /^\/rest\/v1\/([a-z_][a-z0-9_]*)$/.exec(url.pathname);
      if (table && req.method === "GET") {
        const columns = (url.searchParams.get("select") ?? "*").split(",").map((column) => column.trim());
        if (!columns.every((column) => column === "*" || IDENT.test(column))) return send(400, { code: "PGRST100", message: "unsupported select in test server" });
        const where: string[] = [];
        let order = "";
        let limit = "";
        for (const [key, value] of url.searchParams) {
          if (key === "select") continue;
          if (key === "order") {
            order = ` order by ${value
              .split(",")
              .map((part) => {
                const [column, direction] = part.split(".");
                if (!IDENT.test(column)) throw new Error("bad order");
                return `${column} ${direction === "desc" ? "desc" : "asc"}`;
              })
              .join(", ")}`;
          } else if (key === "limit") {
            limit = ` limit ${Number.parseInt(value, 10)}`;
          } else if (IDENT.test(key) && value.startsWith("eq.")) {
            where.push(`${key} = ${lit(value.slice(3))}`);
          } else {
            return send(400, { code: "PGRST100", message: `unsupported filter ${key} in test server` });
          }
        }
        const sql = `select ${columns.join(", ")} from public.${table[1]}${where.length ? ` where ${where.join(" and ")}` : ""}${order}${limit}`;
        return send(200, await this.db.rows(sql, role));
      }

      return send(404, { message: `test server: no route for ${req.method} ${url.pathname}` });
    } catch (error) {
      if (error instanceof SqlError) return send(statusFor(error.code), { code: error.code, message: error.message, details: null, hint: null });
      return send(500, { message: error instanceof Error ? error.message : "test server error" });
    }
  }
}
