// Fix round 3f (open-3e-photo-link-limit): the shared user context (UserContextProvider) keeps a signed link to the
// member's stored profile photo for the header and the sidebar. The link request had no time limit, and the renewal was
// set only after an answer, so a request that never answered was never made again until the photo itself changed (the
// header showed its own fetch's link meanwhile). Now each request is waited for 20 s; past that, what the header shows
// stays and the request is made again after a pause (20 s, doubled each time it goes unanswered again, up to the
// renewal's 50 minutes). A link that comes late is still used unless a newer one shows. Answers within 20 s are used as
// before: the link (or none when storage refused it) and the renewal 50 minutes later.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AVATAR_LINK_RETRY_MS,
  AVATAR_LINK_SECONDS,
  AVATAR_LINK_TIME_LIMIT_MS,
  AVATAR_RENEW_MS,
  keepAvatarLink,
  linkRetryPause,
  type SignedLinkAnswer,
} from "@/components/app/avatar-link";
import { USER_CONTEXT_TIME_LIMIT_MS } from "@/components/app/user-context-refresh";
import { preferSharedAccount } from "@/components/layout/accountSummary";

const PHOTO = "11111111-1111-4111-8111-111111111111/avatar-1795632131615.png";
const turn = () => new Promise((resolve) => setImmediate(resolve));
const link = (n: number): SignedLinkAnswer => ({ data: { signedUrl: `https://project.supabase.test/storage/v1/object/sign/fitx-user-media/photo?token=${n}` }, error: null });
const url = (n: number) => link(n).data?.signedUrl ?? null;

/**
 * A stand-in for storage's link request. Each request is recorded with the (mocked) time it was made, and answers only
 * when the test says so: `answer(n, value)` or `fail(n)` for the n-th request (1-based).
 */
function storage() {
  const made: { path: string; at: number; answer: (value: SignedLinkAnswer) => void; fail: (reason: unknown) => void }[] = [];
  const sign = (path: string) =>
    new Promise<SignedLinkAnswer>((resolve, reject) => {
      made.push({ path, at: Date.now(), answer: resolve, fail: reject });
    });
  return {
    sign,
    made,
    times: () => made.map((request) => request.at),
    answer: (n: number, value: SignedLinkAnswer) => made[n - 1].answer(value),
    fail: (n: number) => made[n - 1].fail(new TypeError("Failed to fetch")),
  };
}

/** Everything the provider was given to show, in order. */
function shown() {
  const values: (string | null)[] = [];
  return { values, show: (value: string | null) => void values.push(value) };
}

