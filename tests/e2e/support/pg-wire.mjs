// A small PostgreSQL client for the e2e Supabase stand-in: the v3 wire protocol's simple-query flow over
// the throwaway cluster's Unix socket (trust auth, no TCP). Requests from the browser and the Next server
// run concurrently on a few pooled connections, and errors keep Postgres's own fields (code, message,
// detail, hint), which is what PostgREST passes on to supabase-js.
import net from "node:net";
import path from "node:path";

const NUL = Buffer.from([0]);
const cstring = (value) => Buffer.concat([Buffer.from(String(value), "utf8"), NUL]);

/** Postgres error fields by their wire-protocol letter. */
const ERROR_FIELDS = { S: "severity", V: "severityRaw", C: "code", M: "message", D: "detail", H: "hint", P: "position", W: "where", s: "schema", t: "table", c: "column", n: "constraint" };

export class PgError extends Error {
  constructor(fields) {
    super(fields.message ?? "database error");
    this.name = "PgError";
    Object.assign(this, fields);
  }
}

class Connection {
  constructor(socketPath) {
    this.socketPath = socketPath;
    this.buffer = Buffer.alloc(0);
    this.current = null;
    this.chain = Promise.resolve();
    this.closed = false;
  }

  open() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);
      this.socket.on("data", (chunk) => this.onData(chunk));
      this.socket.on("error", (error) => this.fail(error));
      this.socket.on("close", () => { this.closed = true; this.fail(new Error("connection closed")); });
      this.socket.once("connect", () => {
        const params = Buffer.concat([
          cstring("user"), cstring("postgres"), cstring("database"), cstring("postgres"),
          cstring("client_encoding"), cstring("UTF8"), cstring("application_name"), cstring("fitx-e2e-standin"), NUL,
        ]);
        const head = Buffer.alloc(8);
        head.writeInt32BE(8 + params.length, 0);
        head.writeInt32BE(196608, 4);
        this.current = { results: [], error: null, notices: [], resolve: () => resolve(this), reject };
        this.socket.write(Buffer.concat([head, params]));
      });
    });
  }

  fail(error) {
    const current = this.current;
    this.current = null;
    if (current) current.reject(error);
  }

  onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) break;
      const type = String.fromCharCode(this.buffer[0]);
      const payload = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);
      this.message(type, payload);
    }
  }

  message(type, payload) {
    const current = this.current;
    if (!current) return;
    switch (type) {
      case "R": {
        const code = payload.readInt32BE(0);
        if (code !== 0) current.error = new PgError({ code: "28000", message: `unsupported authentication request ${code}` });
        break;
      }
      case "T": {
        const count = payload.readInt16BE(0);
        const fields = [];
        let offset = 2;
        for (let i = 0; i < count; i += 1) {
          const end = payload.indexOf(0, offset);
          const name = payload.toString("utf8", offset, end);
          offset = end + 1;
          const typeOid = payload.readInt32BE(offset + 6);
          offset += 18;
          fields.push({ name, typeOid });
        }
        current.result = { fields, rows: [], command: null };
        break;
      }
      case "D": {
        const count = payload.readInt16BE(0);
        const row = [];
        let offset = 2;
        for (let i = 0; i < count; i += 1) {
          const size = payload.readInt32BE(offset);
          offset += 4;
          if (size < 0) row.push(null);
          else {
            row.push(payload.toString("utf8", offset, offset + size));
            offset += size;
          }
        }
        (current.result ??= { fields: [], rows: [], command: null }).rows.push(row);
        break;
      }
      case "C": {
        const result = current.result ?? { fields: [], rows: [], command: null };
        result.command = payload.toString("utf8", 0, payload.length - 1);
        current.results.push(result);
        current.result = null;
        break;
      }
      case "I":
        current.results.push({ fields: [], rows: [], command: "" });
        break;
      case "E":
      case "N": {
        const fields = {};
        let offset = 0;
        while (offset < payload.length && payload[offset] !== 0) {
          const key = String.fromCharCode(payload[offset]);
          const end = payload.indexOf(0, offset + 1);
          fields[ERROR_FIELDS[key] ?? key] = payload.toString("utf8", offset + 1, end);
          offset = end + 1;
        }
        if (type === "E") current.error ??= new PgError(fields);
        else current.notices.push(fields);
        break;
      }
      case "Z": {
        this.txStatus = String.fromCharCode(payload[0]);
        this.current = null;
        current.resolve({ results: current.results, error: current.error, notices: current.notices, txStatus: this.txStatus });
        break;
      }
      default:
        break; // S (parameter status), K (backend key), and anything else are not needed here.
    }
  }

  /** Sends one simple-query message (it may hold several statements); resolves at ReadyForQuery. */
  query(sql) {
    const run = () => new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("connection closed"));
      const body = cstring(sql);
      const head = Buffer.alloc(5);
      head.write("Q", 0, "latin1");
      head.writeInt32BE(4 + body.length, 1);
      this.current = { results: [], error: null, notices: [], resolve, reject };
      this.socket.write(Buffer.concat([head, body]));
    });
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  close() {
    if (this.closed) return;
    const end = Buffer.alloc(5);
    end.write("X", 0, "latin1");
    end.writeInt32BE(4, 1);
    try { this.socket.end(end); } catch { /* already gone */ }
    this.closed = true;
  }
}

/** A fixed set of connections handed out one request at a time. */
export class PgPool {
  constructor(socketDir, size = 6) {
    this.socketPath = path.join(socketDir, ".s.PGSQL.5432");
    this.size = size;
    this.idle = [];
    this.waiting = [];
    this.all = [];
  }

  async open() {
    for (let i = 0; i < this.size; i += 1) {
      const connection = await new Connection(this.socketPath).open();
      this.all.push(connection);
      this.idle.push(connection);
    }
    return this;
  }

  async acquire() {
    const ready = this.idle.pop();
    if (ready && !ready.closed) return ready;
    if (ready?.closed) return this.replace(ready);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async replace(dead) {
    const connection = await new Connection(this.socketPath).open();
    this.all = this.all.filter((item) => item !== dead).concat(connection);
    return connection;
  }

  release(connection) {
    const waiter = this.waiting.shift();
    if (waiter) waiter(connection);
    else this.idle.push(connection);
  }

  /** Runs `work(connection)` on a pooled connection, rolling back anything it left open. */
  async with(work) {
    const connection = await this.acquire();
    try {
      return await work(connection);
    } finally {
      if (!connection.closed && connection.txStatus && connection.txStatus !== "I") await connection.query("rollback").catch(() => undefined);
      this.release(connection);
    }
  }

  /** One statement batch as the superuser, outside any request role; throws PgError on failure. */
  async exec(sql) {
    return this.with(async (connection) => {
      const out = await connection.query(sql);
      if (out.error) throw out.error;
      return out.results;
    });
  }

  /** The first column of the first row of the last result, as text. */
  async value(sql) {
    const results = await this.exec(sql);
    const last = results.filter((result) => result.fields.length).pop();
    return last?.rows[0]?.[0] ?? null;
  }

  async json(sql) {
    const text = await this.value(sql);
    return text === null ? null : JSON.parse(text);
  }

  close() {
    for (const connection of this.all) connection.close();
  }
}

/** A SQL string literal. */
export const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
/** A quoted SQL identifier. */
export const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;
