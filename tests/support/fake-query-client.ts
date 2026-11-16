// An in-memory stand-in for the parts of the supabase-js client that the profile and export code use:
// from().select/insert/update/upsert with eq/not/order/limit/range/maybeSingle, rpc() and storage.list.
// It can pretend a column, a table or a database function does not exist yet, like a database that has
// not received a migration. Tests pass it where a SupabaseClient is expected (cast through unknown).

type Row = Record<string, unknown>;
type Failure = { code: string; message: string };
type Result = { data: unknown; error: Failure | null };

export type Call = { table: string; op: string; columns?: string; payload?: unknown; filters: string[]; range?: [number, number] };

export class FakeQueryClient {
  tables: Record<string, Row[]> = {};
  /** table -> columns that the database does not have yet */
  missingColumns: Record<string, string[]> = {};
  /** rpc name -> handler; a name that is not here answers PGRST202 like PostgREST */
  functions: Record<string, () => Result> = {};
  /** Forced failures: "<table>:<op>" -> error */
  failures: Record<string, Failure> = {};
  files: Record<string, Array<{ name: string; id: string | null; metadata?: Row; updated_at?: string }>> = {};
  calls: Call[] = [];
  rpcCalls: string[] = [];

  from(table: string) {
    return new FakeQuery(this, table);
  }

  rpc(name: string) {
    this.rpcCalls.push(name);
    const handler = this.functions[name];
    const result: Result = handler
      ? handler()
      : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} without parameters in the schema cache` } };
    return Promise.resolve(result);
  }

  storage = {
    from: (bucket: string) => ({
      list: async (prefix: string, options: { limit?: number; offset?: number } = {}) => {
        const entries = this.files[`${bucket}/${prefix}`] ?? [];
        const offset = options.offset ?? 0;
        return { data: entries.slice(offset, offset + (options.limit ?? 100)), error: null };
      },
    }),
  };
}

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private columns = "*";
  private returning: string | null = null;
  private payload: Row | Row[] | null = null;
  private options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Array<{ text: string; test: (row: Row) => boolean }> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private rangeWindow: [number, number] | null = null;
  private single = false;

  private client: FakeQueryClient;
  private table: string;

  constructor(client: FakeQueryClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select(columns = "*") {
    if (this.op === "select") this.columns = columns;
    else this.returning = columns;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ text: `${column}=eq.${String(value)}`, test: (row) => row[column] === value });
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) throw new Error(`fake client: unsupported not(${operator})`);
    this.filters.push({ text: `${column}=not.is.null`, test: (row) => row[column] !== null && row[column] !== undefined });
    return this;
  }
  order(column: string, { ascending = true }: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending });
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }
  range(from: number, to: number) {
    this.rangeWindow = [from, to];
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): Result {
    this.client.calls.push({
      table: this.table,
      op: this.op,
      columns: this.op === "select" ? this.columns : this.returning ?? undefined,
      payload: this.payload ?? undefined,
      filters: this.filters.map((filter) => filter.text),
      range: this.rangeWindow ?? undefined,
    });
    const forced = this.client.failures[`${this.table}:${this.op}`];
    if (forced) return { data: null, error: forced };
    const rows = this.client.tables[this.table];
    if (!rows) return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.table}' in the schema cache` } };
    const missing = this.client.missingColumns[this.table] ?? [];

    if (this.op === "select") {
      const wanted = this.columns === "*" ? [] : this.columns.split(",").map((column) => column.trim());
      const absent = wanted.find((column) => missing.includes(column));
      if (absent) return { data: null, error: { code: "42703", message: `column ${this.table}.${absent} does not exist` } };
      let found = rows.filter((row) => this.filters.every((filter) => filter.test(row)));
      for (const { column, ascending } of [...this.orders].reverse()) {
        found = [...found].sort((a, b) => compare(a[column], b[column]) * (ascending ? 1 : -1));
      }
      if (this.rangeWindow) found = found.slice(this.rangeWindow[0], this.rangeWindow[1] + 1);
      if (this.limitCount !== null) found = found.slice(0, this.limitCount);
      const shaped = found.map((row) => (wanted.length ? Object.fromEntries(wanted.map((column) => [column, row[column] ?? null])) : { ...row }));
      if (this.single) {
        if (shaped.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
        return { data: shaped[0] ?? null, error: null };
      }
      return { data: shaped, error: null };
    }

    const payloads = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    for (const payload of payloads) {
      const absent = Object.keys(payload).find((column) => missing.includes(column));
      if (absent) return { data: null, error: { code: "PGRST204", message: `Could not find the '${absent}' column of '${this.table}' in the schema cache` } };
    }

    if (this.op === "insert") {
      for (const payload of payloads) rows.push({ id: `${this.table}-${rows.length + 1}`, ...payload });
      return { data: null, error: null };
    }
    if (this.op === "update") {
      const matched = rows.filter((row) => this.filters.every((filter) => filter.test(row)));
      for (const row of matched) Object.assign(row, payloads[0]);
      return { data: this.returning ? matched.map((row) => ({ id: row.id ?? row.user_id })) : null, error: null };
    }
    // upsert
    const key = this.options.onConflict ?? "id";
    for (const payload of payloads) {
      const existing = rows.find((row) => row[key] === payload[key]);
      if (existing && this.options.ignoreDuplicates) continue;
      if (existing) Object.assign(existing, payload);
      else rows.push({ ...payload });
    }
    return { data: null, error: null };
  }
}

function compare(a: unknown, b: unknown) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}
