import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { focusAfterRemoval, photoMoveFocus, photoToolId } from "@/lib/social/focus";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

/** Every component under a folder (repo-relative paths). */
function components(dir: string): string[] {
  return readdirSync(path.resolve(process.cwd(), dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.relative(process.cwd(), path.join(entry.parentPath, entry.name)));
}

/** The expression of every `disabled={…}` prop in a file (aria-disabled left out), braces balanced. */
function disabledProps(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?<![-\w])disabled=\{/g)) {
    const from = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let at = from;
    while (at < text.length && depth > 0) {
      if (text[at] === "{") depth += 1;
      else if (text[at] === "}") depth -= 1;
      at += 1;
    }
    found.push(text.slice(from, at - 1));
  }
  return found;
}

/** A disabled prop that turns on while something is being done (sending, saving, loading a page or a video). */
const BUSY = /\b(busy|sending|answering|deleting|preparing|saving|posting)\b|"loading"|"busy"|"more"/;

// Review of bug 82: after the first sweep, comment Post/Save, a conversation's Send, Save profile and the story
// composer's Share story and Start again still became disabled while busy (or once their box was emptied), so a keyboard
// user who pressed one was left on the page body (D5).
test("no Explore control that can hold focus is disabled while busy: aria-disabled and an early return instead", () => {
  // The only ones left are never focused while busy: the member has just pressed Share post / Share story / Share
  // video, which keep focus (aria-disabled), and these wait beside them.
  const leftOnPurpose = new Map([
    ["src/components/social/ComposerView.tsx", 4], // the photo tools and Add photos, while the post is being shared
    ["src/components/social/stories/StoryComposer.tsx", 1], // the video picker (its Choose another), while sharing
    ["src/components/social/videos/VideoComposer.tsx", 1], // the same, for a video post
  ]);
  const files = ["src/components/social", "src/app/(dashboard)/explore", "src/app/(dashboard)/social"].flatMap(components);
  assert.ok(files.length > 50, "the sweep reads every Explore component");
  for (const file of files) {
    const busy = disabledProps(source(file)).filter((expression) => BUSY.test(expression));
    assert.equal(busy.length, leftOnPurpose.get(file) ?? 0, `${file}: ${busy.join(" | ")}`);
  }
  // Save profile's `canSave` no longer folds in `busy` (it was disabled={!canSave}).
  const form = source("src/components/social/ProfileForm.tsx");
  assert.doesNotMatch(form.match(/const canSave = [^;]*;/)?.[0] ?? "", /busy/);
  assert.match(form, /if \(!canSave \|\| busy\) return;/);
  assert.match(form, /disabled=\{!canSave\} aria-disabled=\{busy \|\| undefined\}/);
});

test("a sent comment or message hands focus back to its box: the emptied box disables the send button", () => {
  const post = source("src/components/social/PostView.tsx");
  assert.match(post, /if \(!text \|\| busy\) return;/, "a second Enter while posting does nothing (it could post twice)");
  assert.match(post, /disabled=\{!body\.trim\(\)\} aria-disabled=\{busy \|\| undefined\}>\{editing \? "Save" : "Post"\}/);
  assert.match(post, /setBody\(""\);\s*\/\/[^\n]*\n[^\n]*\n\s*focusAfter\("comment-body", \(\) => \(edited \? document\.getElementById\(optionsId\(edited\)\) : null\) \?\? heading\.current\);/,
    "the box, else (an edit on a post that no longer takes comments) the edited comment's options, else the heading");
  assert.match(post, /id="comment-body"/);
  const conversation = source("src/components/social/messages/ConversationView.tsx");
  assert.match(conversation, /aria-label="Send" disabled=\{!draft\.ok\} aria-disabled=\{sending \|\| undefined\}>/);
  assert.match(conversation, /setBody\(""\);[\s\S]{0,400}?focusAfter\("conversation-message"\);\s*\} catch/);
  assert.match(conversation, /<textarea\s+id="conversation-message"/);
  // As the community composer already did.
  assert.match(source("src/components/social/community/GroupComposer.tsx"), /area\.current\?\.focus\(\);/);
});

