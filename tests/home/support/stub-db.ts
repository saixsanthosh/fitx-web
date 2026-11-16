// A stand-in for the supabase-js client: records every query chain and answers from handlers, so the
// data layer can be tested against "migration applied" and "migration missing" databases.
export type StubResponse = { data?: unknown; error?: { code: string; message?: string } | null };
export type StubCall = { kind: "rpc" | "from"; name: string; args?: unknown; ops: Array<{ method: string; args: unknown[] }> };
type Handler = (call: StubCall) => StubResponse | undefined;

export class StubDb {
  calls: StubCall[] = [];
  private handler: Handler;
  constructor(handler: Handler) {
    this.handler = handler;
  }

  private respond(call: StubCall) {
    const response = this.handler(call) ?? { data: null, error: null };
    return { data: response.data ?? null, error: response.error ?? null };
  }

  rpc(name: string, args: unknown) {
    const call: StubCall = { kind: "rpc", name, args, ops: [] };
    this.calls.push(call);
    return Promise.resolve(this.respond(call));
  }

  from(table: string) {
    const call: StubCall = { kind: "from", name: table, ops: [] };
    this.calls.push(call);
    const respond = () => this.respond(call);
    const builder: Record<string, unknown> = new Proxy({}, {
      get(_target, property) {
        if (property === "then") {
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(respond()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          call.ops.push({ method: String(property), args });
          return builder;
        };
      },
    });
    return builder;
  }

  /** The calls made to one table or function. */
  callsTo(name: string) {
    return this.calls.filter((call) => call.name === name);
  }
}

/** True when a recorded chain used `method`, optionally with these first arguments. */
export function used(call: StubCall, method: string, ...args: unknown[]) {
  return call.ops.some((op) => op.method === method && args.every((arg, index) => JSON.stringify(op.args[index]) === JSON.stringify(arg)));
}
