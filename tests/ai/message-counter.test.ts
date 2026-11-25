// Bug 88 (coach-help-6): the coach's hidden character counter was a live region that changed on every key, so screen
// readers read "1/2000, 2/2000…" while the member typed. Now the length is said only near or over the limit.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lengthNotice } from "@/components/coach/composer-rules";

const composer = readFileSync(new URL("../../src/components/coach/Composer.tsx", import.meta.url), "utf8");

describe("the message counter (bug 88)", () => {
  test("nothing is said while the message is well under the limit", () => {
    for (const length of [0, 1, 3, 500, 1800]) assert.deepEqual(lengthNotice(length), { shown: false, over: false, live: "" }, String(length));
  });

  test("near the limit the counter shows, and the live text changes once, not on every key", () => {
    const near = [1801, 1802, 1950, 2000].map((length) => lengthNotice(length));
    assert.ok(near.every((notice) => notice.shown && !notice.over));
    assert.equal(new Set(near.map((notice) => notice.live)).size, 1, "the same words across the band");
    assert.equal(near[0].live, "Close to the 2,000-character limit.");
  });

  test("over the limit it turns red and says so once", () => {
    const over = [2001, 2050].map((length) => lengthNotice(length));
    assert.ok(over.every((notice) => notice.shown && notice.over));
    assert.deepEqual(new Set(over.map((notice) => notice.live)), new Set(["Over the 2,000-character limit. Shorten your message to send it."]));
  });

  test("the counter is no live region and is in the box's description only when shown", () => {
    assert.doesNotMatch(composer, /id=\{counterId\} aria-live/);
    assert.match(composer, /aria-describedby=\{length\.shown \? `\$\{hintId\} \$\{counterId\}` : hintId\}/);
    assert.match(composer, /\{length\.shown && \(\n\s+<span id=\{counterId\}/);
    assert.match(composer, /<span className="sr-only" aria-live="polite">\{length\.live\}<\/span>/);
    assert.equal(composer.match(/aria-live=/g)?.length, 1, "one live region, for the band changes only");
  });
});
