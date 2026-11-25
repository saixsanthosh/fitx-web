import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { menuOpenOn, type MenuOpenOn } from "../../src/components/layout/account-menu-open.ts";

// Review of bug 73: the account menu (the sidebar's new account card and the header's avatar, both kept mounted
// across pages) remembered the page it was opened on, and showed while that was the page. Nothing cleared it when the
// page changed without a press or focus reaching the page (the browser's Back or Forward, Android's Back, a swipe),
// so coming back to that page later opened the panel by itself and moved focus to Profile, which a screen reader
// announced with no action from the member.
const menu = readFileSync("src/components/layout/AccountMenu.tsx", "utf8");

/** The component's rule, render by render: what it keeps and whether the panel shows (AccountMenu.tsx). */
function visit(openOn: MenuOpenOn, pathname: string) {
  const kept = menuOpenOn(openOn, pathname);
  return { kept, open: kept !== null };
}

test("a page change closes the menu and forgets the page, so coming back to it doesn't open it again", () => {
  // The review's steps: on /dashboard open the account card; the browser's Back (no press or focus reaches the page)
  // goes to /workouts; then Home in the sidebar goes back to /dashboard.
  let openOn: MenuOpenOn = "/dashboard"; // the card's button was pressed on /dashboard
  let step = visit(openOn, "/dashboard");
  assert.equal(step.open, true, "open where it was opened");
  openOn = step.kept;
  step = visit(openOn, "/workouts");
  assert.equal(step.open, false, "Back closes it");
  assert.equal(step.kept, null, "and forgets /dashboard");
  openOn = step.kept;
  step = visit(openOn, "/dashboard");
  assert.equal(step.open, false, "Home (or Forward) back to /dashboard does not open it by itself");
  // The old rule kept the page until a press, focus outside or Escape cleared it, and showed while it was the page:
  // Back hid the panel, and coming back showed it again.
  const oldOpen = (kept: MenuOpenOn, pathname: string) => kept === pathname;
  assert.equal(oldOpen("/dashboard", "/workouts"), false);
  assert.equal(oldOpen("/dashboard", "/dashboard"), true, "the old rule opened it again");
});

test("the menu's rule: open only on the page it was opened on, closed otherwise", () => {
  assert.equal(menuOpenOn(null, "/dashboard"), null);
  assert.equal(menuOpenOn("/settings", "/settings"), "/settings");
  assert.equal(menuOpenOn("/settings", "/settings/coach"), null, "a sub-page is another page");
  assert.equal(menuOpenOn("/profile", "/dashboard"), null);
});

test("AccountMenu applies the rule while rendering and opens only from its own button", () => {
  assert.match(menu, /import \{ menuOpenOn, type MenuOpenOn \} from "\.\/account-menu-open";/);
  assert.match(menu, /const \[openOn, setOpenOn\] = useState<MenuOpenOn>\(null\);\s*const settled = menuOpenOn\(openOn, pathname\);\s*if \(settled !== openOn\) setOpenOn\(settled\);\s*const open = settled !== null;/);
  // Only setOpen(true) stores a page, and only the button's press calls it with anything but false.
  assert.match(menu, /const setOpen = \(value: boolean\) => setOpenOn\(value \? pathname : null\);/);
  const opens = [...menu.matchAll(/setOpen\(([^)]*)\)/g)].map((match) => match[1]);
  assert.deepEqual(opens.filter((argument) => argument !== "false"), ["!open"], "the button toggles; the links close");
  assert.match(menu, /onClick=\{\(\) => setOpen\(!open\)\}/);
  const stores = [...menu.matchAll(/setOpenOn\(([^)]*)\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(stores)].sort(), ["null", "settled", "value ? pathname : null"].sort(), "Escape and a press or focus outside close it");
});
