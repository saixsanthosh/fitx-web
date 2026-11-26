// The Dashboard's "Sign-in methods" panel (BUGS.md 65, admin-9): an account can have several methods (email and
// Google), so each method is a share of accounts, labelled so, never a share of the methods' sum (20 accounts, all
// with email and 2 with Google, read "Email 91% · Google 9%" before). Review finding admin-65-share-rounds-to-100: a
// share was rounded to the nearest whole percent, so all but one of 200 accounts read "100% of accounts", that is
// every account; now neither end is reached by rounding ("<1%", ">99%"), in Reports' meters and its daily-of-monthly
// figure too.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const charts = await importTypeScriptModule("src/components/console/chart-math.ts");
const report = await importTypeScriptModule("src/lib/content/report.ts");

const methods = [{ key: "google", label: "Google", value: 2 }, { key: "email", label: "Email", value: 20 }];

test("each method is a share of all accounts: 20 of 20 is 100%, 2 of 20 is 10%", () => {
  const parts = charts.sharesOfTotal(methods, 20);
  assert.deepEqual(parts.map((part) => [part.label, part.value, charts.percent(part.share)]), [["Email", 20, "100%"], ["Google", 2, "10%"]]);
  // The old split: shares of the 22 sign-in links.
  assert.deepEqual(charts.shares(methods).parts.map((part) => charts.percent(part.share)), ["9%", "91%"]);
});

test("unknown accounts give counts without shares, never 0%; empty and odd values are left out; a share is at most 100%", () => {
  assert.deepEqual(charts.sharesOfTotal(methods, null).map((part) => part.share), [null, null]);
  assert.deepEqual(charts.sharesOfTotal(methods, 0).map((part) => part.share), [null, null]);
  assert.deepEqual(charts.sharesOfTotal([...methods, { key: "phone", label: "Phone", value: 0 }, { key: "apple", label: "Apple", value: Number.NaN }], 20).map((part) => part.key), ["email", "google"]);
  // A member who signed up between the two counts: 21 email accounts of 20 is still at most 100%.
  assert.equal(charts.sharesOfTotal([{ key: "email", label: "Email", value: 21 }], 20)[0].share, 1);
  assert.equal(charts.percent(charts.sharesOfTotal([{ key: "phone", label: "Phone", value: 1 }], 500)[0].share), "<1%");
});

test("the panel shows the methods as shares of accounts, from the account count the Dashboard already reads", async () => {
  const page = await readFile(new URL("../src/app/(control)/overview/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<ShareList\s+label="Sign-in methods, as a share of accounts"\s+of="accounts"\s+total=\{metrics \? metrics\.accounts : null\}/);
  assert.match(page, /hint=\{metrics \? "Share of accounts · an account can have more than one" : "Accounts per method"\}/);
  assert.doesNotMatch(page, /<SplitBar label="Sign-in methods"/);
  const ui = await readFile(new URL("../src/components/console/ui.tsx", import.meta.url), "utf8");
  assert.match(ui, /\{part\.share !== null && <em> · \{percent\(part\.share\)\} of \{of\}<\/em>\}/, "each share says what it is a share of");
});

test("a share near the whole never reads as the whole: 199 of 200 accounts is >99%, 200 of 200 is 100%", () => {
  const email = (value, total) => charts.percent(charts.sharesOfTotal([{ key: "email", label: "Email", value }], total)[0].share);
  assert.equal(email(199, 200), ">99%");
  assert.equal(email(995, 1000), ">99%");
  assert.equal(email(399, 400), ">99%");
  assert.equal(email(198, 199), ">99%", "99.497% is above 99% too, and not all");
  assert.equal(email(99, 100), "99%", "exactly 99%: an ordinary share");
  assert.equal(email(200, 200), "100%");
  assert.equal(email(201, 200), "100%", "counted between the two counts: still at most all");
  // The other end, as before: some is never 0%.
  assert.equal(email(1, 200), "<1%");
  assert.equal(email(2, 200), "1%");
  assert.deepEqual([0.991, 0.99, 0.985, 0.5, 0.0049, 0, -1, Number.NaN].map(charts.percent), [">99%", "99%", "99%", "50%", "<1%", "0%", "0%", "0%"]);
  assert.deepEqual([1, 0.999, 0.12, 0.004].map(charts.percentFigure), ["100", ">99", "12", "<1"], "the figure alone, for a stat that draws its own %");
});

test("the same rule in Reports: its meters and its daily-of-monthly figure", async () => {
  const source = await readFile(new URL("../src/components/content/charts.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ percent \} from "@\/components\/console\/chart-math";/);
  assert.match(source, /\{total > 0 && ` · \$\{percent\(share\)\}\$\{of \? ` of \$\{of\}` : ""\}`\}/, "a meter's share uses percent()");
  assert.doesNotMatch(source, /Math\.round\(share \* 100\)/);
  // Daily of monthly: 199 members active today of 200 in the last 30 days is not "100%"; 1 of 300 is not "0%".
  const day = (dau, mau) => ({ day: "2026-11-26", new_accounts: 0, dau, wau: mau, mau });
  assert.equal(report.stickiness([day(199, 200)]), 0.995);
  assert.equal(charts.percentFigure(report.stickiness([day(199, 200)])), ">99");
  assert.equal(charts.percentFigure(report.stickiness([day(1, 300)])), "<1");
  assert.equal(charts.percentFigure(report.stickiness([day(50, 200)])), "25");
  assert.equal(report.stickiness([day(0, 0)]), null, "no monthly actives: unknown, never 0%");
  const page = await readFile(new URL("../src/app/(control)/reports/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<Stat label="Daily of monthly" value=\{sticky\} display=\{sticky === null \? undefined : percentFigure\(sticky\)\} unit="%"/);
});
