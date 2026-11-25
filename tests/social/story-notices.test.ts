import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { carryOver, nextNotice, noticeMs } from "@/lib/social/notice";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const toastsIn = (text: string) => text.match(/toast\.(success|error|message)\(/g) ?? [];

// Bug 18 (explore-1): "Reply sent", "This member does not take messages from you." and "That story has ended." were
// sonner toasts, drawn under the story viewer's modal <dialog> (and inert, so screen readers missed them too).
test("messages inside a dialog: each one is new (so the same words are said again), kept a few seconds, carried over if cut short", () => {
  const first = nextNotice(null, "success", "Reply sent", 1_000);
  assert.deepEqual(first, { id: 1, tone: "success", text: "Reply sent", at: 1_000 });
  const again = nextNotice(first, "success", "Reply sent", 2_000);
  assert.equal(again.id, 2, "the same words twice are two messages");
  assert.equal(noticeMs({ tone: "error" }), 7000);
  assert.equal(noticeMs({ tone: "success" }), 4000);
  assert.equal(noticeMs({ tone: "info" }), 4000);
  // The viewer closes on "Story deleted" at once (the last story): the page says it again once the dialog is gone.
  assert.equal(carryOver(first, 1_000 + 300), first);
  assert.equal(carryOver(first, 1_000 + 2_499), first);
  assert.equal(carryOver(first, 1_000 + 2_500), null, "on screen long enough: not said twice");
  assert.equal(carryOver(null, 5_000), null);
});

test("the story viewer says everything inside itself; the only toasts are the carry-over after it has gone", () => {
  const viewer = source("src/components/social/stories/StoryViewer.tsx");
  assert.equal(toastsIn(viewer).length, 3, "three carry-over branches, nothing else");
  assert.match(viewer, /useEffect\(\(\) => \(\) => \{\s*const pending = carryOver\(latest\.current, Date\.now\(\)\);/);
  assert.match(viewer, /show\("info", "That story has ended\."\)/);
  assert.match(viewer, /replaceStory\(before\);\s*show\("error", toSocialError\(error\)\.message\);/, "a failed like says why");
  assert.match(viewer, /onFailed=\{\(text\) => show\("error", text\)\}/);
  assert.match(viewer, /show\("success", "Reply sent"\)/);
  assert.match(viewer, /<Reply key=\{story\.id\} storyId=\{story\.id\} ownerId=\{account\.author\.id\} ownerName=\{account\.author\.username\}/);
  assert.match(viewer, /onSent=\{\(text\) => show\("success", text\)\} \/>/, "the report's thanks, inside the viewer");
  // The live regions are inside the dialog, above the reply box.
  const dialog = viewer.slice(viewer.indexOf("<dialog ref={dialog}"), viewer.indexOf("</dialog>"));
  assert.match(dialog, /<p role="status" className=\{notice && notice\.tone !== "error" \? styles\.notice : "sr-only"\}>/);
  assert.match(dialog, /\{notice\?\.tone === "error" && <p key=\{notice\.id\} role="alert"/);
  assert.ok(dialog.indexOf('role="status"') < dialog.indexOf("className={styles.foot}"), "just above the reply box and the like button");
  // Deleting a story: a failure is said in its open sheet.
  assert.match(viewer, /deleteNotice\.show\("error", toSocialError\(error\)\.message\);/);
  assert.match(viewer, /title="Delete this story\?"[\s\S]*?notice=\{deleteNotice\.notice\}/);
});

test("the reply box hands its refusal to the viewer, names the owner, and keeps focus while sending", () => {
  const reply = source("src/components/social/messages/StoryReply.tsx");
  assert.doesNotMatch(reply, /toast\.success/);
  assert.match(reply, /const reason = messageErrorText\(failure, \{ username: ownerName \}\);\s*if \(onFailed\) onFailed\(reason\);\s*else toast\.error\(reason\);/);
  assert.match(reply, /disabled=\{!text\} aria-disabled=\{busy \|\| undefined\}/);
  assert.match(source("src/lib/social/slots.ts"), /ownerName\?: string; onSent: \(\) => void; onFailed\?: \(text: string\) => void;/);
});

test("Sheet has a message region for what was done in it (additive: drawn only for sheets that pass `notice`)", () => {
  const sheet = source("src/components/ui/Sheet.tsx");
  assert.match(sheet, /notice\?: SheetNotice \| null;/);
  assert.match(sheet, /\{notice !== undefined && \(\s*<div className=\{styles\.notices\}>/);
  assert.match(sheet, /<p role="status" className=/);
  assert.match(sheet, /\{notice\?\.tone === "error" && <p key=\{notice\.id \?\? notice\.text\} role="alert"/);
  // Between the content and the actions, never in the scrolling part.
  assert.ok(sheet.indexOf("<div className={styles.content}>") < sheet.indexOf("styles.notices") && sheet.indexOf("styles.notices") < sheet.indexOf("<footer"));
  const css = source("src/components/ui/Sheet.module.css");
  for (const rule of [".notices", ".notice", ".noticeOk", ".noticeInfo", ".noticeError", ".noticeIdle"]) assert.match(css, new RegExp(`\\${rule} \\{`), rule);
});

test("every Explore sheet that acts says its failure inside itself, and the toasts left come after it has closed", () => {
  const cases: [string, RegExp][] = [
    ["src/components/social/ReportSheet.tsx", /show\("error", toSocialError\(error\)\.message\);/],
    ["src/components/social/EditPostSheet.tsx", /onFailed\(toSocialError\(error\)\.message\);/],
    ["src/components/social/PostCard.tsx", /confirmNotice\.show\("error", toSocialError\(error\)\.message\);/],
    ["src/components/social/ProfileView.tsx", /if \(where === "menu"\) menuNotice\.show\("error", text\);\s*else if \(where === "confirm"\) confirmNotice\.show\("error", text\);/],
    ["src/components/social/SettingsView.tsx", /confirmNotice\.show\("error", toSocialError\(error\)\.message\);/],
    ["src/components/social/messages/MessagesView.tsx", /show\("error", messageErrorText\(failure\)\);/],
    ["src/components/social/community/CommunityView.tsx", /removeNotice\.show\("error", toSocialError\(failure\)\.message\);/],
  ];
  for (const [file, failure] of cases) {
    const text = source(file);
    assert.match(text, failure, `${file}: the failure is said in the sheet`);
    assert.match(text, /notice=\{/, `${file}: the sheet has the region`);
  }
  // Confirmations: the sheet closes first, then the toast (on the page, not under the sheet).
  assert.match(source("src/components/social/ReportSheet.tsx"), /close\(\);\s*if \(onSent\) onSent\(REPORT_SENT\);\s*else toast\.success\(REPORT_SENT\);/);
  assert.match(source("src/components/social/EditPostSheet.tsx"), /onClose\(\);\s*toast\.success\("Post updated"\);/);
  assert.match(source("src/components/social/messages/MessagesView.tsx"), /close\(\);\s*toast\.success\("Message settings saved"\);/);
  // Send to… lives inside the Share sheet: it says "Sent to @x" and refusals there, never as a toast.
  const sendTo = source("src/components/social/messages/SendTo.tsx");
  assert.equal(toastsIn(sendTo).length, 0);
  assert.match(sendTo, /show\("success", `Sent to @\$\{username\}`\);/);
  // Follow buttons in the followers list report into that sheet.
  assert.match(source("src/components/social/FollowButton.tsx"), /if \(onNotice\) onNotice\(tone, text\);/);
  assert.match(source("src/components/social/ProfileView.tsx"), /<FollowButton [^>]*compact onNotice=\{onNotice\} \/>/);
});
