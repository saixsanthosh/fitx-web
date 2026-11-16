// A tiny stand-in for Supabase Auth + PostgREST on 127.0.0.1, enough for the proxy and auth routes.
// Access tokens are HS256-shaped JWTs, so supabase-js verifies them by calling GET /auth/v1/user.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeUser = { id: string; email: string };
type Profile = { onboarded: boolean; intro_completed_at?: string | null };

const b64url = (value: string) => Buffer.from(value).toString("base64url");

export function makeJwt(sub: string, expiresInSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + expiresInSeconds, session_id: `s-${sub}` }));
  return `${header}.${payload}.${b64url("signature")}`;
}

export class FakeSupabase {
  server!: Server;
  url = "";
  users = new Map<string, FakeUser>();
  profiles = new Map<string, Profile>();
  /** access token -> user id */
  tokens = new Map<string, string>();
  /** refresh token -> { user id, used } */
  refreshTokens = new Map<string, { userId: string; used: boolean }>();
  /** PKCE auth code -> { user id, verifier } */
  codes = new Map<string, { userId: string; verifier: string }>();
  calls: Array<{ method: string; path: string; body?: unknown }> = [];
  profileError: null | { status: number; code: string; message: string } = null;
  introColumnMissing = false;
  patches: Array<{ query: string; body: unknown }> = [];

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
    this.patches = [];
    this.profileError = null;
    this.introColumnMissing = false;
  }

  addUser(user: FakeUser, profile: Profile) {
    this.users.set(user.id, user);
    this.profiles.set(user.id, profile);
  }

  /** A session as supabase-js stores it; `expiresIn` <= 0 makes the access token already expired. */
  issueSession(userId: string, expiresIn = 3600) {
    const access = makeJwt(userId, expiresIn);
    const refresh = `refresh-${userId}-${Math.random().toString(36).slice(2)}`;
    this.tokens.set(access, userId);
    this.refreshTokens.set(refresh, { userId, used: false });
    const user = this.users.get(userId)!;
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      refresh_token: refresh,
      user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {}, identities: [], created_at: new Date().toISOString() },
    };
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return text;
    }
  }

  private async handle(req: IncomingMessage, res: import("node:http").ServerResponse) {
    const url = new URL(req.url ?? "/", this.url);
    const body = req.method === "GET" ? undefined : await this.body(req);
    this.calls.push({ method: req.method ?? "GET", path: `${url.pathname}${url.search}`, body });
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };

    if (url.pathname === "/auth/v1/user") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const userId = this.tokens.get(token);
      const user = userId ? this.users.get(userId) : undefined;
      if (!user) return send(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
      return send(200, { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} });
    }
    if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      const payload = body as Record<string, string>;
      if (grant === "refresh_token") {
        const entry = this.refreshTokens.get(payload.refresh_token);
        if (!entry) return send(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
        if (entry.used) return send(400, { code: 400, error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" });
        entry.used = true;
        return send(200, this.issueSession(entry.userId));
      }
      if (grant === "pkce") {
        const entry = this.codes.get(payload.auth_code);
        if (!entry || entry.verifier !== payload.code_verifier) return send(400, { code: 400, error_code: "bad_code_verifier", msg: "code challenge does not match previously saved code verifier" });
        this.codes.delete(payload.auth_code);
        return send(200, this.issueSession(entry.userId));
      }
      return send(400, { code: 400, msg: "unsupported grant" });
    }
    if (url.pathname === "/auth/v1/logout") return send(204);
    if (url.pathname === "/rest/v1/profiles") {
      const id = (url.searchParams.get("id") ?? "").replace(/^eq\./, "");
      if (req.method === "PATCH") {
        this.patches.push({ query: url.search, body });
        if (this.introColumnMissing) return send(400, { code: "PGRST204", message: "Could not find the 'intro_completed_at' column of 'profiles' in the schema cache" });
        const profile = this.profiles.get(id);
        if (profile && profile.intro_completed_at == null) profile.intro_completed_at = (body as Profile).intro_completed_at ?? null;
        return send(204);
      }
      if (this.profileError) return send(this.profileError.status, { code: this.profileError.code, message: this.profileError.message });
      const select = url.searchParams.get("select") ?? "*";
      if (this.introColumnMissing && select.includes("intro_completed_at")) return send(400, { code: "42703", message: "column profiles.intro_completed_at does not exist" });
      const profile = this.profiles.get(id);
      if (!profile) return send(200, []);
      const row: Record<string, unknown> = {};
      for (const column of select.split(",").map((part) => part.trim())) row[column] = profile[column as keyof Profile] ?? null;
      // maybeSingle() asks for an object (Accept: application/vnd.pgrst.object+json).
      return (req.headers.accept ?? "").includes("vnd.pgrst.object") ? send(200, row) : send(200, [row]);
    }
    return send(404, { message: `fake supabase: no route for ${url.pathname}` });
  }
}

/** Cookie value the way @supabase/ssr stores it (base64url of the JSON-encoded item). */
export function ssrCookieValue(item: unknown) {
  return `base64-${Buffer.from(JSON.stringify(item)).toString("base64url")}`;
}

export const SESSION_COOKIE = "sb-127-auth-token";
