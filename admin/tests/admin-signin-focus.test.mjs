// Admin sign-in for keyboard and screen-reader users (BUGS.md 89, admin-8): the password field is named "Password"
// (its label no longer wraps the Show password button), and after a refused sign-in focus is back in the emptied
// password field however the form was sent. The same mistake elsewhere: a submit button disabled while it works
// drops keyboard focus to the page in Chrome, so Admin's busy buttons are aria-disabled and ignore a second press.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const SRC = new URL("../src/", import.meta.url);

test("the password's label names only the field; Show password is a button beside it", async () => {
  const form = await readFile(new URL("app/login/login-form.tsx", SRC), "utf8");
  const label = form.match(/<label htmlFor="login-password">([^]*?)<\/label>/);
  assert.ok(label, "a label for the password field by id");
  assert.equal(label[1], "Password");
  assert.match(form, /id="login-password"\s+name="password"/);
  const wrapper = form.slice(form.indexOf("<div className={styles.field}>"), form.indexOf("</div>", form.indexOf("<div className={styles.field}>")));
  assert.match(wrapper, /aria-label=\{visible \? "Hide password" : "Show password"\}/, "the reveal button keeps its own name");
  assert.doesNotMatch(form.replace(/<label htmlFor="login-password">Password<\/label>/, ""), /<label[^>]*>\s*<span>Password<\/span>/, "no label wraps the password row");
});

test("after a refusal focus goes back to the password field; the button stays focusable while it works", async () => {
  const form = await readFile(new URL("app/login/login-form.tsx", SRC), "utf8");
  assert.match(form, /useEffect\(\(\) => \{\s*if \(state\?\.error\) password\.current\?\.focus\(\);\s*\}, \[state\]\);/);
  assert.match(form, /<button className=\{styles\.submit\} type="submit" aria-disabled=\{pending\} onClick=\{\(event\) => \{ if \(pending\) event\.preventDefault\(\); \}\}>/);
  const css = await readFile(new URL("app/login/login.module.css", SRC), "utf8");
  assert.match(css, /\.field > label:first-child \{/, "the label keeps the field label's look");
  assert.match(css, /\.submit\[aria-disabled="true"\]/);
});

test("no Admin submit button is disabled while it works", async () => {
  const offenders = [];
  let busyButtons = 0;
  for (const name of await readdir(SRC, { recursive: true })) {
    if (!name.endsWith(".tsx")) continue;
    const source = await readFile(new URL(name, SRC), "utf8");
    for (const button of source.matchAll(/<button\b[^>]*>/g)) {
      if (/\sdisabled=\{[^}]*\b(pending|busy)\b[^}]*\}/.test(button[0])) offenders.push(`${name}: ${button[0].slice(0, 80)}`);
      if (/aria-disabled=\{[^}]*\b(pending|busy)\b/.test(button[0])) busyButtons += 1;
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(busyButtons >= 9, `${busyButtons} busy buttons use aria-disabled`);
});
