// A result line is read out every time an answer comes, also when it is the same as the last one (review finding
// admin-formresult-repeat-not-announced; BRIEF-3 D5). The shared result line (FormResult) worked its text out from the
// last answer alone, and useActionState keeps that answer while the next one is on its way, so a second identical
// answer (a second "Saved." in Settings, "No Explore profile has that username." twice in Add moderator) changed
// nothing in the live region and a screen reader heard nothing; moving focus to a refused field that already had focus
// reads nothing either. Now the line is empty while an answer is on its way. The same mistake elsewhere: the content
// forms' save bar (FormFooter), the sign-in message, the announcement and notice forms' refusals, and the media
// uploader's own checks (which answer at once, so its message is drawn afresh for every press instead).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { answerText, resultText } = await importTypeScriptModule("src/components/form-rules.ts");
const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

const refused = { status: "error", message: "No Explore profile has that username.", fieldErrors: { username: "No Explore profile has that username." } };
const saved = { status: "saved", message: "Saved. The app picks it up within a minute." };

test("the result line is empty while an answer is on its way, so the same answer again is written in afresh", () => {
  // Settings saved twice: Saved, then nothing while the second save is sent, then Saved again.
  assert.deepEqual([resultText(saved, false), resultText(saved, true), resultText(saved, false)], [saved.message, "", saved.message]);
  // The same refusal twice (the field already has focus, so only the live region can say it).
  assert.deepEqual([resultText(refused, false), resultText(refused, true), resultText(refused, false)], [refused.message, "", refused.message]);
  assert.equal(resultText({ status: "idle" }, false), "", "nothing before the first answer");
  assert.equal(resultText({ status: "idle" }, true), "");
});

test("a result without its own message uses the form's own words, and is empty while sending too", () => {
  const fallback = { saved: "Saved.", error: "Check the fields marked in red." };
  assert.equal(resultText({ status: "saved" }, false, fallback), "Saved.");
  assert.equal(resultText({ status: "error", fieldErrors: { name: "Required" } }, false, fallback), "Check the fields marked in red.");
  assert.equal(resultText({ status: "saved" }, true, fallback), "");
  assert.equal(resultText({ status: "saved" }, false), "", "no words of its own and none given: nothing");
  assert.deepEqual([answerText("Wrong username or password.", false), answerText("Wrong username or password.", true), answerText(null, false), answerText(undefined, false)], ["Wrong username or password.", "", "", ""]);
});

test("FormResult takes the pending flag and draws its words through resultText; every form passes it", async () => {
  const kit = await source("components/form-kit.tsx");
  assert.match(kit, /export function FormResult\(\{ id, state, pending, formRef \}: \{ id: string; state: FormState; pending: boolean;/);
  assert.match(kit, /role="status" aria-live="polite"[^>]*>\s*\{resultText\(state, pending\)\}\s*<\/p>/);
  assert.doesNotMatch(kit, /state\.message \?\? ""/, "no text worked out from the last answer alone");
  for (const file of [
    "components/settings/settings-form.tsx", "components/explore/challenge-forms.tsx", "components/explore/community-form.tsx",
    "components/explore/reversible-actions-form.tsx", "components/explore/add-moderator-form.tsx", "components/support/reply-form.tsx",
  ]) {
    const form = await source(file);
    const uses = form.match(/<FormResult [^>]*\/>/g) ?? [];
    assert.ok(uses.length > 0, `${file} draws a result line`);
    for (const use of uses) assert.match(use, /\spending=\{pending\}\s/, `${file}: ${use}`);
  }
});

test("the same mistake elsewhere: the save bar, sign-in, the announcement and notice forms, the media uploader", async () => {
  const footer = await source("components/content/form-footer.tsx");
  assert.match(footer, /\{resultText\(state, pending, \{ saved: "Saved\.", error: "Check the fields marked in red\." \}\)\}/);
  const login = await source("app/login/login-form.tsx");
  assert.match(login, /<p id="login-error" className=\{styles\.error\} role="alert">\{answerText\(error, pending\)\}<\/p>/);
  // A role=alert line drawn only while there is a refusal: gone while sending, so the next refusal is a new alert.
  for (const file of ["components/announcement-form.tsx", "components/notifications/notice-form.tsx"]) {
    const form = await source(file);
    assert.match(form, /const error = answerText\(state\?\.error, pending\);/, file);
    assert.match(form, /\{error && <p role="alert" className="form-error">\{error\}<\/p>\}/, file);
    assert.doesNotMatch(form, /state\?\.error && <p/, file);
  }
  const uploader = await source("components/content/media-uploader.tsx");
  assert.match(uploader, /<p className=\{styles\.formStatus\} role="status" aria-live="polite"><span key=\{said\}>\{phase\.message\}<\/span><\/p>/);
  assert.equal((uploader.match(/setSaid\(\(count\) => count \+ 1\);/g) ?? []).length, 2, "a new message node for every choice and every press of Upload");
  assert.match(uploader, /const upload = async \(form: HTMLFormElement\) => \{\n    setSaid\(\(count\) => count \+ 1\);/);
});
