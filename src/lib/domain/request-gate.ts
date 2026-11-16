/**
 * Lets only the newest of overlapping requests apply its result. Call `begin()` before the request
 * and check `isCurrent(ticket)` before using what came back: an older response that arrives late
 * (a week the user has already moved past) is then ignored.
 *
 * No imports, so `node --test` can load this file directly.
 */
export function createRequestGate() {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    isCurrent(ticket: number): boolean {
      return ticket === latest;
    },
  };
}
