// A small stand-in for Supabase Auth + PostgREST on 127.0.0.1 for the coach routes: generic tables
// with owner-only rows (like RLS), the filters the app uses, and the coach's database functions.
// Test data only; no real database or account is ever used.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { makeJwt } from "../../support/fake-supabase.ts";

type Row = Record<string, unknown>;
const OWNER_COLUMN: Record<string, string> = { profiles: "id" };
const PUBLIC_TABLES = new Set(["exercise_library"]);
const COACH_TABLES = ["ai_coach_consents", "ai_coach_threads", "ai_coach_messages", "ai_coach_actions"];

export class FakeCoachDb {
  server!: Server;
  url = "";
  tables = new Map<string, Row[]>();
  tokens = new Map<string, string>();
  users = new Map<string, { id: string; email: string }>();
  /** Simulates the coach migration not being applied yet. */
  coachMissing = false;
  limits = { chat: 30, plan: 6 };
  usage: Array<{ id: string; user_id: string; kind: string; released: boolean }> = [];
  calls: Array<{ method: string; path: string }> = [];
  /** Like Postgres now() across separate requests: every insert gets a later time than the one before. */
  private lastTime = 0;

  now() {
    this.lastTime = Math.max(Date.now(), this.lastTime + 1);
    return new Date(this.lastTime).toISOString();
  }

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
    this.tables.clear();
    this.usage = [];
    this.calls = [];
    this.coachMissing = false;
    this.limits = { chat: 30, plan: 6 };
  }

  rows(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  addUser(id: string, email: string) {
    this.users.set(id, { id, email });
  }

  /** A session cookie value as @supabase/ssr stores it. */
  session(userId: string) {
    const access = makeJwt(userId, 3600);
    this.tokens.set(access, userId);
    const user = this.users.get(userId)!;
    const item = {
      access_token: access,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `refresh-${userId}`,
      user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, identities: [], created_at: new Date().toISOString() },
    };
    return `base64-${Buffer.from(JSON.stringify(item)).toString("base64url")}`;
  }

  private async body(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    return text ? JSON.parse(text) : undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", this.url);
    this.calls.push({ method: req.method ?? "GET", path: `${url.pathname}${url.search}` });
    const send = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const userId = this.tokens.get(token) ?? null;

    if (url.pathname === "/auth/v1/user") {
      const user = userId ? this.users.get(userId) : undefined;
      return user ? send(200, { ...user, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }) : send(403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (!url.pathname.startsWith("/rest/v1/")) return send(404, { message: "no route" });
    const name = url.pathname.slice("/rest/v1/".length);
    const body = req.method === "GET" || req.method === "DELETE" ? undefined : await this.body(req);

    if (name.startsWith("rpc/")) {
      const fn = name.slice(4);
      if (this.coachMissing && fn.startsWith("ai_coach_")) return send(404, { code: "PGRST202", message: `Could not find the function public.${fn}` });
      if (!userId) return send(401, { code: "42501", message: "authentication required" });
      return this.rpc(fn, (body ?? {}) as Row, userId, send);
    }

    if (this.coachMissing && COACH_TABLES.includes(name)) return send(404, { code: "PGRST205", message: `Could not find the table 'public.${name}' in the schema cache` });
    const ownerColumn = OWNER_COLUMN[name] ?? "user_id";
    const visible = (row: Row) => PUBLIC_TABLES.has(name) || (userId !== null && row[ownerColumn] === userId);
    const filtered = this.rows(name).filter(visible).filter((row) => this.matches(row, url.searchParams));
    const prefer = String(req.headers.prefer ?? "");
    const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");
    const reply = (status: number, rows: Row[]) => {
      if (wantsObject) return rows.length === 1 ? send(status, rows[0]) : send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return send(status, rows);
    };

    if (req.method === "GET") {
      let rows = [...filtered];
      const order = url.searchParams.get("order");
      if (order) {
        const keys = order.split(",").map((part) => part.split("."));
        rows.sort((a, b) => {
          for (const [column, direction] of keys) {
            const compared = String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * (direction === "desc" ? -1 : 1);
            if (compared) return compared;
          }
          return 0;
        });
      }
      const limit = Number(url.searchParams.get("limit"));
      if (limit > 0) rows = rows.slice(0, limit);
      return reply(200, rows);
    }
    if (req.method === "POST") {
      const items = (Array.isArray(body) ? body : [body]) as Row[];
      const created: Row[] = [];
      for (const item of items) {
        if (!PUBLIC_TABLES.has(name) && item[ownerColumn] !== userId) return send(403, { code: "42501", message: "new row violates row-level security policy" });
        const conflict = url.searchParams.get("on_conflict");
        const existing = conflict && prefer.includes("merge-duplicates") ? this.rows(name).find((row) => row[conflict] === item[conflict]) : undefined;
        if (existing) {
          Object.assign(existing, item);
          if (name === "ai_coach_consents") existing.updated_at = this.now();
          created.push(existing);
          continue;
        }
        const now = this.now();
        const row: Row = { id: randomUUID(), created_at: now, updated_at: now, ...item };
        // ai_coach_consents_touch_updated_at: the database's clock, whatever the request sent.
        if (name === "ai_coach_consents") row.updated_at = now;
        // Foreign keys: a coach message or proposal needs its owner's thread (and message).
        if ((name === "ai_coach_messages" || name === "ai_coach_actions") && !this.rows("ai_coach_threads").some((thread) => thread.id === row.thread_id && thread.user_id === userId)) {
          return send(409, { code: "23503", message: "foreign key violation" });
        }
        this.rows(name).push(row);
        created.push(row);
      }
      return prefer.includes("return=representation") ? reply(201, created) : send(201);
    }
    if (req.method === "PATCH") {
      for (const row of filtered) {
        Object.assign(row, body as Row);
        if (name === "ai_coach_consents") row.updated_at = this.now();
      }
      return prefer.includes("return=representation") ? reply(200, filtered) : send(204);
    }
    if (req.method === "DELETE") {
      this.tables.set(name, this.rows(name).filter((row) => !filtered.includes(row)));
      if (name === "ai_coach_threads") {
        const ids = new Set(filtered.map((row) => row.id));
        for (const child of ["ai_coach_messages", "ai_coach_actions"]) this.tables.set(child, this.rows(child).filter((row) => !ids.has(row.thread_id)));
      }
      if (name === "ai_coach_messages") {
        const ids = new Set(filtered.map((row) => row.id));
        this.tables.set("ai_coach_actions", this.rows("ai_coach_actions").filter((row) => !ids.has(row.message_id)));
      }
      return prefer.includes("return=representation") ? reply(200, filtered) : send(204);
    }
    return send(405, { message: "method not allowed" });
  }

  private matches(row: Row, params: URLSearchParams) {
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "on_conflict", "columns", "offset"].includes(key)) continue;
      const [op, ...rest] = raw.split(".");
      const value = rest.join(".");
      // A JSON field as text, e.g. data->>safety.
      const [column, field] = key.split("->>");
      const base = row[column];
      const cell = field === undefined ? base : base && typeof base === "object" ? (base as Row)[field] ?? null : null;
      if (op === "eq" && (cell === null || cell === undefined || String(cell) !== value)) return false;
      if (op === "neq" && String(cell) === value) return false;
      if (op === "gt" && !(String(cell ?? "") > value)) return false;
      if (op === "gte" && !(String(cell ?? "") >= value)) return false;
      if (op === "lt" && !(String(cell ?? "") < value)) return false;
      if (op === "lte" && !(String(cell ?? "") <= value)) return false;
      if (op === "is" && !(value === "null" ? cell === null || cell === undefined : String(cell) === value)) return false;
      if (op === "in" && !value.replace(/^\(|\)$/g, "").split(",").map((item) => item.replace(/^"|"$/g, "")).includes(String(cell))) return false;
    }
    return true;
  }

  private rpc(fn: string, args: Row, userId: string, send: (status: number, payload?: unknown) => void) {
    if (fn === "ai_coach_take_quota") {
      const kind = String(args.p_kind) as "chat" | "plan";
      const used = this.usage.filter((event) => event.user_id === userId && event.kind === kind && !event.released).length;
      const limit = this.limits[kind];
      const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
      if (used >= limit) return send(200, [{ allowed: false, event_id: null, used, daily_limit: limit, resets_at: resetsAt }]);
      const id = randomUUID();
      this.usage.push({ id, user_id: userId, kind, released: false });
      return send(200, [{ allowed: true, event_id: id, used: used + 1, daily_limit: limit, resets_at: resetsAt }]);
    }
    if (fn === "ai_coach_release_quota") {
      const event = this.usage.find((item) => item.id === args.p_event_id && item.user_id === userId && !item.released);
      if (event) event.released = true;
      return send(200, Boolean(event));
    }
    if (fn === "ai_coach_quota_status") {
      const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
      return send(200, (["chat", "plan"] as const).map((kind) => ({ quota_kind: kind, used: this.usage.filter((event) => event.user_id === userId && event.kind === kind && !event.released).length, daily_limit: this.limits[kind], resets_at: resetsAt })));
    }
    if (fn === "ai_coach_apply_action") {
      const action = this.rows("ai_coach_actions").find((row) => row.id === args.p_action_id && row.user_id === userId);
      if (!action) return send(400, { code: "P0002", message: "coach action not found" });
      const table = action.kind === "workout_plan" ? "workout_plans" : "custom_foods";
      // Like the migration: already applied unless the member has since deleted or archived that row.
      if (action.status === "applied" && this.rows(table).some((row) => row.id === action.applied_ref && !row.archived_at)) {
        return send(200, [{ action_kind: action.kind, ref_id: action.applied_ref, already_applied: true }]);
      }
      const id = randomUUID();
      const payload = action.payload as Row;
      if (table === "custom_foods") this.rows("custom_foods").push({ id, user_id: userId, ...(payload.custom_food as Row) });
      else this.rows("workout_plans").push({ id, user_id: userId, status: "draft", title: (payload.workout as Row).title });
      Object.assign(action, { status: "applied", applied_ref: id });
      return send(200, [{ action_kind: action.kind, ref_id: id, already_applied: false }]);
    }
    if (fn === "ai_coach_delete_my_data") {
      const threads = this.rows("ai_coach_threads").filter((row) => row.user_id === userId);
      const ids = new Set(threads.map((row) => row.id));
      this.tables.set("ai_coach_threads", this.rows("ai_coach_threads").filter((row) => row.user_id !== userId));
      for (const child of ["ai_coach_messages", "ai_coach_actions"]) this.tables.set(child, this.rows(child).filter((row) => !ids.has(row.thread_id)));
      const consents = this.rows("ai_coach_consents").length;
      this.tables.set("ai_coach_consents", this.rows("ai_coach_consents").filter((row) => row.user_id !== userId));
      return send(200, [{ threads_deleted: threads.length, consent_withdrawn: consents !== this.rows("ai_coach_consents").length }]);
    }
    return send(404, { code: "PGRST202", message: `Could not find the function public.${fn}` });
  }
}
