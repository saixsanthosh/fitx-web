// Bounded request bodies and the in-memory burst limits (src/lib/security/*), on their own and in the routes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedString, isUuidString, readBodyBytes, readJsonObject, readJsonObjectOrNull } from "@/lib/security/body";
import { createRateLimiter, ROUTE_LIMITS } from "@/lib/security/rate-limit";

/** A request whose body arrives in chunks without a Content-Length, the way a streaming client sends it. */
function chunked(chunks: string[], headers: Record<string, string> = {}) {
  let pulled = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled < chunks.length) controller.enqueue(encoder.encode(chunks[pulled++]));
      else controller.close();
    },
  });
  return { request: new Request("https://fitnessx.vercel.app/api/x", { method: "POST", body, headers, duplex: "half" } as RequestInit), pulled: () => pulled };
}

test("a declared size over the limit is refused before reading", async () => {
  const request = new Request("https://fitnessx.vercel.app/api/x", { method: "POST", body: "x".repeat(50), headers: { "content-length": "5000" } });
  assert.deepEqual(await readBodyBytes(request, 100), { ok: false, status: 413, error: "payload_too_large" });
});

test("a body sent without a length is read only until it passes the limit", async () => {
  const stream = chunked(Array.from({ length: 1000 }, () => "y".repeat(100)));
  const result = await readBodyBytes(stream.request, 1000);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 413);
  assert.ok(stream.pulled() <= 12, `read ${stream.pulled()} chunks, not all 1000`);
  const small = await readBodyBytes(chunked(["ab", "cd"]).request, 10);
  assert.equal(small.ok && new TextDecoder().decode(small.bytes), "abcd");
});

test("JSON bodies must be objects of the right type and size", async () => {
  const post = (body: string, type = "application/json") => new Request("https://fitnessx.vercel.app/api/x", { method: "POST", body, headers: { "content-type": type } });
  assert.deepEqual(await readJsonObject(post('{"a":1}'), 100), { ok: true, value: { a: 1 } });
  for (const body of ["[1,2]", "1", "null", '"text"', "{nope", ""]) {
    assert.deepEqual(await readJsonObject(post(body), 100), { ok: false, status: 400, error: "invalid_body" }, body);
  }
  assert.deepEqual(await readJsonObject(post(""), 100, { allowEmpty: true }), { ok: true, value: {} });
  assert.deepEqual(await readJsonObject(post('{"a":1}', "text/plain"), 100, { requireJsonType: true }), { ok: false, status: 415, error: "unsupported_media_type" });
  assert.equal((await readJsonObject(post(`{"a":"${"z".repeat(200)}"}`), 100)).ok, false);
  // Invalid UTF-8 is not JSON.
  const bad = new Request("https://fitnessx.vercel.app/api/x", { method: "POST", body: new Uint8Array([0x7b, 0xff, 0x7d]), headers: { "content-type": "application/json" } });
  assert.equal((await readJsonObject(bad, 100)).ok, false);
  assert.equal(await readJsonObjectOrNull(post("[]"), 100), null);
  assert.deepEqual(await readJsonObjectOrNull(post('{"m":"hi"}'), 100), { m: "hi" });
});

test("ids and strings are checked by shape and size", () => {
  assert.equal(isUuidString("3b241101-e2bb-4255-8caf-4136c566a962"), true);
  for (const value of ["3b241101e2bb42558caf4136c566a962", "' or 1=1 --", 42, null, `${"3b241101-e2bb-4255-8caf-4136c566a962"}x`]) assert.equal(isUuidString(value), false, String(value));
  assert.equal(boundedString("abc", 3), "abc");
  assert.equal(boundedString("abcd", 3), null);
  assert.equal(boundedString(5, 3), null);
});

test("the sliding window allows `limit` per window and says when to come back", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i += 1) assert.equal(limiter.take("a", t0 + i).allowed, true);
  const refused = limiter.take("a", t0 + 10);
  assert.deepEqual(refused, { allowed: false, retryAfterSeconds: 60 });
  assert.equal(limiter.take("b", t0 + 10).allowed, true, "other keys are counted on their own");
  assert.equal(limiter.take("a", t0 + 60_000).allowed, true, "the oldest take leaves the window");
  assert.equal(limiter.take("a", t0 + 60_001).allowed, true);
  assert.equal(limiter.take("a", t0 + 60_002).allowed, true);
  assert.equal(limiter.take("a", t0 + 60_003).allowed, false, "three takes in the last minute again");
});

test("memory stays bounded however many keys arrive", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 10_000; i += 1) limiter.take(`key-${i}`, 5_000 + i);
  assert.equal(limiter.size, 100);
  assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1000 }));
});

test("the route limits are generous for people and tight for scripts", () => {
  assert.deepEqual(ROUTE_LIMITS.coachTurn, { limit: 8, windowMs: 60_000 });
  assert.deepEqual(ROUTE_LIMITS.support, { limit: 6, windowMs: 60_000 });
  assert.deepEqual(ROUTE_LIMITS.checkout, { limit: 5, windowMs: 600_000 });
  assert.deepEqual(ROUTE_LIMITS.accountDelete, { limit: 5, windowMs: 600_000 });
});

test("Help requests and replies: a body over the limit is tooLarge, broken JSON is null", async () => {
  const { readSupportJson } = await import("@/app/api/support/read-json");
  const { SUPPORT_MAX_BODY_BYTES } = await import("@/components/support/support-rules");
  const { NextRequest } = await import("next/server");
  const post = (body: BodyInit, headers: Record<string, string> = {}) => new NextRequest("https://fitnessx.vercel.app/api/support", { method: "POST", body, headers, duplex: "half" } as never);
  assert.deepEqual(await readSupportJson(post('{"subject":"Hi"}')), { tooLarge: false, value: { subject: "Hi" } });
  assert.deepEqual(await readSupportJson(post("{nope")), { tooLarge: false, value: null });
  assert.deepEqual(await readSupportJson(post("x".repeat(SUPPORT_MAX_BODY_BYTES + 1))), { tooLarge: true });
  assert.deepEqual(await readSupportJson(chunked(Array.from({ length: 50 }, () => "z".repeat(1000))).request as never), { tooLarge: true });
});
