// Fix round 3d (open-3c-profile-save-timeout): Profile's saves had no time limit, unlike setup's since round 3c. A save
// that never answered (a stalled connection, a captive portal, a server that hangs) left "Saving…" up until the page
// was reloaded, with nothing said. Each save now runs within Profile's limit (setup's saveWithinLimit, imported), with
// every request built from the save's signal, so the limit cancels what is still on its way. "Saving…" ends with a
// message in Profile's words beside the buttons, everything stays as typed, and focus stays on Save (D5). The reload
// after a save, and Try again, wait only so long too.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  HEADER_SAVED,
  NAME_SAVE,
  PHOTO_REMOVE,
  PROFILE_TIME_LIMIT_MS,
  SAVED_NOT_SHOWN,
  SECTION_SAVE,
  headerNotice,
  logWeighInOnce,
  noticeAfterReload,
  saveWithin,
  waitWithin,
} from "@/components/profile/profile-save";
import { markNutritionSetupAnswered, markWorkoutSetupAnswered, savePreferences, updateProfileRow } from "@/lib/domain/user-context";
import { SETUP_TIME_LIMIT_MS, withAbortSignal } from "@/lib/onboarding/time-limit";
import { saveEquipmentProfile } from "@/lib/training/data";

const read = (file: string) => readFileSync(new URL(`../../src/app/(dashboard)/profile/${file}`, import.meta.url), "utf8");
const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

type Request = { table: string; method: string; signal?: AbortSignal; values?: unknown };

/** A request being built: its filters chain, `abortSignal()` keeps the signal, and awaiting it gives the answer. */
interface Chain {
  eq(...args: unknown[]): Chain;
  not(...args: unknown[]): Chain;
  order(...args: unknown[]): Chain;
  limit(...args: unknown[]): Chain;
  select(...args: unknown[]): Chain;
  maybeSingle(): Chain;
  abortSignal(signal: AbortSignal): Chain;
  then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown): Promise<unknown>;
}

/** A stand-in for the Supabase client with the shape the shared helpers use; `answer` gives each request's answer. */
function database(answer: (request: Request, count: number) => unknown = () => ({ data: [{ id: "member" }], error: null })) {
  const requests: Request[] = [];
  const start = (request: Request): Chain => {
    requests.push(request);
    const count = requests.length;
    const chain: Chain = {
      eq: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      select: () => chain,
      maybeSingle: () => chain,
      abortSignal: (signal) => {
        request.signal = signal;
        return chain;
      },
      then: (resolve, reject) => Promise.resolve(answer(request, count)).then(resolve, reject),
    };
    return chain;
  };
  const client = {
    from: (table: string) => ({
      select: () => start({ table, method: "select" }),
      insert: (values: unknown) => start({ table, method: "insert", values }),
      update: (values: unknown) => start({ table, method: "update", values }),
      upsert: (values: unknown) => start({ table, method: "upsert", values }),
      delete: () => start({ table, method: "delete" }),
    }),
    rpc: (name: string) => start({ table: name, method: "rpc" }),
  };
  return { client, requests };
}

/** What Supabase's client answers once a request's signal is aborted (it answers, it does not throw). */
const ABORTED = { data: null, error: { message: "AbortError: signal is aborted without reason", code: "" } };
const untilAborted = (request: Request) => new Promise((resolve) => request.signal?.addEventListener("abort", () => resolve(ABORTED), { once: true }));
const asked = (requests: Request[]) => requests.map(({ method, table }) => `${method} ${table}`);

