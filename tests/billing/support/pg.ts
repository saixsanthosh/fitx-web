// A throwaway PostgreSQL cluster for billing tests: initdb into a temp folder, listen on a Unix socket
// only (no TCP port), apply a Supabase-like baseline (anon/authenticated/service_role roles, auth.users,
// auth.uid(), Supabase's default grants), then the billing migration. When PostgreSQL is not installed
// the suites that need it are skipped.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const BILLING_MIGRATION = path.join(ROOT, "supabase", "migrations", "20261118190000_fitx_billing_razorpay.sql");
const C_LOCALE = { ...process.env, LC_ALL: "C", LANG: "C" };

function findBinDir(): string | null {
  const candidates: string[] = [];
  if (process.env.PG_BIN_DIR) candidates.push(process.env.PG_BIN_DIR);
  try {
    candidates.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    // not on PATH
  }
  candidates.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin");
  return candidates.find((dir) => dir && ["initdb", "pg_ctl", "psql"].every((bin) => existsSync(path.join(dir, bin)))) ?? null;
}

/** Mirrors what a Supabase project has before any FITX migration runs. */
const SUPABASE_BASELINE = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  email varchar(255),
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type SqlRole =
  | { role: "postgres" }
  | { role: "service_role" }
  | { role: "anon" }
  | { role: "authenticated"; userId: string };

export const AS_POSTGRES: SqlRole = { role: "postgres" };
export const AS_SERVICE: SqlRole = { role: "service_role" };
export const AS_ANON: SqlRole = { role: "anon" };
export const asUser = (userId: string): SqlRole => ({ role: "authenticated", userId });

export class SqlError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SqlError";
    this.code = code;
  }
}

/** SQL string literal (tests only build queries from their own values). */
export const lit = (value: string) => `'${value.replaceAll("'", "''")}'`;

function rolePrefix(as: SqlRole) {
  if (as.role === "postgres") return "";
  if (as.role === "authenticated") {
    if (!/^[0-9a-f-]{36}$/.test(as.userId)) throw new Error("bad test user id");
    return `set role authenticated; set request.jwt.claim.sub = ${lit(as.userId)}; `;
  }
  return `set role ${as.role}; `;
}

export class TestDatabase {
  private readonly dir: string;
  private readonly bin: string;

  private constructor(dir: string, bin: string) {
    this.dir = dir;
    this.bin = bin;
  }

  static available(): boolean {
    return findBinDir() !== null;
  }

  /** Starts a fresh cluster with the Supabase baseline and (unless told otherwise) the billing migration. */
  static async start({ migrate = true }: { migrate?: boolean } = {}): Promise<TestDatabase> {
    const bin = findBinDir();
    if (!bin) throw new Error("PostgreSQL binaries not found");
    const dir = mkdtempSync(path.join(tmpdir(), "fxpg-"));
    const db = new TestDatabase(dir, bin);
    await run(path.join(bin, "initdb"), ["-D", path.join(dir, "data"), "-A", "trust", "-U", "postgres", "-E", "UTF8", "--no-locale", "--no-instructions"], { env: C_LOCALE });
    await run(path.join(bin, "pg_ctl"), [
      "-D", path.join(dir, "data"),
      "-o", `-c listen_addresses='' -c unix_socket_directories='${dir}' -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=40`,
      "-l", path.join(dir, "postgres.log"),
      "-w", "start",
    ], { env: C_LOCALE });
    await db.exec(SUPABASE_BASELINE);
    if (migrate) await db.file(BILLING_MIGRATION);
    return db;
  }

  private psqlArgs() {
    return ["-h", this.dir, "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
  }

  private static toError(error: unknown): SqlError {
    const stderr = String((error as { stderr?: unknown }).stderr ?? error);
    const match = /ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/.exec(stderr);
    return new SqlError(match?.[1] ?? "XX000", match?.[2] ?? stderr.trim());
  }

  /** Runs SQL (one implicit transaction) as the given role and returns trimmed stdout. */
  async exec(sql: string, as: SqlRole = AS_POSTGRES): Promise<string> {
    try {
      const { stdout } = await run(path.join(this.bin, "psql"), [...this.psqlArgs(), "-c", `${rolePrefix(as)}${sql}`], { env: C_LOCALE, maxBuffer: 16 * 1024 * 1024 });
      return stdout.trim();
    } catch (error) {
      throw TestDatabase.toError(error);
    }
  }

  async file(file: string): Promise<void> {
    try {
      await run(path.join(this.bin, "psql"), [...this.psqlArgs(), "-f", file], { env: C_LOCALE });
    } catch (error) {
      throw TestDatabase.toError(error);
    }
  }

  /** Rows of a query as JSON objects. */
  async rows<T = Record<string, unknown>>(sql: string, as: SqlRole = AS_POSTGRES): Promise<T[]> {
    const out = await this.exec(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`, as);
    return JSON.parse(out) as T[];
  }

  /** A single JSON value (the first column of the first row). */
  async value<T = unknown>(sql: string, as: SqlRole = AS_POSTGRES): Promise<T> {
    const out = await this.exec(`select to_json((${sql}))`, as);
    return JSON.parse(out) as T;
  }

  async stop(): Promise<void> {
    try {
      await run(path.join(this.bin, "pg_ctl"), ["-D", path.join(this.dir, "data"), "-m", "immediate", "-w", "stop"], { env: C_LOCALE });
    } finally {
      rmSync(this.dir, { recursive: true, force: true });
    }
  }
}

export async function addUser(db: TestDatabase, id: string, email: string) {
  await db.exec(`insert into auth.users (id, email) values (${lit(id)}, ${lit(email)})`);
}

export async function addPlan(
  db: TestDatabase,
  plan: { code: string; name: string; amount: number; period: "monthly" | "yearly"; testPlanId?: string; livePlanId?: string; active?: boolean; features?: string[] },
): Promise<string> {
  const features = `array[${(plan.features ?? []).map(lit).join(",")}]::text[]`;
  const optional = (value: string | undefined) => (value ? lit(value) : "null");
  await db.exec(
    `insert into public.billing_plans (code, name, amount_paise, billing_period, razorpay_plan_id_test, razorpay_plan_id_live, is_active, features)
     values (${lit(plan.code)}, ${lit(plan.name)}, ${plan.amount}, ${lit(plan.period)}, ${optional(plan.testPlanId)}, ${optional(plan.livePlanId)},
             ${plan.active === false ? "false" : "true"}, ${features})`,
  );
  return db.value<string>(`select id from public.billing_plans where code = ${lit(plan.code)}`);
}
