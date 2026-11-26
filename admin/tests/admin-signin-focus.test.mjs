// Admin sign-in for keyboard and screen-reader users (BUGS.md 89, admin-8): the password field is named "Password"
// (its label no longer wraps the Show password button), and after a refused sign-in focus is back in the emptied
// password field however the form was sent. The same mistake elsewhere: a submit button disabled while it works
// drops keyboard focus to the page in Chrome, so Admin's busy buttons are aria-disabled and ignore a second press.
// The scan for that reads each button as the compiler does (review finding admin-tests-scans-miss-cases, part a): a
// pattern cut at the first ">" stopped at the "=>" of an onClick arrow, so a disabled={pending} after it went unseen.
// It no longer decides what is busy from a list of flag names (review finding admin-busy-scan-misses-ispending): the
// names React and the Next docs use, isPending, isSubmitting and isLoading, slipped past six lowercase words, and so
// did a spread. Now every condition but the few known not to be busy counts, and a spread it cannot read counts too.
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

/**
 * The controls that lose keyboard focus when disabled mid-press: buttons (of any type: a useTransition button is
 * type="button"), submit inputs, and fieldsets around them (how a form switches its fields off while it works).
 */
const CONTROLS = ["button", "input", "fieldset"];
const PRESSED = new Set(["submit", "button", "image", "reset"]);

/**
 * What may disable a control: conditions settled before it is pressed (a role, a setting, a full list), which its own
 * work never turns on. Any other disabled={…} counts as busy, whatever its flag is called (pending, isPending,
 * isSubmitting, isLoading, state.sending, …). A new condition that is truly not busy is added here, with why.
 */
const NOT_BUSY = {
  "!resetEnabled": "Send reset email, while the reset email is not set up",
  "!manage": "the settings, for a role that cannot change them",
  "!maintenanceOn": "the maintenance fields, while maintenance is off (the operator's own switch)",
  "!moderator": "a community's details, for an operator who cannot moderate it",
  "rows.length >= MAX_PORTIONS": "Add portion, once the list is full (it moves focus to the new row first)",
};
/** A condition as compared: without its spaces, so a line break or `a>=b` for `a >= b` does not change it. */
const plain = (text) => text.replace(/\s+/g, "");
const KNOWN = new Map(Object.keys(NOT_BUSY).map((condition) => [plain(condition), condition]));
/** A disabled={…} that never changes: always on or always off. */
const CONSTANT = new Set(["true", "false", "undefined"]);
/** A busy flag in an aria-disabled={…}, to count the busy buttons that say so (in any case, also inside a name). */
const BUSY = /pending|busy|saving|sending|submitting|uploading|loading/i;

/**
 * Where a source disables a control by anything but a known condition (or may, through a spread it cannot read),
 * which known conditions it uses, and how many busy controls only say so (aria-disabled).
 */
function busyControls(source, name) {
  const disabled = [];
  const known = new Set();
  let marked = 0;
  for (const element of jsxElements(source, CONTROLS, name)) {
    if (element.tag === "input" && !PRESSED.has(element.attributes.type)) continue;
    const { disabled: off, "aria-disabled": marking } = element.attributes;
    const where = `${name}:${element.line}: <${element.tag}`;
    const condition = typeof off === "string" ? plain(off) : null;
    if (condition !== null && KNOWN.has(condition)) known.add(KNOWN.get(condition));
    else if (condition !== null && !CONSTANT.has(condition)) disabled.push(`${where} disabled={${off}}>`);
    for (const spread of element.spreads) disabled.push(`${where} {...${spread}}>: the scan cannot see whether it disables it`);
    if (typeof marking === "string" && BUSY.test(marking)) marked += 1;
  }
  return { disabled, known, marked };
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

test("any other condition counts as busy, whatever its flag is called, and so does a spread the scan cannot read", () => {
  const shapes = [
    // The names the Next docs give the flag (useActionState's and useTransition's isPending, isSubmitting, the Pages
    // guide's isLoading): the six lowercase words let every one of these through.
    ['<button type="submit" disabled={isPending}>Save</button>', 1, 0],
    ['<button onClick={() => startTransition(async () => { await save(); })} disabled={isPending}>Save</button>', 1, 0],
    ['<button type="submit" disabled={isSubmitting}>Save</button>', 1, 0],
    ['<button type="submit" disabled={isLoading}>Save</button>', 1, 0],
    ['<fieldset disabled={isPending}><button type="submit">Save</button></fieldset>', 1, 0],
    // Any other flag or condition, also one the words happened to catch (state.sending).
    ['<input type="image" src="/send.svg" alt="Send" disabled={inFlight} />', 1, 0],
    ['<button type="submit" disabled={pendingSave || !dirty}>Save</button>', 1, 0],
    ['<button type="submit" disabled={state.sending}>Send</button>', 1, 0],
    ['<button type="submit" disabled={disabled}>Save</button>', 1, 0],
    // A spread: an object written in place is read like the attributes around it; any other could disable it.
    ['<button type="submit" {...{ disabled: pending }}>Save</button>', 1, 0],
    ['<button type="submit" {...({ disabled: isPending })}>Save</button>', 1, 0],
    ['<button type="submit" {...buttonProps}>Save</button>', 1, 0],
    ['<fieldset {...busyProps(isPending)}><button type="submit">Save</button></fieldset>', 1, 0],
    // Never busy: always off, always on, a known condition (also spelt with other spaces), or a busy button that says so.
    ['<button type="submit" disabled>Closed</button>', 0, 0],
    ['<button type="submit" disabled={true}>Closed</button>', 0, 0],
    ['<button type="submit" {...{ "aria-label": "Close" }}>Close</button>', 0, 0],
    ['<fieldset disabled={!manage}><button type="submit">Save</button></fieldset>', 0, 0],
    ['<button type="button" onClick={add} disabled={rows.length>=MAX_PORTIONS}>Add portion</button>', 0, 0],
    ['<button type="submit" aria-disabled={isPending} onClick={(event) => { if (isPending) event.preventDefault(); }}>Save</button>', 0, 1],
  ];
  for (const [jsx, disabled, marked] of shapes) {
    const found = busyControls(`export const Shape = () => (${jsx});`, "shape.tsx");
    assert.deepEqual([found.disabled.length, found.marked], [disabled, marked], jsx);
  }
  // It names the file, the line and the condition.
  assert.deepEqual(busyControls('export const Shape = () => (\n  <button type="submit" disabled={isPending}>Save</button>\n);', "shape.tsx").disabled, ["shape.tsx:2: <button disabled={isPending}>"]);
});

test("no Admin control is disabled while it works", async () => {
  const offenders = [];
  const known = new Set();
  let busyButtons = 0;
  for (const name of await readdir(SRC, { recursive: true })) {
    if (!name.endsWith(".tsx")) continue;
    const found = busyControls(await readFile(new URL(name, SRC), "utf8"), name);
    offenders.push(...found.disabled);
    for (const condition of found.known) known.add(condition);
    busyButtons += found.marked;
  }
  assert.deepEqual(offenders, []);
  // Every known condition is still in use: one left over would let a busy flag that happens to share it through.
  assert.deepEqual([...known].sort(), Object.keys(NOT_BUSY).sort());
  // BusyButton, FormFooter, PendingButton, SubmitButton, ConfirmSubmit (2), sign-in, the announcement, notice and
  // reversible-actions forms, the uploader and the Users list's selection form.
  assert.ok(busyButtons >= 12, `${busyButtons} busy buttons use aria-disabled`);
});