describe("a Profile save stops at its limit", () => {
  test("a save that never answers stops at 20 s, not before, says so in Profile's words and cancels its requests", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal: AbortSignal | undefined;
    let settled = false;
    const shown = saveWithin((given) => {
      signal = given;
      return never();
    }, SECTION_SAVE);
    void shown.then(() => { settled = true; });
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.save - 1);
    await turn();
    assert.equal(settled, false, "still waiting a moment before the limit");
    assert.equal(signal?.aborted, false, "its requests are left alone until then");
    t.mock.timers.tick(1);
    assert.equal(await shown, SECTION_SAVE.timedOut, "Saving… ends with the section's message");
    assert.equal(signal?.aborted, true, "the save's requests are cancelled");

    for (const words of [NAME_SAVE, PHOTO_REMOVE]) {
      const stopped = saveWithin(() => never(), words);
      t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.save);
      assert.equal(await stopped, words.timedOut, "each save says what it was doing");
    }
  });

  test("a save that answers in time gives its own outcome, and nothing is cancelled", async () => {
    let signal: AbortSignal | undefined;
    assert.equal(await saveWithin(async (given) => { signal = given; return null; }, SECTION_SAVE), null, "saved");
    assert.equal(signal?.aborted, false);
    const refused = "That goal isn't available yet. Choose another for now.";
    assert.equal(await saveWithin(async () => refused, SECTION_SAVE), refused, "the database's refusal keeps its own message");
    // A save that breaks off (a request that throws) says Profile's own failure, instead of leaving "Saving…" up.
    assert.equal(await saveWithin(async () => { throw new Error("broke off"); }, SECTION_SAVE), SECTION_SAVE.failed);
    assert.equal(await saveWithin(() => { throw new Error("broke off at once"); }, NAME_SAVE), NAME_SAVE.failed);
    assert.equal(await saveWithin(async () => { throw new Error("broke off"); }, PHOTO_REMOVE), PHOTO_REMOVE.failed);
  });

  test("the messages are plain and short, and the failures are Profile's own, unchanged", () => {
    assert.equal(PROFILE_TIME_LIMIT_MS.save, SETUP_TIME_LIMIT_MS.save, "setup's 20 seconds");
    assert.equal(PROFILE_TIME_LIMIT_MS.save, 20_000);
    assert.equal(PROFILE_TIME_LIMIT_MS.reload, 20_000);
    for (const [name, words] of Object.entries({ SECTION_SAVE, NAME_SAVE, PHOTO_REMOVE })) {
      assert.match(words.timedOut, /^(Saving|Removing) your [a-z ]+ is taking too long, so we stopped waiting\. Check your connection and try again\.$/, `${name}: what happened, and what to do`);
      assert.doesNotMatch(words.timedOut, /error|fail|timeout|timed out|request/i, `${name} is in plain words`);
      assert.ok(words.timedOut.length < 110, `${name} is short`);
    }
    assert.equal(SECTION_SAVE.failed, "Your changes couldn't be saved. Check your connection and try again.");
    assert.equal(NAME_SAVE.failed, "Your name couldn't be saved. Try again.");
    assert.equal(PHOTO_REMOVE.failed, "Your photo couldn't be removed. Try again.");
  });
});

describe("every request a section's save makes carries the save's signal", () => {
  test("the shared helpers' requests, the profile row's repair and the weigh-in's too", async () => {
    const { client, requests } = database((request, count) => {
      if (count === 1) return { data: [], error: null };
      if (request.method === "rpc") return { data: null, error: null };
      if (request.method === "select") return { data: { weight: 70 }, error: null };
      return { data: [{ id: "member" }], error: null };
    });
    const signal = new AbortController().signal;
    const db = withAbortSignal(client, signal) as never;
    assert.deepEqual(await updateProfileRow(db, "member", { height: 175 }), { error: null }, "Body: the profile, created on the way");
    assert.equal((await savePreferences(db, "member", { weight_unit: "lb" }, { v2: true, v3: true })).error, null, "units, goal, food, injuries");
    assert.deepEqual(await logWeighInOnce(db, "member", 71.2, "Profile update"), { error: null }, "Body: the weigh-in");
    assert.equal((await saveEquipmentProfile(db, "member", "home", ["dumbbells"])).error, null, "Training: a list");
    assert.equal((await markWorkoutSetupAnswered(db, "member")).error, null, "Training: the setup answered");
    assert.equal((await markNutritionSetupAnswered(db, "member")).error, null, "Food: the setup answered");
    assert.deepEqual(asked(requests), [
      "update profiles",
      "rpc fitx_ensure_profile",
      "update profiles",
      "upsert user_preferences",
      "select body_metrics",
      "insert body_metrics",
      "update profiles",
      "upsert user_equipment_profiles",
      "update user_preferences",
      "update user_preferences",
    ]);
    for (const request of requests) assert.equal(request.signal, signal, `${request.method} ${request.table}`);
  });

  test("at the limit the hung request answers at once and nothing more is sent, so none of it lands after the next try", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { client, requests } = database(untilAborted);
    let woundDown = false;
    const shown = saveWithin(async (signal) => {
      const db = withAbortSignal(client, signal) as never;
      const saved = await savePreferences(db, "member", { primary_goal: "build_muscle" }, { v2: true, v3: true });
      woundDown = true;
      if (saved.error) return SECTION_SAVE.failed;
      const marked = await markWorkoutSetupAnswered(db, "member");
      return marked.error ? SECTION_SAVE.failed : null;
    }, SECTION_SAVE);
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.save);
    assert.equal(await shown, SECTION_SAVE.timedOut, "the member reads the time limit's message, not the late one");
    await turn();
    assert.equal(woundDown, true, "the cancelled request answered straight away");
    assert.deepEqual(asked(requests), ["upsert user_preferences"], "and no other request was started");
  });
});

