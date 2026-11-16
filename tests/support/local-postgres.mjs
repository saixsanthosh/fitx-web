// A throwaway Postgres for SQL tests: a new cluster in a temp folder, reachable only through a Unix
// socket in that folder (no TCP port, so parallel runs never collide), removed when stopped. Databases
// are shaped like a Supabase project by supabase-stub.sql (next to this file) before any migration runs.
// Needs the Postgres server binaries (initdb, pg_ctl, psql) on PATH; `available()` says whether they are.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
/** What a Supabase project has before the first migration: roles, auth, storage, extensions. */
export const SUPABASE_STUB = path.join(HERE, "supabase-stub.sql");

// macOS: without a valid locale the postmaster refuses to start ("became multithreaded during startup").
const ENV = { ...process.env, LC_ALL: "C", LANG: "C", PGTZ: "UTC" };
const MAX_OUTPUT = 64 * 1024 * 1024;

function which(binary) {
  const result = spawnSync("sh", ["-c", `command -v ${binary}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function available() {
  return ["initdb", "pg_ctl", "psql"].every((binary) => which(binary));
}

/** True when a migration turns on pg_cron, which Supabase offers and a plain local PostgreSQL usually lacks. */
export function requiresPgCron(file) {
  return /create\s+extension[^;]*\bpg_cron\b/i.test(readFileSync(file, "utf8"));
}

export class LocalPostgres {
  constructor() {
    this.dir = mkdtempSync(path.join(tmpdir(), "fitx-sql-"));
    this.data = path.join(this.dir, "data");
    this.socket = this.dir;
  }

  start() {
    const init = spawnSync("initdb", ["-D", this.data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-locale", "--no-sync"], { encoding: "utf8", env: ENV });
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
    const options = `-k ${this.socket} -c listen_addresses='' -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c shared_buffers=16MB -c max_connections=20 -c timezone=UTC`;
    const started = spawnSync("pg_ctl", ["-D", this.data, "-o", options, "-l", path.join(this.dir, "server.log"), "-w", "-t", "60", "start"], { encoding: "utf8", env: ENV });
    if (started.status !== 0) throw new Error(`pg_ctl start failed: ${started.stderr || started.stdout}\n${this.log()}`);
    return this;
  }

  log() {
    try { return readFileSync(path.join(this.dir, "server.log"), "utf8"); } catch { return ""; }
  }

  stop() {
    spawnSync("pg_ctl", ["-D", this.data, "-m", "immediate", "-w", "stop"], { encoding: "utf8", env: ENV });
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** Runs SQL as the superuser, or as `role` with the JWT subject `sub`; returns { ok, stdout, stderr }. */
  run(sql, { role, sub } = {}) {
    const preamble = role
      ? `begin;\nset local role ${role};\nselect set_config('request.jwt.claims', '${JSON.stringify(sub ? { sub, role } : { role })}', true) \\g /dev/null\n`
      : "";
    // The lone ";" ends a statement written without one, so "commit" is never read as a column alias
    // (select 1 commit) and the role's transaction never silently rolls back.
    const postamble = role ? "\n;\ncommit;\n" : "\n";
    const file = path.join(this.dir, `q-${process.hrtime.bigint()}.sql`);
    writeFileSync(file, preamble + sql + postamble);
    const result = spawnSync("psql", ["-h", this.socket, "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8", env: ENV, maxBuffer: MAX_OUTPUT });
    rmSync(file, { force: true });
    return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }

  /** Like run, but throws on error. */
  exec(sql, options) {
    const result = this.run(sql, options);
    if (!result.ok) throw new Error(`SQL failed: ${result.stderr}\n--- SQL ---\n${sql}`);
    return result.stdout;
  }

  /** Runs one query that returns a single json/jsonb value and parses it. */
  json(sql, options) {
    const out = this.exec(sql, options);
    const last = out.split("\n").filter(Boolean).pop();
    return last === undefined ? null : JSON.parse(last);
  }

  /**
   * Runs a SQL file as the superuser, stopping at the first error; returns { ok, stdout, stderr }.
   * `singleTransaction` wraps the whole file in one transaction, as `supabase db push` applies a
   * migration, so a failure leaves nothing of it behind.
   */
  runFile(file, { singleTransaction = false } = {}) {
    const args = ["-h", this.socket, "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"];
    if (singleTransaction) args.push("--single-transaction");
    const result = spawnSync("psql", [...args, "-f", file], { encoding: "utf8", env: ENV, maxBuffer: MAX_OUTPUT });
    return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }

  applyFile(file, options) {
    const result = this.runFile(file, options);
    if (!result.ok) throw new Error(`${path.basename(file)} failed: ${result.stderr}`);
  }

  /** Whether pg_cron can be created here: installed and preloaded, as on Supabase. */
  pgCronUsable() {
    return this.run("select 1 from pg_available_extensions where name = 'pg_cron' and current_setting('shared_preload_libraries') ~ '\\mpg_cron\\M'").stdout === "1";
  }

  /**
   * The Supabase stand-in, then the migrations in order. The exercise catalogue parts are only data and
   * are skipped. `before` stops at the first migration whose version is at or after it; `from` starts
   * there and does not load the stand-in again.
   */
  applyMigrations({ skip = /free_exercise_db_part/, before, from } = {}) {
    if (!from) this.applyFile(SUPABASE_STUB);
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql") && !skip.test(name))
      .filter((name) => (!before || name < before) && (!from || name >= from))
      .sort();
    // Supabase offers pg_cron; a plain local PostgreSQL usually lacks it. Migrations that only
    // schedule jobs with it are skipped here rather than failing every test.
    const hasCron = this.pgCronUsable();
    const applied = [];
    for (const name of files) {
      const file = path.join(MIGRATIONS_DIR, name);
      if (!hasCron && requiresPgCron(file)) continue;
      this.applyFile(file);
      applied.push(name);
    }
    return applied;
  }
}
