// Profile > Change photo on a slow connection (bug 21; review home-2). The check that the stored copy opens used to
// load it as a picture within a fixed 15 s, so below about 2.7 Mbit/s a valid 5 MB photo was uploaded, then judged
// broken, removed again, and "Your new photo couldn't be opened after uploading" came back on every try. The stored
// copy is now downloaded to the end however long that takes, and the check gives up only when nothing new arrives
// for STALL_LIMIT_MS (src/components/profile/photo-file.ts downloadUnlessStalled).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHOTO_MAX_BYTES, STALL_LIMIT_MS, downloadUnlessStalled, type Timers } from "@/components/profile/photo-file";

/** Timers fired by hand: `stall()` is the stall limit passing with nothing new. */
function handTimers() {
  let next = 0;
  let starts = 0;
  const armed = new Map<number, { run: () => void; ms: number }>();
  const timers: Timers = {
    set: (run, ms) => {
      starts += 1;
      armed.set(++next, { run, ms });
      return next;
    },
    clear: (handle) => void armed.delete(handle as number),
  };
  return {
    timers,
    armed: () => [...armed.values()].map((timer) => timer.ms),
    starts: () => starts,
    stall: () => {
      for (const [id, timer] of [...armed]) {
        armed.delete(id);
        timer.run();
      }
    },
  };
}

/** A download the test feeds piece by piece. */
function trickle(status = 200, type = "image/png") {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
    cancel: () => void (cancelled = true),
  });
  return {
    response: new Response(body, { status, headers: { "content-type": type } }),
    send: (bytes: number) => controller?.enqueue(new Uint8Array(bytes)),
    end: () => controller?.close(),
    cancelled: () => cancelled,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("downloading the stored copy", () => {
  test("a slow but steady download is never cut off, however long it takes", async () => {
    const clock = handTimers();
    const source = trickle();
    const download = downloadUnlessStalled(async () => source.response, { timers: clock.timers });
    // A 3 MB phone photo in 300 pieces; at 1 Mbit/s that is about 25 s, far past the old fixed 15 s.
    for (let piece = 0; piece < 300; piece += 1) {
      await settle();
      assert.deepEqual(clock.armed(), [STALL_LIMIT_MS], "only the stall timer is ever armed");
      source.send(10_000);
    }
    source.end();
    const stored = await download;
    assert.equal(stored?.size, 3_000_000);
    assert.equal(stored?.type, "image/png", "typed as the server sent it");
    assert.ok(clock.starts() > 300, "the timer starts again with every piece that arrives");
    assert.deepEqual(clock.armed(), [], "nothing is left armed");
  });

  test("a download that stops is given up after the stall limit, and cancelled", async () => {
    const clock = handTimers();
    const source = trickle();
    let signal: AbortSignal | null = null;
    const download = downloadUnlessStalled(async (given) => {
      signal = given;
      return source.response;
    }, { timers: clock.timers });
    await settle();
    source.send(50_000);
    await settle();
    clock.stall();
    assert.equal(await download, null);
    assert.equal((signal as AbortSignal | null)?.aborted, true, "the request is aborted");
    await settle();
    assert.equal(source.cancelled(), true, "the rest of the body isn't read");
  });

  test("no answer at all within the stall limit is given up too", async () => {
    const clock = handTimers();
    let signal: AbortSignal | null = null;
    const download = downloadUnlessStalled((given) => {
      signal = given;
      return new Promise<Response>(() => undefined);
    }, { timers: clock.timers });
    await settle();
    assert.deepEqual(clock.armed(), [STALL_LIMIT_MS]);
    clock.stall();
    assert.equal(await download, null);
    assert.equal((signal as AbortSignal | null)?.aborted, true);
  });

  test("a refused answer, a network error, or more bytes than a photo can have is not the stored copy", async () => {
    const clock = handTimers();
    assert.equal(await downloadUnlessStalled(async () => new Response("denied", { status: 403 }), { timers: clock.timers }), null);
    assert.equal(await downloadUnlessStalled(async () => { throw new TypeError("Failed to fetch"); }, { timers: clock.timers }), null);
    const big = trickle();
    const download = downloadUnlessStalled(async () => big.response, { timers: clock.timers, maxBytes: 1_000 });
    await settle();
    big.send(600);
    await settle();
    big.send(600);
    assert.equal(await download, null);
    assert.deepEqual(clock.armed(), [], "nothing is left armed");
  });

  test("by default the limits are the photo's: 15 s without a byte, and 5 MB", async () => {
    assert.equal(STALL_LIMIT_MS, 15_000);
    const clock = handTimers();
    const exact = trickle();
    const download = downloadUnlessStalled(async () => exact.response, { timers: clock.timers });
    await settle();
    exact.send(PHOTO_MAX_BYTES);
    exact.end();
    assert.equal((await download)?.size, PHOTO_MAX_BYTES, "exactly 5 MB is fine");
  });
});

describe("Profile uses it", () => {
  const view = readFileSync(new URL("../../src/app/(dashboard)/profile/ProfileView.tsx", import.meta.url), "utf8");

  test("the stored copy is downloaded without a fixed limit, must be the picked file's size, and must open", () => {
    assert.match(view, /const stored = await downloadUnlessStalled\(\(signal\) => fetch\(url, \{ signal, cache: "no-store" \}\)\);/);
    assert.match(view, /return stored !== null && stored\.size === file\.size && fileOpens\(stored\);/);
    assert.doesNotMatch(view, /imageOpens\(signed\.data\.signedUrl\)/, "no fixed 15 s for loading the stored copy from storage");
  });
});
