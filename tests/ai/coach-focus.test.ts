// Bug 86 (coach-help-8): focus fell to the page body after deleting a conversation, after "Delete my coach data" (with
// the settings dialog still open) and after "Yes, delete everything", and "Conversation deleted." was announced only
// the first time. Focus now moves to the control that takes the removed one's place (BRIEF-3 D5), one live region
// stays in place across the coach, consent and paused views, and the same words twice are read twice.
// The same mistake elsewhere in the coach (a focused button that turns disabled or is replaced) is covered at the end.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UNAVAILABLE_STATES, announcementText, focusAfterDelete, settingsReachable, statusAfterDelete } from "@/components/coach/focus-rules";
import type { CoachState, CoachStatus } from "@/lib/ai/status";

const source = (file: string) => readFileSync(new URL(`../../src/components/coach/${file}`, import.meta.url), "utf8");

const coachStatus = (state: CoachState, consent: CoachStatus["consent"], threadCount: number): CoachStatus => ({
  state, consent, threads: Array.from({ length: threadCount }, (_, index) => ({ id: `t${index}`, title: "Rest days", updatedAt: "2026-11-26T00:00:00Z" })),
  providers: [], minor: false, ageMissing: false, sharedSummary: [], memberDataAvailable: true, quotas: [], quickPrompts: [], renewal: null, careMode: false,
});
const consented = { shareData: true, consentedAt: "2026-11-20T10:00:00Z" };

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
    assert.match(app, /setStatus\(statusAfterDelete\);\n\s+focusHeading\(\);\n\s+announce\("Your coach data was deleted\."\);/);
    assert.match(app, /const focusHeading = useCallback\(\(\) => setHeadingFocus\(\(key\) => key \+ 1\), \[\]\);/);
    assert.equal(app.match(/focusKey=\{headingFocus\}/g)?.length, 2, "the consent screen and the paused screen");
    assert.doesNotMatch(app, /focusConsent/);
    const panel = source("ConsentPanel.tsx");
    assert.match(panel, /useEffect\(\(\) => \{\n\s+if \(focusKey\) heading\.current\?\.focus\(\);\n\s+\}, \[focusKey\]\);/);
    assert.match(panel, /<h2 ref=\{heading\} tabIndex=\{-1\} id="coach-consent-title"/);
  });

  test("on the paused screen, Coach settings goes at once after the delete, with the dialog (review round)", () => {
    for (const state of ["paused", "not_configured"] as const) {
      const before = coachStatus(state, consented, 2);
      assert.equal(settingsReachable(before, 2), true, `${state}: a member with coach data can open Coach settings`);
      const after = statusAfterDelete(before);
      assert.equal(after.consent, null);
      assert.deepEqual(after.threads, []);
      assert.equal(after.state, state);
      assert.equal(settingsReachable(after, 0), false, `${state}: nothing is left for Coach settings`);
    }
    // Conversations alone keep it, and FITX that can't keep conversations never offers it.
    assert.equal(settingsReachable(coachStatus("paused", null, 1), 1), true);
    assert.equal(settingsReachable(coachStatus("not_available", consented, 1), 1), false);
    // On the coach itself the status waits for the fresh one (the consent screen needs its details).
    const ready = coachStatus("ready", consented, 2);
    assert.equal(statusAfterDelete(ready), ready);
    assert.deepEqual([...UNAVAILABLE_STATES].sort(), ["not_available", "not_configured", "paused"]);
    const app = source("CoachApp.tsx");
    assert.match(app, /const hasCoachData = settingsReachable\(status, threads\.length\);/);
    assert.match(app, /\{hasCoachData && settings\}/, "the dialog goes in the same update as the button");
  });

  test("the paused screen takes focus on its heading when asked, and not on load (review round)", () => {
    const screen = source("CoachUnavailable.tsx");
    assert.match(screen, /^"use client";/);
    assert.match(screen, /useEffect\(\(\) => \{\n\s+if \(focusKey\) heading\.current\?\.focus\(\);\n\s+\}, \[focusKey\]\);/);
    assert.match(screen, /focusKey = 0 \}/);
    assert.match(screen, /<h2 ref=\{heading\} tabIndex=\{-1\} id="coach-unavailable-title"/);
    assert.doesNotMatch(screen, /focus:outline-none|outline-none/, "the focus ring stays");
    const app = source("CoachApp.tsx");
    assert.match(app, /onSettings=\{hasCoachData \? \(\) => setSettingsOpen\(true\) : undefined\}\n\s+focusKey=\{headingFocus\}/);
  });

  test("a reply that finds the coach paused or the consent gone moves focus to the screen that replaces the coach", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /if \(failure\.code === "consent_required"\) \{\n\s+focusHeading\(\);/);
    assert.match(app, /failure\.code === "not_available"\) \{\n\s+\/\/ [^\n]*\n\s+focusHeading\(\);\n\s+setStatus\(\(old\) => \(\{ \.\.\.old, state: failure\.code as CoachState \}\)\);/);
  });

  test("after the delete, the paused screen no longer says the conversations are safe", () => {
    const screen = source("CoachUnavailable.tsx");
    assert.match(screen, /text: "The FITX team has paused the AI coach for now\.", kept: "Your conversations are safe and will be here when it's back\."/);
    assert.match(screen, /\{onSettings && kept \? `\$\{text\} \$\{kept\}` : text\}/);
  });

  test("Start coaching hands focus to the message box, and keeps it while saving", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /onDone=\{\(share\) => \{\n\s+setShareData\(share\);\n\s+\/\/ [^\n]*\n\s+setFocusKey\(\(key\) => key \+ 1\);/);
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
    assert.match(voice, /const press = \(fromKeyboard = false\) => \{\n\s+if \(disabled\) return;/);
  });

  test("the voice explainer and the voice problem note give focus back to the microphone when they go (review round)", () => {
    const voice = source("CoachVoice.tsx");
    assert.match(voice, /<button\n\s+ref=\{mic\}\n\s+type="button"/);
    assert.match(voice, /const closeExplain = \(\) => \{\n\s+mic\.current\?\.focus\(\);\n\s+setExplain\(false\);/);
    assert.match(voice, /const clearProblem = \(\) => \{\n\s+mic\.current\?\.focus\(\);\n\s+setProblem\(null\);/);
    assert.match(voice, /write\(VOICE_OK_KEY, "yes"\);\n\s+closeExplain\(\);/, "Turn on voice");
    assert.match(voice, /onClick=\{closeExplain\}>Not now<\/button>/);
    assert.match(voice, /onClick=\{clearProblem\} className=\{styles\.link\}>OK<\/button>/);
    assert.doesNotMatch(voice, /=> set(Explain\(false\)|Problem\(null\))/, "no button in them removes itself without moving focus");
    // Escape closes the explainer like "Not now" (inside the AI Coach panel it closes only the explainer, not the panel).
    assert.match(voice, /if \(event\.key !== "Escape"\) return;\n\s+event\.preventDefault\(\);\n\s+closeExplain\(\);/);
  });

  test("opened from the keyboard, the voice explainer takes focus on its title, so it is announced and Space can't press a button", () => {
    const voice = source("CoachVoice.tsx");
    assert.match(voice, /event\.preventDefault\(\);\n\s+press\(true\);/, "the microphone's keys say so");
    assert.match(voice, /onPointerDown=[\s\S]*?\n\s+press\(\);\n/, "a pointer press leaves focus where the browser puts it");
    assert.match(voice, /flushSync\(\(\) => setExplain\(true\)\);\n\s+explainTitle\.current\?\.focus\(\);/);
    assert.match(voice, /<h3 ref=\{explainTitle\} tabIndex=\{-1\} id="coach-voice-title"/);
    assert.match(voice, /aria-labelledby="coach-voice-title"\n\s+aria-describedby="coach-voice-text"/);
    assert.match(voice, /<p id="coach-voice-text" className=\{styles\.explainText\}>\{VOICE_PRIVACY\}<\/p>/);
  });

  test("Dismiss on the coach's error alert moves focus to the message box (review round)", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /onClick=\{\(\) => \{ setProblem\(null\); setFocusKey\(\(key\) => key \+ 1\); \}\} aria-label="Dismiss"/);
    assert.doesNotMatch(app, /onClick=\{\(\) => setProblem\(null\)\}/);
    // The box holds the words of a failed send again, and a failed open or delete (text "") leaves what was typed.
    assert.match(app, /handleFailure\(error, ""\);/);
    assert.match(app, /\n\s+if \(text\) setDraft\(text\);\n\s+const when = formatResetTime\(failure\.retryAt\);/);
  });

  test("the paused page's coach settings read the same words twice too (review round)", () => {
    const paused = source("CoachPausedControls.tsx");
    assert.match(paused, /role="status" aria-live="polite">\{announcementText\(announcement\.text, announcement\.count\)\}<\/p>/);
    assert.match(paused, /announce\("Your coach data was deleted\."\);/);
    assert.doesNotMatch(paused, /setAnnouncement\("/, "every announcement goes through announce()");
  });

  test("the sharing switch stays focusable once it can't be used, and says when it can be used again (review round)", () => {
    // On the paused page (canTurnOn false) switching sharing off made the focused switch disabled.
    assert.match(source("CoachPausedControls.tsx"), /canTurnOn=\{false\}/);
    const settings = source("CoachSettings.tsx");
    assert.match(settings, /const mayShare = !minor && !ageMissing && \(canTurnOn \|\| shareData\);/);
    assert.match(settings, /disabled=\{minor \|\| ageMissing\}\n\s+aria-disabled=\{saving \|\| !mayShare \|\| undefined\}/);
    assert.doesNotMatch(settings, /disabled=\{!mayShare\}/);
    assert.match(settings, /if \(saving \|\| !mayShare\) return;/);
    assert.match(settings, /aria-describedby=\{shareTextId\}/);
    assert.match(settings, /: canTurnOn\n\s+\? "Off: the coach answers general questions only, and meal and workout plans are off\."\n\s+: "Off: [^"]*You can switch it on again when the coach is back\."/);
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
