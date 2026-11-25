// Bug 46 (coach-help-3): a refused Help message said "Please wait a little before sending another" when the wait could
// be up to an hour or a day. The database names the limit ("hour" or "day"); the routes now say which limit it is and
// when the next message can go, worked out from the person's own recent messages, or the route's own burst limit.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SUPPORT_ERROR_MESSAGES, SUPPORT_RATE, supportLimitBody, supportLimitMessage, supportTimeText, supportWait,
} from "@/components/support/support-rules";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
// 26 Nov 2026, 01:13 IST (25 Nov 19:43 UTC): the verification's fourth request.
const NOW = Date.parse("2026-11-25T19:43:03Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const plain = (text: string) => text.replace(/\s/g, " ");

describe("the limits named are the database's own", () => {
  test("3 requests an hour, 10 a day and 10 replies an hour, as the migration enforces them", () => {
    const sql = read("supabase/migrations/20261118180005_fitx_support.sql");
    assert.match(sql, new RegExp(`if last_hour >= ${SUPPORT_RATE.requestsPerHour} or last_day >= ${SUPPORT_RATE.requestsPerDay} then`));
    assert.match(sql, new RegExp(`if last_hour >= ${SUPPORT_RATE.repliesPerHour} then\\s+raise exception using errcode = 'PT429', message = 'support_rate_limited', detail = 'hour'`));
    assert.match(sql, /detail = case when last_hour >= 3 then 'hour' else 'day' end/);
  });
});

describe("when the next message can go", () => {
  test("three requests in the last hour: an hour after the oldest of them", () => {
    assert.deepEqual(supportWait("request", [ago(1), ago(0.4), ago(0.2)], NOW), { window: "hour", at: NOW - 60_000 + 3_600_000 });
    // Older requests from the same day don't change it while fewer than 10.
    assert.deepEqual(supportWait("request", [ago(300), ago(1), ago(0.4), ago(0.2)], NOW), { window: "hour", at: NOW - 60_000 + 3_600_000 });
  });

  test("ten requests in the last day: a day after the tenth newest, the later of the two limits when both hold", () => {
    const day = Array.from({ length: 10 }, (_, index) => ago(120 + index * 60));
    assert.deepEqual(supportWait("request", day, NOW, "day"), { window: "day", at: Date.parse(ago(120 + 9 * 60)) + 86_400_000 });
    const both = [ago(5), ago(4), ago(3), ...Array.from({ length: 7 }, (_, index) => ago(120 + index * 60))];
    assert.deepEqual(supportWait("request", both, NOW, "hour"), { window: "day", at: Date.parse(ago(120 + 6 * 60)) + 86_400_000 }, "the hour ends first, the day holds");
  });

  test("ten replies in the last hour: an hour after the tenth newest", () => {
    const replies = Array.from({ length: 10 }, (_, index) => ago(50 - index * 3));
    assert.deepEqual(supportWait("reply", replies, NOW), { window: "hour", at: Date.parse(ago(50)) + 3_600_000 }, "the oldest of the ten");
    assert.deepEqual(supportWait("reply", replies.slice(1), NOW), { window: "hour", at: null }, "nine is under the limit");
  });

  test("times that show no limit (unreadable, or another clock) keep the limit the database named, with no time", () => {
    assert.deepEqual(supportWait("request", [], NOW, "day"), { window: "day", at: null });
    assert.deepEqual(supportWait("request", ["not a time", ago(2)], NOW, "hour"), { window: "hour", at: null });
    assert.deepEqual(supportWait("reply", [], NOW), { window: "hour", at: null });
  });
});

describe("what the Help page says", () => {
  test("the real limit and the time, in India Standard Time as the page shows times", () => {
    const at = NOW - 60_000 + 3_600_000;
    assert.equal(plain(supportTimeText(at, NOW)), "at 2:12 am IST");
    assert.equal(plain(supportLimitMessage("request", "hour", at, NOW)), "You can send up to 3 messages an hour. Your next one can go at 2:12 am IST.");
    assert.equal(plain(supportLimitMessage("request", "day", Date.parse("2026-11-26T23:00:00Z"), NOW)), "You can send up to 10 messages a day. Your next one can go on 27 Nov at 4:30 am IST.");
    assert.equal(plain(supportLimitMessage("reply", "hour", at, NOW)), "You can send up to 10 replies an hour. Your next one can go at 2:12 am IST.");
  });

  test("the route's own burst limit says seconds; an unknown time says within an hour or a day", () => {
    assert.equal(supportLimitMessage("reply", "burst", NOW + 40_000, NOW), "You've sent several messages in the last minute. Your next one can go in 40 seconds.");
    assert.equal(supportLimitMessage("request", "burst", NOW + 1_000, NOW), "You've sent several messages in the last minute. Your next one can go in 1 second.");
    assert.equal(supportLimitMessage("request", "hour", null, NOW), "You can send up to 3 messages an hour. Your next one can go within an hour.");
    assert.equal(supportLimitMessage("request", "day", null, NOW), "You can send up to 10 messages a day. Your next one can go within a day.");
    for (const message of [supportLimitMessage("request", "hour", null, NOW), SUPPORT_ERROR_MESSAGES.rate_limited]) assert.doesNotMatch(message, /wait a little/);
  });

  test("the 429 body carries the limit, the time and the words", () => {
    const body = supportLimitBody("request", "hour", NOW + 600_000, NOW);
    assert.deepEqual({ ...body, message: plain(body.message) }, {
      error: "rate_limited", window: "hour", retryAt: new Date(NOW + 600_000).toISOString(),
      message: "You can send up to 3 messages an hour. Your next one can go at 1:23 am IST.",
    });
    assert.equal(supportLimitBody("reply", "hour", null, NOW).retryAt, null);
  });

  test("both routes answer every limit this way, and the Help page shows the route's words", () => {
    for (const [file, kind] of [["src/app/api/support/route.ts", "request"], ["src/app/api/support/reply/route.ts", "reply"]] as const) {
      const route = read(file);
      assert.match(route, new RegExp(`if \\(error\\.code === "PT429"\\) return supportLimitResponse\\(supabase, "${kind}", error\\.details\\);`), file);
      assert.match(route, new RegExp(`rateLimitedResponse\\(limit\\.retryAfterSeconds, supportLimitBody\\("${kind}", "burst", `), file);
      assert.doesNotMatch(route, /NextResponse\.json\(\{ error: "rate_limited" \}/, file);
    }
    const limit = read("src/app/api/support/limit.ts");
    assert.match(limit, /from\("support_requests"\)\.select\("created_at"\)/);
    assert.match(limit, /from\("support_messages"\)\.select\("created_at"\)\.eq\("author_kind", "user"\)/);
    for (const file of ["src/components/support/SupportForm.tsx", "src/components/support/SupportThreads.tsx"]) {
      assert.match(read(file), /result\.message \?\? SUPPORT_ERROR_MESSAGES\[result\.error \?\? "failed"\]/, file);
    }
  });
});
