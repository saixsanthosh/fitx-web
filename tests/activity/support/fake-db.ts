// A small in-memory stand-in for the supabase-js query builder (the calls the activity code makes),
// with PostgREST-like results ({ data, error }). Columns listed in `missingColumns` behave as before
// their migration: selecting them fails with 42703 and writing them with PGRST204.
import type { SupabaseLike } from "@/lib/activity/repository";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export class FakeDb implements SupabaseLike {
  tables: Record<string, Row[]> = { activities: [], activity_track_chunks: [], body_metrics: [], profiles: [], workout_sessions: [] };
  failures: Record<string, { code?: string; message: string; details?: string }> = {};
  missingColumns: Record<string, string[]> = {};
  calls: string[] = [];
  private ids = 0;

  from(table: string) {
    return this.query(this, table);
  }

  private query(db: FakeDb, table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "upsert" | "update" | "delete" = "select";
    let columns = "*";
    let payload: Row[] = [];
    let options: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    const orders: Array<{ column: string; ascending: boolean }> = [];
    let limit = Infinity;
    let range: [number, number] | null = null;
    let single = false;
    let returning = false;
    const missing = () => db.missingColumns[table] ?? [];
    const run = () => {
      db.calls.push(`${mode}:${table}:${columns}`);
      const failure = db.failures[table];
      if (failure) return { data: null, error: failure };
      const absent = missing().find((column) => columns.split(",").map((c) => c.trim()).includes(column));
      if (absent && (mode === "select" || returning)) return { data: null, error: { code: "42703", message: `column ${table}.${absent} does not exist` } };
      const written = missing().find((column) => payload.some((row) => column in row));
      if (written && (mode === "upsert" || mode === "update")) return { data: null, error: { code: "PGRST204", message: `Could not find the '${written}' column of '${table}' in the schema cache` } };
      const rows = db.tables[table] ?? (db.tables[table] = []);
      if (mode === "upsert") {
        const keys = (options.onConflict ?? "").split(",");
        const out: Row[] = [];
        for (const item of payload) {
          const existing = rows.find((row) => keys.every((key) => row[key] === item[key]));
          if (existing) {
            if (!options.ignoreDuplicates) Object.assign(existing, item);
            continue;
          }
          const stored = { id: `00000000-0000-4000-8000-${String(++db.ids).padStart(12, "0")}`, source: table === "activities" && !missing().includes("source") ? "fitx_gps" : undefined, ...item };
          if (stored.source === undefined) delete stored.source;
          rows.push(stored);
          out.push(stored);
        }
        return { data: returning ? out.map((row) => ({ id: row.id })) : null, error: null };
      }
      let matched = rows.filter((row) => filters.every((f) => f(row)));
      if (mode === "update") {
        for (const row of matched) Object.assign(row, payload[0]);
        return { data: returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
      }
      if (mode === "delete") {
        db.tables[table] = rows.filter((row) => !matched.includes(row));
        return { data: null, error: null };
      }
      if (orders.length) {
        matched = [...matched].sort((a, b) => {
          for (const { column, ascending } of orders) {
            const x = String(a[column]);
            const y = String(b[column]);
            if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
      }
      if (range) matched = matched.slice(range[0], range[1] + 1);
      matched = matched.slice(0, limit);
      if (single) return { data: matched[0] ? { ...matched[0] } : null, error: null };
      return { data: matched.map((row) => ({ ...row })), error: null };
    };
    const builder: Record<string, unknown> = {
      select: (list?: string) => { returning = true; if (list) columns = list; return builder; },
      upsert: (rows: Row | Row[], opts: typeof options) => { mode = "upsert"; payload = Array.isArray(rows) ? rows : [rows]; options = opts ?? {}; return builder; },
      update: (row: Row) => { mode = "update"; payload = [row]; return builder; },
      delete: () => { mode = "delete"; return builder; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      lt: (column: string, value: string) => { filters.push((row) => String(row[column]) < value); return builder; },
      gt: (column: string, value: string) => { filters.push((row) => String(row[column]) > value); return builder; },
      gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return builder; },
      not: (column: string) => { filters.push((row) => row[column] !== null && row[column] !== undefined); return builder; },
      order: (column: string, opts: { ascending: boolean }) => { orders.push({ column, ascending: opts.ascending }); return builder; },
      limit: (n: number) => { limit = n; return builder; },
      range: (from: number, to: number) => { range = [from, to]; return builder; },
      maybeSingle: () => { single = true; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  }
}
