// Admin sign-in for keyboard and screen-reader users (BUGS.md 89, admin-8): the password field is named "Password"
// (its label no longer wraps the Show password button), and after a refused sign-in focus is back in the emptied
// password field however the form was sent. The same mistake elsewhere: a submit button disabled while it works
// drops keyboard focus to the page in Chrome, so Admin's busy buttons are aria-disabled and ignore a second press.
// The scan for that reads each button as the compiler does (review finding admin-tests-scans-miss-cases, part a): a
// pattern cut at the first ">" stopped at the "=>" of an onClick arrow, so a disabled={pending} after it went unseen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { jsxElements } from "./helpers/jsx-scan.mjs";

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

/** A busy state: a form's pending flag, an upload's busy flag, or the like. */
const BUSY = /\b(pending|busy|saving|sending|submitting|uploading)\b/;
/** The controls that lose keyboard focus when disabled mid-press: buttons, submit inputs, and fieldsets around them. */
const CONTROLS = ["button", "input", "fieldset"];

/** Where a source disables a control while it works, and how many controls only say so (aria-disabled). */
function busyControls(source, name) {
  const disabled = [];
  let marked = 0;
  for (const element of jsxElements(source, CONTROLS, name)) {
    const { disabled: off, "aria-disabled": marking, type } = element.attributes;
    if (element.tag === "input" && !["submit", "button", "image"].includes(type)) continue;
    if (typeof off === "string" && BUSY.test(off)) disabled.push(`${name}:${element.line}: <${element.tag} disabled={${off}}>`);
    if (typeof marking === "string" && BUSY.test(marking)) marked += 1;
  }
  return { disabled, marked };
}

test("the scan reads a button's attributes as the compiler does, past an arrow function's =>", () => {
  const shapes = [
    // Admin's busy buttons have this shape; a disabled after the arrow is the regression the scan must see.
    ['<button type="submit" onClick={(event) => { if (pending) event.preventDefault(); }} disabled={pending}>Save</button>', 1, 0],
    ['<button onClick={() => setOpen(true)} type="submit" disabled={busy || !file}>Upload</button>', 1, 0],
    ['<button type="submit" disabled={pending}>Save</button>', 1, 0],
    ['<fieldset disabled={saving}><button type="submit">Save</button></fieldset>', 1, 0],
    ['<input type="submit" onClick={(event) => event.preventDefault()} disabled={pending} />', 1, 0],
    ['<button type="submit" aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }}>Save</button>', 0, 1],
    ['<button type="submit" disabled={!resetEnabled}>Send reset email</button>', 0, 0],
    ['<input type="file" disabled={busy} />', 0, 0],
  ];
  for (const [jsx, disabled, marked] of shapes) {
    const found = busyControls(`export const Shape = () => (${jsx});`, "shape.tsx");
    assert.deepEqual([found.disabled.length, found.marked], [disabled, marked], jsx);
  }
  // The old pattern, for the record: it stopped at the arrow, so the first shape's disabled was never looked at.
  assert.equal(shapes[0][0].match(/<button\b[^>]*>/)[0], '<button type="submit" onClick={(event) =>');
});

test("no Admin control is disabled while it works", async () => {
  const offenders = [];
  let busyButtons = 0;
  for (const name of await readdir(SRC, { recursive: true })) {
    if (!name.endsWith(".tsx")) continue;
    const found = busyControls(await readFile(new URL(name, SRC), "utf8"), name);
    offenders.push(...found.disabled);
    busyButtons += found.marked;
  }
  assert.deepEqual(offenders, []);
  // BusyButton, FormFooter, PendingButton, SubmitButton, ConfirmSubmit (2), sign-in, the announcement, notice and
  // reversible-actions forms, the uploader and the Users list's selection form.
  assert.ok(busyButtons >= 12, `${busyButtons} busy buttons use aria-disabled`);
});
