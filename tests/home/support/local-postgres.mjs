// A throwaway Postgres for SQL tests: a new cluster in a temp folder, reachable only through a Unix
// socket in that folder (no TCP port, so parallel runs never collide), removed when stopped.
// Needs the Postgres server binaries (initdb, pg_ctl, psql) on PATH; `available()` says whether they are.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

// macOS: without a valid locale the postmaster refuses to start ("became multithreaded during startup").
const ENV = { ...process.env, LC_ALL: "C", LANG: "C", PGTZ: "UTC" };

function which(binary) {
  const result = spawnSync("sh", ["-c", `command -v ${binary}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function available() {
  return ["initdb", "pg_ctl", "psql"].every((binary) => which(binary));
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
    const postamble = role ? "\ncommit;\n" : "\n";
    const file = path.join(this.dir, `q-${process.hrtime.bigint()}.sql`);
    writeFileSync(file, preamble + sql + postamble);
    const result = spawnSync("psql", ["-h", this.socket, "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8", env: ENV });
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

  applyFile(file) {
    const result = spawnSync("psql", ["-h", this.socket, "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8", env: ENV });
    if (result.status !== 0) throw new Error(`${path.basename(file)} failed: ${result.stderr}`);
  }

  /**
   * The Supabase stubs, then the migrations in order. The exercise catalogue parts are only data and
   * are skipped. `before` stops at the first migration whose version is at or after it; `from` starts
   * there and does not load the stubs again.
   */
  applyMigrations({ skip = /free_exercise_db_part/, before, from } = {}) {
    if (!from) this.applyFile(path.join(HERE, "supabase-stub.sql"));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql") && !skip.test(name))
      .filter((name) => (!before || name < before) && (!from || name >= from))
      .sort();
    for (const name of files) this.applyFile(path.join(MIGRATIONS_DIR, name));
    return files;
  }
}