describe("the shared photo link waits 20 s at most and is asked for again", () => {
  test("the link lasts an hour and is renewed after 50 minutes; each request is waited for 20 s, like the context's refresh", () => {
    assert.equal(AVATAR_LINK_SECONDS, 3600);
    assert.equal(AVATAR_RENEW_MS, 50 * 60 * 1000);
    assert.equal(AVATAR_LINK_TIME_LIMIT_MS, 20_000);
    assert.equal(AVATAR_LINK_TIME_LIMIT_MS, USER_CONTEXT_TIME_LIMIT_MS);
  });

  test("a request that goes unanswered is made again after 20 s, then 40 s, 80 s and so on, never later than the renewal", () => {
    assert.equal(AVATAR_LINK_RETRY_MS, 20_000);
    assert.deepEqual([1, 2, 3, 4].map((misses) => linkRetryPause(misses)), [20_000, 40_000, 80_000, 160_000]);
    assert.equal(linkRetryPause(8), 2_560_000);
    assert.equal(linkRetryPause(9), AVATAR_RENEW_MS, "capped at 50 minutes");
    assert.equal(linkRetryPause(5_000), AVATAR_RENEW_MS);
  });

  test("no photo, a provider's photo and no Supabase ask storage for nothing, as before, a turn later", async () => {
    const store = storage();
    const none = shown();
    keepAvatarLink(null, store.sign, none.show);
    const google = shown();
    keepAvatarLink("https://lh3.googleusercontent.test/a/photo", store.sign, google.show);
    const unset = shown();
    keepAvatarLink(PHOTO, null, unset.show);
    assert.deepEqual([none.values, google.values, unset.values], [[], [], []], "never inside the caller (a React effect)");
    await turn();
    assert.deepEqual(none.values, [null]);
    assert.deepEqual(google.values, ["https://lh3.googleusercontent.test/a/photo"]);
    assert.deepEqual(unset.values, []);
    assert.equal(store.made.length, 0);
  });

  test("an answer within 20 s shows at once and is renewed 50 minutes later, as before; a refused link shows none", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const wait = async (ms: number) => {
      t.mock.timers.tick(ms);
      await turn();
    };
    const store = storage();
    const header = shown();
    keepAvatarLink(PHOTO, store.sign, header.show);
    await turn();
    assert.deepEqual(store.made.map((request) => request.path), [PHOTO]);
    await wait(3_000);
    store.answer(1, link(1));
    await turn();
    assert.deepEqual(header.values, [url(1)]);

    // Nothing at the limit or after it: the next request is the renewal, 50 minutes after the answer.
    await wait(AVATAR_LINK_TIME_LIMIT_MS);
    await wait(AVATAR_RENEW_MS - AVATAR_LINK_TIME_LIMIT_MS - 1);
    assert.deepEqual(store.times(), [0]);
    await wait(1);
    assert.deepEqual(store.times(), [0, 3_000 + AVATAR_RENEW_MS]);

    // Storage refuses the renewal: no link (the header's own link then shows), and the renewal again in 50 minutes.
    store.answer(2, { data: null, error: { message: "Object not found" } });
    await turn();
    assert.deepEqual(header.values, [url(1), null]);
    await wait(AVATAR_RENEW_MS);
    assert.deepEqual(store.times(), [0, 3_000 + AVATAR_RENEW_MS, 3_000 + 2 * AVATAR_RENEW_MS]);
  });

  test("a request that never answers: what shows stays, and it is asked for again with longer pauses until one answers", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const wait = async (ms: number) => {
      t.mock.timers.tick(ms);
      await turn();
    };
    const store = storage();
    const header = shown();
    keepAvatarLink(PHOTO, store.sign, header.show);
    await turn();
    await wait(AVATAR_LINK_TIME_LIMIT_MS - 1);
    await wait(1);
    assert.deepEqual(header.values, [], "past the limit nothing is shown, so the header keeps its own link");
    assert.deepEqual(store.times(), [0]);

    await wait(20_000); // the first pause
    assert.deepEqual(store.times(), [0, 40_000], "asked again, without waiting for the photo to change");
    await wait(AVATAR_LINK_TIME_LIMIT_MS);
    await wait(40_000 - 1);
    assert.deepEqual(store.times(), [0, 40_000]);
    await wait(1);
    assert.deepEqual(store.times(), [0, 40_000, 100_000], "the pause doubles");
    await wait(AVATAR_LINK_TIME_LIMIT_MS);
    await wait(80_000);
    assert.deepEqual(store.times(), [0, 40_000, 100_000, 200_000]);

    // The fourth answers: its link shows, and the renewal follows 50 minutes later.
    await wait(1_000);
    store.answer(4, link(4));
    await turn();
    assert.deepEqual(header.values, [url(4)]);
    // An older request that answers now is not shown: a newer link already is.
    store.answer(1, link(1));
    await turn();
    assert.deepEqual(header.values, [url(4)]);
    await wait(AVATAR_RENEW_MS);
    assert.deepEqual(store.times(), [0, 40_000, 100_000, 200_000, 201_000 + AVATAR_RENEW_MS]);

    // The renewal hangs: the link in use stays, and the pause starts again from 20 s.
    await wait(AVATAR_LINK_TIME_LIMIT_MS);
    await wait(20_000);
    assert.deepEqual(header.values, [url(4)]);
    assert.equal(store.times().at(-1), 201_000 + AVATAR_RENEW_MS + 40_000);
    store.answer(6, link(6));
    await turn();
    assert.deepEqual(header.values, [url(4), url(6)]);
  });

  test("a link that comes late is still used, and the retry it no longer needs is dropped", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const wait = async (ms: number) => {
      t.mock.timers.tick(ms);
      await turn();
    };
    const store = storage();
    const header = shown();
    keepAvatarLink(PHOTO, store.sign, header.show);
    await turn();
    await wait(AVATAR_LINK_TIME_LIMIT_MS);
    await wait(5_000);
    store.answer(1, link(1));
    await turn();
    assert.deepEqual(header.values, [url(1)], "at 25 s, as before the limit");
    await wait(15_000);
    assert.deepEqual(store.times(), [0], "no retry at 40 s");
    await wait(AVATAR_RENEW_MS - 15_000);
    assert.deepEqual(store.times(), [0, 25_000 + AVATAR_RENEW_MS], "the renewal, 50 minutes after the late answer");
  });

  test("an older request answering while a newer one is still out is used, and the newer link replaces it", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const wait = async (ms: number) => {
      t.mock.timers.tick(ms);
      await turn();
    };
    const store = storage();
    const header = shown();
    keepAvatarLink(PHOTO, store.sign, header.show);
    await turn();
    await wait(AVATAR_LINK_TIME_LIMIT_MS);
    await wait(20_000);
    assert.deepEqual(store.times(), [0, 40_000]);
    await wait(5_000);
    store.answer(1, link(1));
    await turn();
    assert.deepEqual(header.values, [url(1)]);
    // The second request's limit no longer matters: the renewal is due, not a retry.
    await wait(AVATAR_LINK_TIME_LIMIT_MS + 40_000);
    assert.deepEqual(store.times(), [0, 40_000]);
    store.answer(2, link(2));
    await turn();
    assert.deepEqual(header.values, [url(1), url(2)], "the newer link, which lasts longer");
    await wait(AVATAR_RENEW_MS);
    assert.deepEqual(store.times(), [0, 40_000, 105_000 + AVATAR_RENEW_MS], "one renewal, 50 minutes after the newer link");
  });

  test("a request that breaks off counts as a refused one: no link, the renewal as usual, nothing left unhandled", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const store = storage();
    const header = shown();
    keepAvatarLink(PHOTO, store.sign, header.show);
    await turn();
    store.fail(1);
    await turn();
    assert.deepEqual(header.values, [null]);
    t.mock.timers.tick(AVATAR_RENEW_MS);
    await turn();
    assert.deepEqual(store.times(), [0, AVATAR_RENEW_MS]);

    const throws = shown();
    keepAvatarLink(PHOTO, () => {
      throw new TypeError("storage is not set up");
    }, throws.show);
    await turn();
    assert.deepEqual(throws.values, [null]);
  });

  test("once stopped (the photo changed, or the provider went) nothing more is shown or asked", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const wait = async (ms: number) => {
      t.mock.timers.tick(ms);
      await turn();
    };
    const store = storage();
    const header = shown();
    const stop = keepAvatarLink(PHOTO, store.sign, header.show);
    await turn();
    await wait(AVATAR_LINK_TIME_LIMIT_MS);
    stop();
    await wait(AVATAR_RENEW_MS);
    assert.deepEqual(store.times(), [0], "no retry after the photo changed");
    store.answer(1, link(1));
    await turn();
    assert.deepEqual(header.values, [], "the old photo's late link never shows");

    const before = shown();
    const stopEarly = keepAvatarLink(PHOTO, store.sign, before.show);
    stopEarly();
    await turn();
    assert.equal(store.made.length, 1, "stopped before its first step: nothing asked");
    assert.deepEqual(before.values, []);
  });

  test("while the shared link is missing, the header shows its own fetch's link, and no photo means none", () => {
    const fetched = { name: "Asha", email: "asha@example.test", avatarUrl: "https://project.supabase.test/own-link" };
    const profile = { name: "Asha Rao", avatar: PHOTO };
    assert.equal(preferSharedAccount(fetched, { status: "ready", data: { email: fetched.email, profile }, avatarUrl: null })?.avatarUrl, fetched.avatarUrl);
    assert.equal(preferSharedAccount(fetched, { status: "ready", data: { email: fetched.email, profile }, avatarUrl: url(1) })?.avatarUrl, url(1));
    assert.equal(preferSharedAccount(fetched, { status: "ready", data: { email: fetched.email, profile: { ...profile, avatar: null } }, avatarUrl: null })?.avatarUrl, null);
  });
});

describe("UserContextProvider keeps the photo link through avatar-link.ts", () => {
  const provider = readFileSync(new URL("../../src/components/app/UserContextProvider.tsx", import.meta.url), "utf8");

  test("the provider's photo effect is keepAvatarLink, and its cleanup is keepAvatarLink's stop", () => {
    assert.match(provider, /import \{ AVATAR_LINK_SECONDS, keepAvatarLink \} from "@\/components\/app\/avatar-link";/);
    assert.match(
      provider,
      /const avatarPath = data\?\.profile\?\.avatar \?\? null;\s*useEffect\(\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*const supabase = createClient\(\);\s*return keepAvatarLink\(\s*avatarPath,\s*supabase \? \(path\) => supabase\.storage\.from\(MEDIA_BUCKET\)\.createSignedUrl\(path, AVATAR_LINK_SECONDS\) : null,\s*setAvatarUrl,\s*\);\s*\}, \[avatarPath\]\);/,
    );
    assert.equal(provider.match(/createSignedUrl\(/g)?.length, 1, "no link request outside the limit");
    assert.doesNotMatch(provider, /AVATAR_RENEW_MS|setTimeout\(/, "the renewal and the retries live in avatar-link.ts");
  });
});
