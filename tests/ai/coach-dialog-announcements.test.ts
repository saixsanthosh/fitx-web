// Review a11y-coach-live-region-outside-modal-dialogs: the coach page's only polite live region, and its error alert, sat
// outside the two modal dialogs it opens (Coach settings, the history drawer). While one is open the rest of the page is
// inert, so "Questions only: … Your next message starts a new conversation." and "Deleted “…”." were never read, and a
// failed delete in the drawer showed its alert in the conversation behind the scrim. The paused page's Coach settings
// had the same split. Now each dialog has its own region and an announcement is read in the dialog open when it is
// made (else on the page), and a failed delete's message is shown under its row, in the list the member used
// (BRIEF-3 D6). Settings' own errors show next to the control that failed.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NO_ANNOUNCEMENT, announcementText, liveRegionText, nextAnnouncement, readablePlace, settleAnnouncement,
  type AnnouncePlace, type Announcement,
} from "@/components/coach/focus-rules";

const source = (file: string) => readFileSync(new URL(`../../src/components/coach/${file}`, import.meta.url), "utf8");
const closed = { settings: false, history: false };

/** One render as the page does it: settle the announcement for the dialogs open now, then read every region. */
function render(announcement: Announcement, open: { settings: boolean; history: boolean }) {
  const state = settleAnnouncement(announcement, readablePlace(open));
  const regions = Object.fromEntries((["page", "settings", "history"] as AnnouncePlace[]).map((place) => [place, liveRegionText(state, place)]));
  return { state, ...regions } as { state: Announcement; page: string; settings: string; history: string };
}

describe("where an announcement is read (review a11y-coach-live-region-outside-modal-dialogs)", () => {
  test("the open dialog, else the page", () => {
    assert.equal(readablePlace(closed), "page");
    assert.equal(readablePlace({ settings: true, history: false }), "settings");
    assert.equal(readablePlace({ settings: false, history: true }), "history");
  });

  test("said while Coach settings stays open (the sharing switch), it is read inside the dialog, not on the inert page", () => {
    const open = { settings: true, history: false };
    const made = nextAnnouncement(NO_ANNOUNCEMENT, "Questions only: the coach no longer gets your logs or profile.");
    assert.equal(made.place, null, "placed by the render that first shows it");
    const shown = render(made, open);
    assert.equal(shown.state.place, "settings");
    assert.equal(shown.settings, announcementText("Questions only: the coach no longer gets your logs or profile.", 1));
    assert.equal(shown.page, "", "the page's region behind the dialog doesn't take it");
    // Closing the dialog drops it: the page's region doesn't change (nothing read twice) and reopening reads nothing old.
    const afterClose = render(shown.state, closed);
    assert.deepEqual([afterClose.page, afterClose.settings, afterClose.state.text], ["", "", ""]);
    assert.equal(render(afterClose.state, open).settings, "", "reopened: nothing old");
  });

  test("said in the update that closes the dialog (Delete my coach data), it is read on the page", () => {
    const shown = render(nextAnnouncement(NO_ANNOUNCEMENT, "Your coach data was deleted."), closed);
    assert.equal(shown.state.place, "page");
    assert.equal(shown.page, announcementText("Your coach data was deleted.", 1));
    assert.equal(shown.settings, "");
    // It stays on the page while a dialog opens later (that page region doesn't change behind it).
    assert.equal(render(shown.state, { settings: true, history: false }).page, shown.page);
  });

  test("deleting another conversation in the history drawer is read in the drawer; deleting the open one, on the page", () => {
    const stays = render(nextAnnouncement(NO_ANNOUNCEMENT, "Deleted “Rest days”."), { settings: false, history: true });
    assert.equal(stays.history, announcementText("Deleted “Rest days”.", 1));
    assert.equal(stays.page, "");
    // The open conversation was deleted: the drawer closed (flushSync) before the announcement.
    const closes = render(nextAnnouncement(stays.state, "Deleted “Leg day”."), closed);
    assert.equal(closes.page, announcementText("Deleted “Leg day”.", 2));
    assert.equal(closes.history, "");
  });

  test("the same words twice inside a dialog are read twice", () => {
    const open = { settings: false, history: true };
    const first = render(nextAnnouncement(NO_ANNOUNCEMENT, "Deleted “Rest days”."), open);
    const second = render(nextAnnouncement(first.state, "Deleted “Rest days”."), open);
    assert.notEqual(first.history, second.history);
    assert.equal(second.history.trim(), first.history.trim());
  });

  test("settling changes nothing once placed, so the page sets state only when it must", () => {
    const placed = render(nextAnnouncement(NO_ANNOUNCEMENT, "Saved"), closed).state;
    assert.equal(settleAnnouncement(placed, "page"), placed);
    assert.equal(settleAnnouncement(placed, "settings"), placed, "a page announcement stays put while a dialog opens");
    const inDialog = render(nextAnnouncement(NO_ANNOUNCEMENT, "Saved"), { settings: true, history: false }).state;
    assert.equal(settleAnnouncement(inDialog, "settings"), inDialog);
    assert.notEqual(settleAnnouncement(inDialog, "page"), inDialog);
  });
});

