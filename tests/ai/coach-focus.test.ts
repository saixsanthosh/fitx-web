// Bug 86 (coach-help-8): focus fell to the page body after deleting a conversation, after "Delete my coach data" (with
// the settings dialog still open) and after "Yes, delete everything", and "Conversation deleted." was announced only
// the first time. Focus now moves to the control that takes the removed one's place (BRIEF-3 D5), one live region
// stays in place across the coach, consent and paused views, and the same words twice are read twice.
// The same mistake elsewhere in the coach (a focused button that turns disabled or is replaced) is covered at the end.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { announcementText, focusAfterDelete } from "@/components/coach/focus-rules";

const source = (file: string) => readFileSync(new URL(`../../src/components/coach/${file}`, import.meta.url), "utf8");

describe("where focus goes after a conversation is deleted", () => {
  test("to the conversation that takes its place, else the one before it, else New conversation", () => {
    assert.deepEqual(focusAfterDelete(["a", "b", "c"], "a"), { kind: "thread", id: "b" });
    assert.deepEqual(focusAfterDelete(["a", "b", "c"], "b"), { kind: "thread", id: "c" });
    assert.deepEqual(focusAfterDelete(["a", "b", "c"], "c"), { kind: "thread", id: "b" }, "the last one: the one before it");
    assert.deepEqual(focusAfterDelete(["a"], "a"), { kind: "new" }, "the list is empty now");
    assert.deepEqual(focusAfterDelete(["a", "b"], "gone"), { kind: "new" });
  });

  test("the page deletes, commits, then focuses the replacement in the same list (rail or history drawer)", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /const target = focusAfterDelete\(threads\.map\(\(item\) => item\.id\), thread\.id\);\n\s+\/\/ [^\n]*\n\s+flushSync\(\(\) => \{/);
    assert.match(app, /list\?\.querySelector<HTMLElement>\(`\[data-coach-thread="\$\{target\.id\}"\]`\) : list\?\.querySelector<HTMLElement>\("\[data-coach-new\]"\)/);
    assert.match(app, /next\?\.focus\(\);\n\s+announce\(`Deleted “\$\{thread\.title\}”\.`\);/);
    const list = source("ConversationList.tsx");
    assert.match(list, /data-coach-new=""/);
    assert.match(list, /data-coach-thread=\{thread\.id\}/);
    assert.match(list, /onClick=\{\(event\) => onDelete\(thread, event\.currentTarget\.closest\("nav"\)\)\}/);
  });
});

describe("announcements", () => {
  test("the same words twice still change the live region's text, so they are read again", () => {
    assert.equal(announcementText("Deleted “Rest days”.", 1), "Deleted “Rest days”. ");
    assert.equal(announcementText("Deleted “Rest days”.", 2), "Deleted “Rest days”.");
    assert.notEqual(announcementText("Same", 3), announcementText("Same", 4));
    assert.equal(announcementText("", 1), "", "nothing to say stays empty");
  });

  test("one live region, at the same place in the coach, consent and paused views", () => {
    const app = source("CoachApp.tsx");
    // (The streaming reply has its own region; announcements have exactly one.)
    assert.equal(app.match(/<p className="sr-only" aria-live="polite">/g)?.length, 1);
    assert.match(app, /const live = <p className="sr-only" aria-live="polite">\{announcementText\(announcement\.text, announcement\.count\)\}<\/p>;/);
    assert.equal(app.match(/\n\s+\{live\}\n/g)?.length, 3, "after each view, as its second child");
    assert.doesNotMatch(app, /setAnnouncement\("/, "every announcement goes through announce()");
  });
});

describe("Delete my coach data", () => {
  test("the question takes focus on Cancel, Cancel returns it, and both stay focusable while deleting", () => {
    const settings = source("CoachSettings.tsx");
    assert.match(settings, /function askToDelete\(\) \{\n\s+flushSync\(\(\) => setConfirming\(true\)\);\n\s+cancelButton\.current\?\.focus\(\);/);
    assert.match(settings, /function cancelDelete\(\) \{\n\s+if \(saving\) return;\n\s+flushSync\(\(\) => setConfirming\(false\)\);\n\s+deleteButton\.current\?\.focus\(\);/);
    assert.match(settings, /<div role="group" aria-labelledby=\{askId\}/);
    assert.match(settings, /Delete all your coach data\? This can’t be undone\./);
    assert.doesNotMatch(settings, /disabled=\{saving\}|disabled=\{!mayShare \|\| saving\}/, "a disabled focused button drops focus in Chrome");
    assert.match(settings, /aria-disabled=\{saving \|\| undefined\}/);
  });

  test("after everything is deleted, the consent screen takes focus on its heading and the result is announced", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /setFocusConsent\(true\);\n\s+announce\("Your coach data was deleted\."\);/);
    assert.match(app, /focusHeading=\{focusConsent\}/);
    const panel = source("ConsentPanel.tsx");
    assert.match(panel, /useEffect\(\(\) => \{\n\s+if \(focusHeading\) heading\.current\?\.focus\(\);\n\s+\}, \[focusHeading\]\);/);
    assert.match(panel, /<h2 ref=\{heading\} tabIndex=\{-1\} id="coach-consent-title"/);
  });

  test("Start coaching hands focus to the message box, and keeps it while saving", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /setFocusConsent\(false\);\n\s+\/\/ [^\n]*\n\s+setFocusKey\(\(key\) => key \+ 1\);/);
    const panel = source("ConsentPanel.tsx");
    assert.match(panel, /disabled=\{!chosen\} aria-disabled=\{saving \|\| undefined\}/, "still disabled until a choice is made (e2e flow 06b)");
    assert.match(panel, /if \(!chosen \|\| saving\) return;/);
  });
});

describe("the same mistake elsewhere in the coach", () => {
  test("Send and the microphone stay focusable when they can't be used", () => {
    assert.match(source("Composer.tsx"), /<button type="submit" aria-disabled=\{!canSend \|\| undefined\}/);
    assert.doesNotMatch(source("Composer.tsx"), /disabled=\{!canSend\}/);
    const voice = source("CoachVoice.tsx");
    assert.match(voice, /aria-disabled=\{disabled \|\| undefined\}/);
    assert.match(voice, /const press = \(\) => \{\n\s+if \(disabled\) return;/);
  });

  test("the consent update prompt, swaps and Add to My Food Plan don't leave focus on nothing", () => {
    assert.match(source("CoachApp.tsx"), /onClosed=\{\(\) => setFocusKey\(\(key\) => key \+ 1\)\}/);
    assert.match(source("ConsentRenewal.tsx"), /onAgreed\(\);\n\s+onClosed\?\.\(\);/);
    const card = source("MealPlanCard.tsx");
    assert.match(card, /flushSync\(\(\) => setSwapOpen\(false\)\);\n\s+swapToggle\.current\?\.focus\(\);/);
    assert.match(card, /<button type="submit" aria-disabled=\{busy \|\| undefined\}/);
    const action = source("ActionButton.tsx");
    assert.match(action, /aria-disabled=\{state === "applying" \|\| undefined\}/);
    assert.match(action, /if \(!document\.activeElement \|\| document\.activeElement === document\.body\) link\.focus\(\);/);
    assert.match(action, /<Link ref=\{takeFocus\}/);
  });
});
