// The cookie policy's "Kept on this device" (bug 70; review home-6). Its list opens "These stay in your browser and
// are never sent to FITX:", yet its daily-quote item said a quote the browser chose itself is passed to FITX, which
// daily-quote.ts does (p_avoid). Activity recordings (uploaded once they can be) and unsaved Form Check sets (saved
// to the account) were in that list too. Those three now have their own list that says what reaches FITX.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDailyQuote } from "@/lib/home/daily-quote";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const cookies = read("src/app/(marketing)/cookies/page.tsx");
const section = cookies.match(/<h2>Kept on this device<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? "";
const neverSent = section.match(/<p>These stay in your browser and are never sent to FITX:<\/p><ul[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
const reaches = section.match(/<p className="mt-3">These are kept in your browser too, and reach FITX only as each one says:<\/p><ul[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "";
const QUOTE_SENT = "If your browser had to choose a day’s quote itself because FITX couldn’t be reached, Home sends FITX the codes of those quotes when it asks for a quote, only so that they aren’t chosen for you again.";

describe("the cookie page agrees with itself about what is sent", () => {
  test("the never-sent list holds nothing that reaches FITX", () => {
    assert.ok(neverSent, "the list is still there, under the same lead");
    assert.doesNotMatch(neverSent, /daily quote|Activity recordings|Form Check sets|(sent|passed|uploaded) to (FITX|your account)/);
    assert.match(neverSent, /floating AI Coach button/, "the local-only items stay");
  });

  test("the daily quotes, recordings and Form Check sets say how they reach FITX", () => {
    const items = reaches.match(/<li>[\s\S]*?<\/li>/g) ?? [];
    assert.equal(items.length, 3);
    assert.ok(items[0].includes(`Which daily quotes you have been shown, as each quote’s code and date, so the day’s quote stays the same if FITX can’t be reached for a moment. ${QUOTE_SENT}`));
    assert.match(items[1], /Activity recordings not yet saved to your account, until they are uploaded to it/);
    assert.match(items[2], /Unsaved AI Form Check sets, in that tab only, until you save them to your account or log out\./);
  });

  test("the privacy page's Daily quote says the same", () => {
    const privacy = read("src/app/(marketing)/privacy/page.tsx");
    const daily = privacy.match(/<h2>Daily quote<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? "";
    assert.ok(daily.includes(QUOTE_SENT));
    assert.match(daily, /included in “Download my data”/);
  });
});

describe("what Home really sends", () => {
  test("only the codes of quotes this browser chose itself, with every request for a quote", async () => {
    const store = new Map<string, string>([["fitx-quote-history:member", JSON.stringify([
      { date: "2026-11-24", id: "consistency-001", stored: true },
      { date: "2026-11-25", id: "growth-001" },
    ])]]);
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const sent: unknown[] = [];
    const supabase = { rpc: async (_name: string, args: { p_avoid: unknown }) => {
      sent.push(args.p_avoid);
      return { data: null, error: { code: "PGRST301", message: "unavailable" } };
    } };
    for (const day of ["2026-11-26", "2026-11-26"]) await getDailyQuote(supabase as never, { userId: "member", localDate: day, storage });
    assert.deepEqual(sent[0], ["growth-001"], "the database's own pick isn't sent back");
    assert.equal((sent[1] as string[]).includes("growth-001"), true, "and again with the next request: FITX doesn't record them");
  });
});