describe("the coach page wires it so", () => {
  test("Coach settings and the history drawer each have their own polite region, inside the dialog", () => {
    const settings = source("CoachSettings.tsx");
    const dialog = settings.slice(settings.indexOf("<dialog"), settings.indexOf("</dialog>"));
    assert.match(dialog, /<p className="sr-only" aria-live="polite">\{status\}<\/p>/);
    assert.match(settings, /status = "",\n\}: \{/);
    const app = source("CoachApp.tsx");
    const drawer = app.slice(app.indexOf("function HistoryDrawer"));
    const drawerDialog = drawer.slice(drawer.indexOf("<dialog"), drawer.indexOf("</dialog>"));
    assert.match(drawerDialog, /<p className="sr-only" aria-live="polite">\{status\}<\/p>/);
    assert.match(app, /status=\{liveRegionText\(announcement, "settings"\)\}/);
    assert.match(app, /<HistoryDrawer open=\{historyOpen\} onClose=\{closeHistory\} closeWhenWide=\{!inPanel\} status=\{liveRegionText\(announcement, "history"\)\}>/);
  });

  test("the page places each announcement in the render that first shows it, with the dialogs its view has open", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /const announce = useCallback\(\(text: string\) => setAnnouncement\(\(old\) => nextAnnouncement\(old, text\)\), \[\]\);/);
    assert.match(app, /const settled = settleAnnouncement\(announcement, readablePlace\(\{\n\s+settings: settingsOpen && \(coachShown \|\| \(UNAVAILABLE\.has\(status\.state\) && hasCoachData\)\),\n\s+history: historyOpen && coachShown,\n\s+\}\)\);\n\s+if \(settled !== announcement\) setAnnouncement\(settled\);/);
    assert.match(app, /const coachShown = !UNAVAILABLE\.has\(status\.state\) && status\.state !== "consent";/);
    assert.ok(app.indexOf("const settled = settleAnnouncement(") < app.indexOf("if (UNAVAILABLE.has(status.state)) {\n    return ("), "before any view returns");
  });

  test("Delete my coach data closes the dialog first, then announces on the page", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /onDeleted=\{\(\) => \{\n(\s+\/\/ [^\n]*\n)+\s+flushSync\(\(\) => setSettingsOpen\(false\)\);\n\s+newConversation\(\);/);
    const paused = source("CoachPausedControls.tsx");
    assert.match(paused, /flushSync\(\(\) => setOpen\(false\)\);\n\s+setShareData\(false\);\n\s+announce\("Your coach data was deleted\."\);/);
  });

  test("the paused page's Coach settings reads what the switch did inside the dialog", () => {
    const paused = source("CoachPausedControls.tsx");
    assert.match(paused, /const settled = settleAnnouncement\(announcement, readablePlace\(\{ settings: open, history: false \}\)\);\n\s+if \(settled !== announcement\) setAnnouncement\(settled\);/);
    assert.match(paused, /status=\{liveRegionText\(announcement, "settings"\)\}/);
    assert.match(paused, /role="status" aria-live="polite">\{liveRegionText\(announcement, "page"\)\}<\/p>/);
  });
});

describe("a failed delete is shown where the member pressed Delete", () => {
  test("under its row, in the list used (the rail, or the history drawer over the conversation)", () => {
    const list = source("ConversationList.tsx");
    assert.match(list, /\{problem\?\.id === thread\.id && <p role="alert" className="fitx-alert fitx-alert-danger mt-1">\{problem\.message\}<\/p>\}\n\s+<\/li>/);
    const app = source("CoachApp.tsx");
    assert.match(app, /\} catch \(error\) \{\n\s+handleFailure\(error, "", thread\.id\);/);
    assert.match(app, /if \(failedDelete\) setRowProblem\(\{ id: failedDelete, message: `Couldn't delete this conversation\. \$\{message\}` \}\);\n\s+else setProblem\(\{ message, retryAt: failure\.retryAt \}\);/);
    assert.match(app, /busy=\{busy\} problem=\{rowProblem\} \/>/);
    // A fresh try, another conversation, a new one, and the drawer opening or closing clear it.
    assert.match(app, /return;\n\s+setRowProblem\(null\);\n\s+try \{\n\s+await deleteThread\(thread\.id\);/);
    assert.match(app, /const showHistory = useCallback\(\(open: boolean\) => \{\n\s+setHistoryOpen\(open\);\n\s+setRowProblem\(null\);\n\s+\}, \[\]\);/);
    assert.doesNotMatch(app, /setHistoryOpen\((true|false)\)/, "the drawer opens and closes through showHistory");
  });

  test("a paused coach or a lost consent still replaces the coach, and the drawer won't open again with it", () => {
    const app = source("CoachApp.tsx");
    assert.match(app, /setStatus\(\(old\) => \(\{ \.\.\.old, state: "consent" \}\)\);\n(\s+\/\/ [^\n]*\n)?\s+showHistory\(false\);/);
    assert.match(app, /setStatus\(\(old\) => \(\{ \.\.\.old, state: failure\.code as CoachState \}\)\);\n\s+showHistory\(false\);\n\s+return;/);
  });

  test("Coach settings shows a failed change next to the switch, and a failed delete next to its buttons", () => {
    const settings = source("CoachSettings.tsx");
    const share = settings.slice(settings.indexOf('<section aria-labelledby="coach-share-title">'), settings.indexOf('<section aria-labelledby="coach-providers-title">'));
    assert.match(share, /\{error\?\.at === "share" && <p role="alert" className="fitx-alert fitx-alert-danger mt-3">\{error\.text\}<\/p>\}/);
    const remove = settings.slice(settings.indexOf('<section aria-labelledby="coach-delete-title"'));
    assert.match(remove, /\{error\?\.at === "delete" && <p role="alert" className="fitx-alert fitx-alert-danger mt-3">\{error\.text\}<\/p>\}\n\s+<\/section>/);
    assert.match(settings, /setError\(\{ text: [^\n]*, at: "share" \}\);/);
    assert.match(settings, /setError\(\{ text: [^\n]*, at: "delete" \}\);/);
    assert.equal(settings.match(/role="alert"/g)?.length, 2, "no third alert at the dialog's foot");
  });
});
