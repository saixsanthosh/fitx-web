// A stand-in for the Supabase Auth, Auth admin and Storage endpoints that /api/account uses, on
// 127.0.0.1. Access tokens are HS256-shaped JWTs (so supabase-js verifies them through GET
// /auth/v1/user) carrying an `amr` claim, which is how the route tells how recent a sign-in is.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const b64url = (value: string) => Buffer.from(value).toString("base64url");

export type Entry = { name: string; id: string | null; metadata?: Record<string, unknown> };

export class FakeAccountServer {
  server!: Server;
  url = "";
  secretKey = "test-secret-key";
  users = new Map<string, { id: string; email: string; last_sign_in_at: string }>();
  tokens = new Map<string, string>();
  /** "<bucket>/<prefix>" -> entries */
  files = new Map<string, Entry[]>();
  removed: string[] = [];
  deletedUsers: string[] = [];
  failRemove = false;
  failDelete = false;
  calls: Array<{ method: string; path: string; auth: string }> = [];

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  stop() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset() {
    this.calls = [];
    this.removed = [];
    this.deletedUsers = [];
    this.failRemove = false;
    this.failDelete = false;
    this.files.clear();
  }

  addUser(id: string, email: string, lastSignInAt = new Date().toISOString()) {
    this.users.set(id, { id, email, last_sign_in_at: lastSignInAt });
  }

  /** A session as @supabase/ssr stores it, signed in `signedInSecondsAgo` seconds ago. */
  session(userId: string, signedInSecondsAgo: number) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({
      sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: `s-${userId}`,
      amr: [{ method: "oauth", timestamp: now - signedInSecondsAgo }],
    }));
    const access = `${header}.${payload}.${b64url("signature")}`;
    this.tokens.set(access, userId);
    const user = this.users.get(userId)!;
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: `refresh-${userId}`,
      user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return undefined;
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", this.url);
    const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    this.calls.push({ method: req.method ?? "GET", path: url.pathname, auth });
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const admin = auth === this.secretKey;

    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const user = this.users.get(this.tokens.get(auth) ?? "");
      if (!user) return send(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
      return send(200, { ...user, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} });
    }
    const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (adminUser && req.method === "DELETE") {
      if (!admin) return send(401, { code: 401, msg: "This endpoint requires a valid service key" });
      if (this.failDelete) return send(500, { code: 500, msg: "Database error deleting user" });
      this.deletedUsers.push(adminUser[1]);
      this.users.delete(adminUser[1]);
      return send(200, {});
    }
    const list = url.pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
    if (list && req.method === "POST") {
      if (!admin) return send(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      const { prefix = "", limit = 100, offset = 0 } = ((await this.body(req)) ?? {}) as { prefix?: string; limit?: number; offset?: number };
      const entries = this.files.get(`${list[1]}/${prefix}`) ?? [];
      return send(200, entries.slice(offset, offset + limit));
    }
    const remove = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)$/);
    if (remove && req.method === "DELETE") {
      if (!admin) return send(400, { statusCode: "403", error: "Unauthorized", message: "not allowed" });
      if (this.failRemove) return send(500, { statusCode: "500", error: "internal", message: "storage is down" });
      const { prefixes = [] } = ((await this.body(req)) ?? {}) as { prefixes?: string[] };
      this.removed.push(...prefixes);
      return send(200, prefixes.map((name) => ({ name })));
    }
    return send(404, { message: `fake account server: no route for ${req.method} ${url.pathname}` });
  }
}

export function ssrCookieValue(item: unknown) {
  return `base64-${Buffer.from(JSON.stringify(item)).toString("base64url")}`;
}

export const SESSION_COOKIE = "sb-127-auth-token";