describe("with the real Supabase client (a stand-in fetch, no network)", () => {
  type Seen = { method: string; path: string; signal: AbortSignal | null };
  function client(hung: (method: string, path: string) => boolean = () => false) {
    const seen: Seen[] = [];
    const respond = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const method = init?.method ?? request?.method ?? "GET";
      const path = String(request?.url ?? input).replace(/^https:\/\/stand-in\.supabase\.co\/rest\/v1\//, "");
      const signal = (init?.signal ?? request?.signal ?? null) as AbortSignal | null;
      seen.push({ method, path, signal });
      if (hung(method, path)) {
        return new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      }
      return new Response(method === "GET" ? JSON.stringify({ weight: 70 }) : JSON.stringify([{ id: "member" }]), { status: 200, headers: { "content-type": "application/json" } });
    };
    return { seen, supabase: createSupabaseClient("https://stand-in.supabase.co", "anon", { global: { fetch: respond as typeof fetch }, auth: { persistSession: false, autoRefreshToken: false } }) };
  }

  test("every request of a Training, Goal, Body and name save carries the signal", async () => {
    const { seen, supabase } = client();
    const signal = new AbortController().signal;
    const db = withAbortSignal(supabase, signal);
    assert.equal((await saveEquipmentProfile(db, "member", "home", ["dumbbells"])).error, null);
    assert.equal((await savePreferences(db, "member", { primary_goal: "build_muscle" }, { v2: true, v3: true })).error, null);
    assert.equal((await markWorkoutSetupAnswered(db, "member")).error, null);
    assert.deepEqual(await updateProfileRow(db, "member", { name: "Asha" }), { error: null });
    assert.deepEqual(await logWeighInOnce(db, "member", 71.2, "Profile update"), { error: null });
    assert.deepEqual(seen.map(({ method, path }) => `${method} ${path.split("?")[0]}`), [
      "POST user_equipment_profiles",
      "POST user_preferences",
      "PATCH user_preferences",
      "PATCH profiles",
      "GET body_metrics",
      "POST body_metrics",
      "PATCH profiles",
    ]);
    for (const request of seen) assert.equal(request.signal, signal, `${request.method} ${request.path}`);
  });

  test("a hung save is cancelled at its limit: Profile's message, and the request ends", async () => {
    const { seen, supabase } = client((method, path) => method === "POST" && path.startsWith("user_preferences"));
    let late: unknown = "not yet";
    const outcome = await saveWithin(async (signal) => {
      const saved = await savePreferences(withAbortSignal(supabase, signal), "member", { primary_goal: "lose_weight" }, { v2: true, v3: true });
      late = saved.error;
      return saved.error ? SECTION_SAVE.failed : null;
    }, SECTION_SAVE, 50);
    assert.equal(outcome, SECTION_SAVE.timedOut);
    await turn();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].signal?.aborted, true, "the request was cancelled");
    assert.match(String((late as { hint?: string } | null)?.hint), /aborted/i, "it answered as aborted, not as a throw, and nothing more was sent");
  });
});

