/**
 * Time limits for setup's requests, built on sign-in's helper (src/lib/auth/time-limit.ts). Without one, a save that
 * never answered (a stalled connection, a captive portal, a server that hangs) left Continue on "Saving…" until the
 * page was reloaded, with nothing said. Now setup stops waiting at the limit and says so in its own words, and Continue
 * works again with every answer still as typed and keyboard focus where the member left it. Loading the member's
 * details had the same gap ("Loading your profile…" for good): it now ends at its limit with setup's alert and Try again.
 *
 * Unlike Supabase Auth's requests, the database requests a save makes can be cancelled, and a save that runs out of
 * time is: each of them carries the save's AbortSignal (withAbortSignal), which the limit aborts. So nothing of it is
 * left on its way to land after the member's next try and put older answers back, or log the starting weight twice.
 * A request the database had already taken may still go through. Trying again is safe either way: a step saves the
 * same answers again, and the starting weight is logged only when it differs from the newest weigh-in.
 *
 * Pure, so node:test covers it.
 */
import { isTimeLimit, withTimeLimit } from "@/lib/auth/time-limit";

/** How long setup waits, in milliseconds. */
export const SETUP_TIME_LIMIT_MS = {
  /** A step's save, from the press of Continue or Finish setup to the answer to its last request. */
  save: 20_000,
  /** Loading the member's details, when setup opens and after Try again. */
  load: 20_000,
} as const;

/** What setup says beside its buttons when a step's save runs out of time: what happened, and what to do. */
export const SAVE_TIMED_OUT = {
  page: "Saving this page is taking too long, so we stopped waiting. Check your connection and try again.",
  finish: "Finishing setup is taking too long, so we stopped waiting. Check your connection and try again.",
} as const;

/** What it says when a step's save fails without an answer from the database (offline, or a request that broke off). */
export const SAVE_FAILED = {
  page: "We couldn't save this page. Check your connection and try again.",
  finish: "We couldn't finish setting up your account. Please try again.",
} as const;

/**
 * Runs a step's save within its time limit, and gives what to say beside the buttons: null when it saved, the save's
 * own message when the database refused it, SAVE_TIMED_OUT once the limit passes with no answer (what the save still
 * has on its way is then cancelled), and SAVE_FAILED when it broke off. `save` gets the signal to build its requests
 * with (withAbortSignal). `finishing`: the last step, whose button says Finish setup.
 */
export async function saveWithinLimit(
  save: (signal: AbortSignal) => PromiseLike<string | null>,
  { finishing = false, ms = SETUP_TIME_LIMIT_MS.save }: { finishing?: boolean; ms?: number } = {},
): Promise<string | null> {
  const controller = new AbortController();
  try {
    return await withTimeLimit(save(controller.signal), ms);
  } catch (problem) {
    if (!isTimeLimit(problem)) return finishing ? SAVE_FAILED.finish : SAVE_FAILED.page;
    controller.abort();
    return finishing ? SAVE_TIMED_OUT.finish : SAVE_TIMED_OUT.page;
  }
}

/**
 * Runs setup's load within its time limit: true when it ended in time (it has shown what it found), false when it ran
 * out of time or broke off. Setup then shows its alert with Try again, and drops whatever the load brings back later.
 * Nothing is cancelled: Supabase Auth's request can't be, and the load only reads (and creates a missing profile row,
 * which is safe to do again).
 */
export async function loadWithinLimit(load: () => PromiseLike<unknown>, ms: number = SETUP_TIME_LIMIT_MS.load): Promise<boolean> {
  try {
    await withTimeLimit(load(), ms);
    return true;
  } catch {
    return false;
  }
}

/** A database request: whatever Supabase's `from(table)` methods and `rpc()` give can carry an AbortSignal. */
type Cancellable = { abortSignal: (signal: AbortSignal) => unknown };
const cancellable = (value: unknown): value is Cancellable => typeof (value as Partial<Cancellable> | null | undefined)?.abortSignal === "function";

/** The methods of `from(table)` that start a request. The filters chained after them keep its signal. */
const STARTS = new Set(["select", "insert", "update", "upsert", "delete"]);

/** `object`'s value for `key`, a function bound to `object` (so it never runs with a wrapper as `this`). */
function member(object: object, key: PropertyKey): unknown {
  const value: unknown = Reflect.get(object, key);
  return typeof value === "function" ? value.bind(object) : value;
}

/**
 * The same Supabase client, except that every database request built from it carries `signal`: those built with
 * `from(table)` and with `rpc()`, including the ones the shared helpers in src/lib/domain/user-context.ts make for a
 * save (a profile row created on the way, a column tier tried again). Aborting the signal cancels whatever of them is
 * still on its way, and a request started after that ends at once. Everything else is the client itself.
 */
export function withAbortSignal<C extends object>(client: C, signal: AbortSignal): C {
  const carry = (request: unknown) => (cancellable(request) ? request.abortSignal(signal) : request);
  return new Proxy(client, {
    get(target, key) {
      const value = member(target, key);
      if (typeof value !== "function") return value;
      if (key === "rpc") return (...args: unknown[]) => carry(value(...args));
      if (key !== "from") return value;
      return (...args: unknown[]) => {
        const query: unknown = value(...args);
        if (!query || typeof query !== "object") return query;
        return new Proxy(query, {
          get(builder, name) {
            const start = member(builder, name);
            return typeof start === "function" && typeof name === "string" && STARTS.has(name) ? (...input: unknown[]) => carry(start(...input)) : start;
          },
        });
      };
    },
  });
}
