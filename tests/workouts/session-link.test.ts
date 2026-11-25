// Bug 49 (workouts-10): /workouts/active?session=not-a-uuid said "Check your connection" after a 400 from the
// database. A malformed id is now a workout that cannot be found, answered without a request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SESSION_NOT_FOUND, sessionLinkFrom } from "@/app/(dashboard)/workouts/active/_lib/session-link";

const ID = "3f2a9c1e-8b7d-4c2a-9e1f-0a1b2c3d4e5f";

test("a well-formed id is the session asked for (lower case, as the database stores it)", () => {
  assert.deepEqual(sessionLinkFrom(`?session=${ID}`), { kind: "id", id: ID });
  assert.deepEqual(sessionLinkFrom(`?session=${ID.toUpperCase()}`), { kind: "id", id: ID });
  assert.deepEqual(sessionLinkFrom("?session=00000000-0000-0000-0000-000000000000"), { kind: "id", id: "00000000-0000-0000-0000-000000000000" });
});

test("not an id, or one cut short, is a session that cannot be found", () => {
  for (const value of ["not-a-uuid", ID.slice(0, 20), `${ID}x`, "1", "%3Cscript%3E"]) assert.deepEqual(sessionLinkFrom(`?session=${value}`), { kind: "invalid" }, value);
});

test("no session in the address: the workout in progress, if any", () => {
  assert.deepEqual(sessionLinkFrom(""), { kind: "none" });
  assert.deepEqual(sessionLinkFrom("?session="), { kind: "none" });
  assert.deepEqual(sessionLinkFrom("?session=%20"), { kind: "none" });
  assert.deepEqual(sessionLinkFrom("?mode=gym"), { kind: "none" });
});

test("the page answers a malformed link before any request, with the same words as an unknown id", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/active/page.tsx", "utf8");
  const load = page.slice(page.indexOf("const load = useCallback"), page.indexOf("createClient();", page.indexOf("const load = useCallback")));
  assert.match(load, /if \(link\.kind === "invalid"\) \{ setLoading\(false\); setError\(SESSION_NOT_FOUND\); return; \}/);
  assert.match(page, /if \(!sessionRow\) \{ setLoading\(false\); setError\(SESSION_NOT_FOUND\); return; \}/);
  assert.match(SESSION_NOT_FOUND, /could not be found/);
  assert.doesNotMatch(SESSION_NOT_FOUND, /connection/);
});

test("Workouts' ?plan= link sends only a plan id to the database", () => {
  const page = readFileSync("src/app/(dashboard)/workouts/page.tsx", "utf8");
  assert.match(page, /const linkedPlanId = isUuidString\(requestedPlan\) \? requestedPlan : null;/);
});