describe("a weigh-in is never logged twice", () => {
  test("after a save that ran out of time, the newest weigh-in already has the weight: profiles.weight only", async () => {
    const { client, requests } = database((request) => (request.method === "select" ? { data: { weight: "71.20" }, error: null } : { data: null, error: null }));
    assert.deepEqual(await logWeighInOnce(client as never, "member", 71.204, "Profile update"), { error: null }, "the same weight at the stored 0.01 kg");
    assert.deepEqual(asked(requests), ["select body_metrics", "update profiles"]);
    assert.deepEqual(requests[1].values && Object.keys(requests[1].values as object).sort(), ["updated_at", "weight"]);
  });

  test("a new weight, or the first one, is logged for today", async () => {
    for (const newest of [{ weight: 70 }, null]) {
      const { client, requests } = database((request) => (request.method === "select" ? { data: newest, error: null } : { data: null, error: null }));
      assert.deepEqual(await logWeighInOnce(client as never, "member", 71.2, "Profile update"), { error: null });
      assert.deepEqual(asked(requests), ["select body_metrics", "insert body_metrics", "update profiles"], JSON.stringify(newest));
      const inserted = requests[1].values as { weight: number; note: string; user_id: string };
      assert.equal(inserted.weight, 71.2);
      assert.equal(inserted.note, "Profile update");
    }
  });

  test("a check that fails stops the save (its message says to try again), and logs nothing", async () => {
    const { client, requests } = database((request) => (request.method === "select" ? { data: null, error: { code: "08006" } } : { data: null, error: null }));
    assert.deepEqual(await logWeighInOnce(client as never, "member", 71.2, "Profile update"), { error: { code: "08006" } });
    assert.deepEqual(asked(requests), ["select body_metrics"]);
    const failedInsert = database((request) => (request.method === "insert" ? { data: null, error: { code: "42501" } } : { data: null, error: null }));
    assert.deepEqual(await logWeighInOnce(failedInsert.client as never, "member", 71.2, "Profile update"), { error: { code: "42501" } });
  });
});

describe("the reload after a save waits only so long", () => {
  test("in time it counts; past 20 s, or broken off, it doesn't, and nothing is cancelled", async (t) => {
    assert.equal(await waitWithin(async () => undefined), true);
    assert.equal(await waitWithin(async () => { throw new Error("broke off"); }), false);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let settled = false;
    let late = false;
    let land: () => void = () => undefined;
    const waited = waitWithin(() => new Promise<void>((resolve) => { land = () => { late = true; resolve(); }; }));
    void waited.then(() => { settled = true; });
    t.mock.timers.tick(PROFILE_TIME_LIMIT_MS.reload - 1);
    await turn();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.equal(await waited, false);
    land();
    assert.equal(late, true, "the reload itself carries on, and shows the change when it lands");
  });

  test("a section's notice once reloaded; otherwise that it is saved and how to see it", () => {
    const notice = { tone: "saved" as const, text: "Saved · targets updated" };
    assert.equal(noticeAfterReload(notice, true), notice);
    assert.deepEqual(noticeAfterReload(notice, false), { tone: "note", text: "Saved. Reload the page to see the change." });
    assert.equal(noticeAfterReload({ tone: "note", text: "Saved. Add your date of birth and height for daily targets." }, false), SAVED_NOT_SHOWN);
    assert.equal(headerNotice("name", true), "Name saved");
    assert.equal(headerNotice("name", false), "Name saved. Reload the page to see it.");
    assert.equal(headerNotice("photo", true), "Photo updated");
    assert.equal(headerNotice("photo", false), "Photo updated. Reload the page to see it.");
    assert.equal(headerNotice("removed", false), "Photo removed. Reload the page to see the change.");
    for (const { notShown } of Object.values(HEADER_SAVED)) assert.match(notShown, /\. Reload the page to see (it|the change)\.$/);
  });
});

