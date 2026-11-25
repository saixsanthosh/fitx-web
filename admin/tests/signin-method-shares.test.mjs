// The Dashboard's "Sign-in methods" panel (BUGS.md 65, admin-9): an account can have several methods (email and
// Google), so each method is a share of accounts, labelled so, never a share of the methods' sum (20 accounts, all
// with email and 2 with Google, read "Email 91% · Google 9%" before).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const charts = await importTypeScriptModule("src/components/console/chart-math.ts");

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
