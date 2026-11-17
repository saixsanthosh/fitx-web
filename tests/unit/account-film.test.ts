import { test } from "node:test";
import assert from "node:assert/strict";
import { accountFilmClaimedElsewhere, whenAccountFilmOpens, type AccountFilmWindow } from "@/components/brand/accountFilm";
import { ACCOUNT_FILM_STARTED_KEY, INTRO_PENDING_EVENT } from "@/components/brand/introKeys";

/** <html> as the head script leaves it (`data-fitx-intro-gate`), and the window it announces on. */
function page(gate?: string) {
  const dataset: Record<string, string | undefined> = gate ? { fitxIntroGate: gate } : {};
  return { root: { dataset } as unknown as Pick<HTMLElement, "dataset">, events: new EventTarget(), dataset };
}

test("records the account's film once, as soon as the app starts on a page where the head script opened it", () => {
  const { root, events, dataset } = page("account");
  let reports = 0;
  whenAccountFilmOpens(() => reports++, root, events);
  assert.equal(reports, 1);
  assert.equal(dataset.fitxIntroGate, undefined);
  events.dispatchEvent(new Event(INTRO_PENDING_EVENT));
  assert.equal(reports, 1, "once");
});

test("a tab that loaded hidden records it only when the film opens there, on being shown", () => {
  // The head script waits while the tab is hidden, so the app starts before the film is open.
  const { root, events, dataset } = page();
  let reports = 0;
  const stop = whenAccountFilmOpens(() => reports++, root, events);
  assert.equal(reports, 0, "nothing for a tab nobody has looked at");
  dataset.fitxIntroGate = "account";
  events.dispatchEvent(new Event(INTRO_PENDING_EVENT));
  assert.equal(reports, 1);
  events.dispatchEvent(new Event(INTRO_PENDING_EVENT));
  assert.equal(reports, 1, "once");
  stop();
});

test("never records the visitor's film, a replay, or a page whose film never opened", () => {
  for (const gate of ["visitor", "replay", undefined]) {
    const { root, events } = page(gate);
    let reports = 0;
    const stop = whenAccountFilmOpens(() => reports++, root, events);
    events.dispatchEvent(new Event(INTRO_PENDING_EVENT));
    assert.equal(reports, 0, String(gate));
    stop();
  }
  // Leaving the page stops listening.
  const { root, events, dataset } = page();
  let reports = 0;
  whenAccountFilmOpens(() => reports++, root, events)();
  dataset.fitxIntroGate = "account";
  events.dispatchEvent(new Event(INTRO_PENDING_EVENT));
  assert.equal(reports, 0);
});

const tab = (mine: string | undefined, latest: string | null | Error): AccountFilmWindow => ({
  __fitxAccountFilm: mine,
  localStorage: {
    getItem: (key: string) => {
      if (latest instanceof Error) throw latest;
      return key === ACCOUNT_FILM_STARTED_KEY ? latest : null;
    },
  },
});

test("of tabs that opened the account's film at the same moment, only the one that claimed it last plays it", () => {
  // Three tabs ran the head script within the same few milliseconds; the last claim is what storage holds.
  const claims = ["1800000000000.11", "1800000000000.52", "1800000000001.07"];
  const latest = claims[1];
  assert.deepEqual(claims.map((claim) => accountFilmClaimedElsewhere(tab(claim, latest))), [true, false, true]);
});

test("plays as usual whenever another claim can't be seen", () => {
  assert.equal(accountFilmClaimedElsewhere(tab("1800000000000.11", "1800000000000.11")), false, "its own claim");
  assert.equal(accountFilmClaimedElsewhere(tab(undefined, "1800000000000.11")), false, "this page opened no account film");
  assert.equal(accountFilmClaimedElsewhere(tab("1800000000000.11", null)), false, "nothing stored (storage cleared, or signed out since)");
  assert.equal(accountFilmClaimedElsewhere(tab("1800000000000.11", new Error("SecurityError"))), false, "storage blocked");
});