describe("Profile's saves are wired to it", () => {
  const sections = read("ProfileSections.tsx");
  const view = read("ProfileView.tsx");
  const saves = [...sections.matchAll(/async function save\(event: FormEvent\) \{([\s\S]*?)\n {2}\}\n/g)].map((found) => found[1]);

  test("each of the five sections saves within the limit, every request built from the save's signal", () => {
    assert.equal(saves.length, 5, "Body, Goal, Training, Food and Injuries");
    for (const save of saves) {
      const limited = save.slice(save.indexOf("const problem = await saveWithin(async (signal) => {"));
      assert.ok(save.includes("const problem = await saveWithin(async (signal) => {"), "within the limit");
      assert.match(limited, /^const problem = await saveWithin\(async \(signal\) => \{\s*(?:const db = withAbortSignal\(supabase, signal\);|const saved = await savePreferences\(withAbortSignal\(supabase, signal\), )/, "built from the signal");
      assert.match(limited, /\}, SECTION_SAVE\);\s*if \(problem\) return failed\(setSaving, setError, problem\);/, "the message beside the buttons");
      const inside = limited.slice(0, limited.indexOf("}, SECTION_SAVE);"));
      assert.doesNotMatch(inside.replace(/withAbortSignal\(supabase, signal\)/g, ""), /\bsupabase\b|createClient\(/, "nothing is sent without the signal");
      assert.doesNotMatch(inside, /setSaving|setError\(|onSaved|onClose/, "the save only answers; the section shows it once");
      assert.doesNotMatch(save, /setDraft\(original\)|setErrors\(\{\}\)/, "nothing typed is put back");
      assert.ok(save.indexOf("setSaving(true);") < save.indexOf("const problem = await saveWithin"), "Saving… while it is waited for");
    }
    assert.match(sections, /if \(kept && !signal\.aborted\) setDraft/, "a late answer changes nothing under the message");
    assert.match(sections, /const logged = await logWeighInOnce\(db, data\.userId, weightKg, "Profile update"\);/);
    assert.doesNotMatch(sections, /\blogWeighIn\(/, "the weigh-in is never logged twice");
  });

  test("nothing to save closes the form without waiting for a reload", () => {
    assert.equal([...sections.matchAll(/onClose\(\);\s*return onNotice\(NO_CHANGES\);/g)].length, 5);
    assert.doesNotMatch(sections, /onSaved\(NO_CHANGES\)/);
    assert.match(view, /onNotice: \(notice\) => setNotices\(\(current\) => \(\{ \.\.\.current, \[id\]: notice \}\)\),/);
  });

  test("the reload after a save, and Try again, wait only so long; a save that worked still says so", () => {
    assert.match(view, /const reloaded = await waitWithin\(reload\);\s*setNotices\(\(current\) => \(\{ \.\.\.current, \[id\]: noticeAfterReload\(notice, reloaded\) \}\)\);/);
    assert.match(view, /<ProfileHeader data=\{data\} avatarUrl=\{avatarUrl\} onSaved=\{\(\) => waitWithin\(reload\)\} \/>/);
    assert.match(view, /try \{\s*(?:\/\/[^\n]*\n\s*)*await waitWithin\(reload\);\s*\} finally \{\s*setRetrying\(false\);/);
    assert.doesNotMatch(view, /await reload\(\);/, "nothing waits on a reload without its limit");
    for (const kind of ["name", "photo", "removed"]) assert.match(view, new RegExp(`const reloaded = await onSaved\\(\\);\\s*setNotice\\(headerNotice\\("${kind}", reloaded\\)\\);`), kind);
  });

  test("the name and Remove photo save within the limit, from the save's signal, and keep focus and the typed name", () => {
    const saveName = view.slice(view.indexOf("async function saveName"), view.indexOf("async function uploadPhoto"));
    assert.match(saveName, /const problem = await saveWithin\(async \(signal\) => \{\s*const saved = await updateProfileRow\(withAbortSignal\(supabase, signal\), data\.userId, \{ name: value \}\);\s*return saved\.error \? NAME_SAVE\.failed : null;\s*\}, NAME_SAVE\);/);
    assert.match(saveName, /if \(problem\) \{\s*setBusy\(""\);\s*return setError\(problem\);\s*\}/, "Saving… ends with the message; the editor stays open");
    assert.doesNotMatch(saveName.slice(saveName.indexOf("if (problem)"), saveName.indexOf("const reloaded")), /setName|setEditingName/, "the name stays as typed");
    const remove = view.slice(view.indexOf("async function removePhoto"), view.indexOf("return (\n    <header"));
    assert.match(remove, /const problem = await saveWithin\(async \(signal\) => \{\s*const saved = await updateProfileRow\(withAbortSignal\(supabase, signal\), data\.userId, \{ avatar: null \}\);\s*return saved\.error \? PHOTO_REMOVE\.failed : null;\s*\}, PHOTO_REMOVE\);/);
    assert.match(remove, /await waitWithin\(\(\) => supabase\.storage\.from\(MEDIA_BUCKET\)\.remove\(\[storedAvatar\]\)\);/, "the stored file's removal is waited for only so long");
    // Save stays focusable while it works (aria-disabled), so focus is still on it when the message comes.
    assert.match(view, /<button type="submit" aria-disabled=\{nameBusy \|\| undefined\}/);
    assert.match(view, /\{error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4">\{error\}<\/p>\}/);
  });
});