test("the story composer keeps focus while it shares, and moves it on when the choices and the form swap", () => {
  const story = source("src/components/social/stories/StoryComposer.tsx");
  assert.match(story, /disabled=\{!ready\} aria-disabled=\{busy \|\| undefined\} onClick=\{\(\) => void share\(\)\}/);
  assert.match(story, /aria-disabled=\{busy \|\| undefined\} onClick=\{reset\}><RotateCcw/);
  assert.match(story, /if \(!storage \|\| busy \|\| !ready\) return;/);
  assert.match(story, /function reset\(\) \{\s*if \(busy\) return;[\s\S]*?focusAfter\("story-photo"\);\s*\}/, "Start again: the first choice");
  assert.match(story, /setKind\("photo"\);\s*\/\/[^\n]*\n\s*focusAfter\("story-caption"\);/, "a photo is ready: the caption");
  assert.match(story, /onClick=\{\(\) => \{ setKind\("video"\); focusAfter\("video-choose"\); \}\}/, "Video: the picker's first choice");
  assert.match(story, /<input id="story-photo" type="file"[^>]*aria-disabled=\{preparing \|\| undefined\}/, "a refused photo leaves focus on Add a photo");
  assert.match(story, /onClick=\{\(event\) => \{ if \(preparing\) event\.preventDefault\(\); \}\}/);
  assert.match(story, /id="story-caption"/);
  // The picker's first choice carries that id (PICKER_IDS.choose, "video-choose": focus-hand-off.test.ts).
  assert.match(source("src/components/social/videos/VideoPicker.tsx"), /<input id=\{PICKER_IDS\.choose\} type="file"/);
});

test("a video's Play keeps focus while the video loads", () => {
  const player = source("src/components/social/videos/PostVideo.tsx");
  assert.match(player, /onClick=\{toggle\} aria-disabled=\{state === "loading" \|\| undefined\}>/);
  assert.match(player, /function toggle\(\) \{\s*const element = video\.current;\s*\/\/[^\n]*\n\s*if \(state === "loading"\) return;/);
});

test("in the post composer, focus follows a photo that moves and goes to the next photo when one is removed", () => {
  // Moved to the front, its "earlier" button is disabled: its "later" one takes focus (and the other way round).
  assert.equal(photoMoveFocus(0, -1, 3), "later");
  assert.equal(photoMoveFocus(1, -1, 3), "earlier", "it can still go earlier");
  assert.equal(photoMoveFocus(2, 1, 3), "earlier");
  assert.equal(photoMoveFocus(1, 1, 3), "later");
  assert.equal(photoMoveFocus(1, 1, 2), "earlier");
  assert.equal(photoMoveFocus(0, -1, 2), "later");
  assert.equal(photoMoveFocus(0, 1, 1), null, "one photo: nothing to move");
  assert.equal(photoToolId("k1", "remove"), "photo-remove-k1");
  const removes = ["k1", "k2", "k3"].map((key) => photoToolId(key, "remove"));
  assert.equal(focusAfterRemoval(removes, [photoToolId("k2", "remove")]), "photo-remove-k3");
  assert.equal(focusAfterRemoval(removes, [photoToolId("k3", "remove")]), "photo-remove-k2");
  assert.equal(focusAfterRemoval([photoToolId("k1", "remove")], [photoToolId("k1", "remove")]), null, "the last one: Add photos");
  const composer = source("src/components/social/ComposerView.tsx");
  assert.match(composer, /const tool = photoMoveFocus\(index \+ by, by, items\.length\);\s*if \(key && tool\) focusAfter\(photoToolId\(key, tool\)\);/);
  assert.match(composer, /focusAfter\(focusAfterRemoval\(order, \[photoToolId\(key, "remove"\)\]\), \(\) => input\.current\);/);
  for (const tool of ["earlier", "remove", "later"]) assert.match(composer, new RegExp(`id=\\{photoToolId\\(item\\.key, "${tool}"\\)\\}`));
});
