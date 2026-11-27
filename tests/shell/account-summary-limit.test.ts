// Fix round 3f (open-3e-account-summary-limit): the shell's own fetch of the member's name, email and photo
// (useAccountSummary, the header's and the sidebar's fallback until the shared user context has the profile) had no
// time limit, and the one request every reader shares was kept for 50 minutes whatever became of it. So a request that
// never answered was handed to every header and sidebar mounted in those 50 minutes: "Your account" until the shared
// context answered. Now a request with no answer within 20 s is dropped, so the next read asks again; the readers that
// were waiting still get its answer if it comes, and an older answer never replaces a newer one. Answers within 20 s
// are kept and shared for 50 minutes, as before.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { USER_CONTEXT_TIME_LIMIT_MS } from "@/components/app/user-context-refresh";
import {
  ACCOUNT_SUMMARY_MAX_AGE_MS,
  ACCOUNT_SUMMARY_TIME_LIMIT_MS,
  fetchAccountSummary,
  sharedSummaryRequest,
  summaryReader,
} from "@/components/layout/account-summary-request";
import { preferSharedAccount, type AccountSummary } from "@/components/layout/accountSummary";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "asha@example.test", user_metadata: {} };
const PHOTO = `${USER.id}/avatar-1795632131615.png`;
const SIGNED = "https://project.supabase.test/storage/v1/object/sign/fitx-user-media/photo?token=t";
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

/** A gate a stand-in request waits behind: `open()` lets its answer through. */
function gate() {
  let open: () => void = () => undefined;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { passed, open };
}

/**
 * A stand-in Supabase client with the shape fetchAccountSummary reads through: the session check answers once `check`
 * has passed (pass never() to make it hang), then the profile row, then the photo's signed link.
 */
function shellClient({
  check = Promise.resolve(),
  profile = { name: "Asha Rao", avatar: PHOTO } as { name: string | null; avatar: string | null } | null,
}: { check?: Promise<unknown>; profile?: { name: string | null; avatar: string | null } | null } = {}) {
  const requests: string[] = [];
  const client = {
    auth: {
      getUser: () => {
        requests.push("auth.getUser");
        return check.then(() => ({ data: { user: USER }, error: null }));
      },
    },
    from: (table: string) => {
      requests.push(table);
      const builder = { select: () => builder, eq: () => builder, maybeSingle: () => Promise.resolve({ data: profile, error: null }) };
      return builder;
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, seconds: number) => {
          requests.push(`sign ${bucket} ${path} ${seconds}`);
          return Promise.resolve({ data: { signedUrl: SIGNED }, error: null });
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, requests };
}

/** Everything a reader was shown, in order. */
function shown() {
  const values: (AccountSummary | null)[] = [];
  return { values, show: (value: AccountSummary | null) => void values.push(value) };
}

const summaryOf = (name: string): AccountSummary => ({ name, email: USER.email, avatarUrl: null });

describe("the shell's own fetch of the name and photo waits 20 s at most", () => {
  test("the limit is 20 s, like the shared context's refresh, and an answer is still kept 50 minutes", () => {
    assert.equal(ACCOUNT_SUMMARY_TIME_LIMIT_MS, 20_000);
    assert.equal(ACCOUNT_SUMMARY_TIME_LIMIT_MS, USER_CONTEXT_TIME_LIMIT_MS);
    assert.equal(ACCOUNT_SUMMARY_MAX_AGE_MS, 50 * 60 * 1000, "the photo link's hour, less ten minutes");
  });

  test("what it fetches is unchanged: the profile's name and a signed link to a stored photo, a provider's photo as it is", async () => {
    const stored = shellClient();
    assert.deepEqual(await fetchAccountSummary(stored.client), { name: "Asha Rao", email: USER.email, avatarUrl: SIGNED });
    assert.deepEqual(stored.requests, ["auth.getUser", "profiles", `sign fitx-user-media ${PHOTO} 3600`]);

    const google = shellClient({ profile: { name: "Asha Rao", avatar: "https://lh3.googleusercontent.test/a/photo" } });
    assert.deepEqual(await fetchAccountSummary(google.client), { name: "Asha Rao", email: USER.email, avatarUrl: "https://lh3.googleusercontent.test/a/photo" });
    assert.deepEqual(google.requests, ["auth.getUser", "profiles"], "no link to sign");

    const unnamed = shellClient({ profile: null });
    assert.deepEqual(await fetchAccountSummary(unnamed.client), { name: "asha", email: USER.email, avatarUrl: null }, "the email's name when the profile has none");
  });

  test("a session check that never answers: shared for 20 s, then dropped, so the next read asks again; nothing is cancelled", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const { client, requests } = shellClient({ check: never() });
    const request = sharedSummaryRequest(() => fetchAccountSummary(client));
    const header = shown();
    const reader = summaryReader(request, header.show);
    reader.read();
    await turn();
    assert.deepEqual(requests, ["auth.getUser"]);

    // A sidebar mounted at 19.999 s shares the request.
    t.mock.timers.tick(ACCOUNT_SUMMARY_TIME_LIMIT_MS - 1);
    await turn();
    const sidebar = shown();
    summaryReader(request, sidebar.show).read();
    await turn();
    assert.deepEqual(requests, ["auth.getUser"], "still one request");

    // At 20 s it is dropped: a header mounted now asks again, where before it got the same hung request for 50 minutes.
    t.mock.timers.tick(1);
    await turn();
    const later = shown();
    summaryReader(request, later.show).read();
    await turn();
    assert.deepEqual(requests, ["auth.getUser", "auth.getUser"]);

    // No reader was shown anything: what they show stays ("Your account" until the shared context answers).
    assert.deepEqual(header.values, []);
    assert.deepEqual(sidebar.values, []);
    assert.equal(preferSharedAccount(null, { status: "loading", data: null, avatarUrl: null }), null);
  });

  test("a late answer still reaches the readers that waited for it", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const check = gate();
    const { client, requests } = shellClient({ check: check.passed });
    const request = sharedSummaryRequest(() => fetchAccountSummary(client));
    const header = shown();
    const sidebar = shown();
    summaryReader(request, header.show).read();
    summaryReader(request, sidebar.show).read();
    await turn();
    t.mock.timers.tick(ACCOUNT_SUMMARY_TIME_LIMIT_MS + 5_000);
    await turn();
    assert.deepEqual(header.values, []);
    check.open();
    await turn();
    const asha = { name: "Asha Rao", email: USER.email, avatarUrl: SIGNED };
    assert.deepEqual(header.values, [asha], "at 25 s, as before the limit");
    assert.deepEqual(sidebar.values, [asha]);
    assert.deepEqual(requests, ["auth.getUser", "profiles", `sign fitx-user-media ${PHOTO} 3600`], "one request for both");
  });

  test("an older request that answers late never replaces a newer read's answer", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const first = gate();
    const answers = [first.passed.then(() => summaryOf("Old name")), Promise.resolve(summaryOf("New name"))];
    let made = 0;
    const request = sharedSummaryRequest(() => answers[made++]);
    const header = shown();
    const reader = summaryReader(request, header.show);
    reader.read();
    await turn();
    t.mock.timers.tick(ACCOUNT_SUMMARY_TIME_LIMIT_MS);
    await turn();
    // The next read (the 50-minute renewal, a Profile save) makes a new request, which answers at once.
    reader.read();
    await turn();
    assert.equal(made, 2);
    assert.deepEqual(header.values, [summaryOf("New name")]);
    first.open();
    await turn();
    assert.deepEqual(header.values, [summaryOf("New name")], "the late, older answer is not shown");

    // While the newer request hangs, the older one's late answer is still shown.
    const older = gate();
    const queue = [older.passed.then(() => summaryOf("Asha")), never()];
    let asked = 0;
    const slow = sharedSummaryRequest(() => queue[asked++]);
    const sidebar = shown();
    const other = summaryReader(slow, sidebar.show);
    other.read();
    await turn();
    t.mock.timers.tick(ACCOUNT_SUMMARY_TIME_LIMIT_MS);
    await turn();
    other.read();
    await turn();
    older.open();
    await turn();
    assert.equal(asked, 2);
    assert.deepEqual(sidebar.values, [summaryOf("Asha")]);
  });

  test("answers within 20 s are kept and shared for 50 minutes, as before, and a forced read asks again", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let made = 0;
    const request = sharedSummaryRequest(async () => summaryOf(`Asha ${++made}`));
    const header = shown();
    const reader = summaryReader(request, header.show);
    reader.read();
    await turn();
    assert.deepEqual(header.values, [summaryOf("Asha 1")]);

    t.mock.timers.tick(ACCOUNT_SUMMARY_TIME_LIMIT_MS);
    await turn();
    reader.read();
    t.mock.timers.tick(ACCOUNT_SUMMARY_MAX_AGE_MS - ACCOUNT_SUMMARY_TIME_LIMIT_MS);
    reader.read();
    await turn();
    assert.equal(made, 1, "an answer is not dropped at the limit, and is shared up to 50 minutes");
    t.mock.timers.tick(1);
    reader.read();
    await turn();
    assert.equal(made, 2, "older than 50 minutes: asked again");
    reader.read(true);
    await turn();
    assert.equal(made, 3, "a Profile save asks again");
    assert.deepEqual(header.values.map((value) => value?.name), ["Asha 1", "Asha 1", "Asha 1", "Asha 2", "Asha 3"]);
  });

  test("a fetch that breaks off gives null, as before; a reader that went is shown nothing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const broken = sharedSummaryRequest(async () => {
      throw new Error("broke off");
    });
    const header = shown();
    summaryReader(broken, header.show).read();
    await turn();
    assert.deepEqual(header.values, [null]);

    const late = gate();
    const request = sharedSummaryRequest(() => late.passed.then(() => summaryOf("Asha")));
    const gone = shown();
    const reader = summaryReader(request, gone.show);
    reader.read();
    reader.stop();
    late.open();
    await turn();
    assert.deepEqual(gone.values, []);
  });
});

describe("useAccountSummary reads through the limit", () => {
  const hook = readFileSync(new URL("../../src/components/layout/useAccountSummary.ts", import.meta.url), "utf8");

  test("one shared request with the limit, read by one reader per header or sidebar", () => {
    assert.match(hook, /const summary = sharedSummaryRequest\(\(\) => \{\s*const supabase = createClient\(\);\s*return supabase \? fetchAccountSummary\(supabase\) : Promise\.resolve\(null\);\s*\}\);/);
    assert.match(hook, /const reader = summaryReader\(summary, setValue\);\s*reader\.read\(\);/);
    assert.match(hook, /const refresh = \(\) => reader\.read\(true\);/);
    assert.match(hook, /window\.setInterval\(\(\) => reader\.read\(\), ACCOUNT_SUMMARY_MAX_AGE_MS\)/);
    assert.match(hook, /return \(\) => \{\s*reader\.stop\(\);/);
    assert.doesNotMatch(hook, /requestedAt|getUser\(|createSignedUrl\(/, "no second cache or fetch of its own");
    assert.match(hook, /return useMemo\(\(\) => preferSharedAccount\(value, shared\), \[value, shared\]\);/, "the shared context still comes first");
  });
});
