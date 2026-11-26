// Release 3, fix round 3c (explore's open item 3, D5): three places still took the control with focus off the page and
// left focus on the page body. "Show more" (and a conversation's "Show earlier messages") went once the last page was in;
// the video picker's steps replaced the focused control (choose → opening → trim → preparing → ready, the camera); and
// "Create profile" replaced the first-time Explore setup with Explore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { focusAfterLastPage, focusHandOff, PICKER_IDS, pickerFocusId, postAuthorId, type PickerStep } from "@/lib/social/focus";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

/** Every component under a folder (repo-relative paths). */
function components(dir: string): string[] {
  return readdirSync(path.resolve(process.cwd(), dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.relative(process.cwd(), path.join(entry.parentPath, entry.name)));
}

/** A stand-in page: a body, one focused element, and nodes that hold some elements. */
function page() {
  const body = { name: "body" };
  const doc = { activeElement: body as unknown, body };
  const node = (...holds: unknown[]) => ({ contains: (other: never) => holds.includes(other), ownerDocument: doc });
  return { body, doc, node };
}

test("a hand-off moves focus only when it left with the node, and nothing has taken it since", () => {
  const { body, doc, node } = page();
  const button = { name: "Show more" };

  // Show more had focus as it went: once the change is on the page, focus is on the body, so the caller moves it on.
  let handOff = focusHandOff();
  doc.activeElement = button;
  handOff.left(node(button));
  doc.activeElement = body;
  assert.equal(handOff.settled(doc), true);
  assert.equal(handOff.settled(doc), false, "each loss is used once");

  // Focus was elsewhere (on a post, say) when the button went: nothing moves.
  handOff = focusHandOff();
  doc.activeElement = { name: "a post's Like" };
  handOff.left(node(button));
  assert.equal(handOff.settled(doc), false);

  // Something on the new page took focus in the same commit (an autofocus field): it keeps it.
  handOff = focusHandOff();
  doc.activeElement = button;
  handOff.left(node(button));
  doc.activeElement = { name: "a field that focused itself" };
  assert.equal(handOff.settled(doc), false);

  // A group that held the focused control (a step of the video picker) counts, and so does a page with no active element.
  handOff = focusHandOff();
  const input = { name: "Choose a video" };
  doc.activeElement = input;
  handOff.left(node(input, { name: "Record with the camera" }));
  doc.activeElement = null;
  assert.equal(handOff.settled(doc), true);

  // Two nodes leave in one commit, the focused one first: the loss is not forgotten.
  handOff = focusHandOff();
  doc.activeElement = button;
  handOff.left(node(button));
  handOff.left(node());
  doc.activeElement = body;
  assert.equal(handOff.settled(doc), true);
});

test("after the last page, focus goes to the first item it added, in the order the list shows them", () => {
  assert.equal(focusAfterLastPage(["p1", "p2"], ["p1", "p2", "p3", "p4"]), "p3", "the feed: the first new post below the old ones");
  assert.equal(focusAfterLastPage(["p1", "p2"], ["p1", "p2"]), null, "the page added nothing: the caller's end of the list");
  assert.equal(focusAfterLastPage([], ["p1"]), "p1");
  // A post already shown that comes again is not new (pages are de-duplicated by id).
  assert.equal(focusAfterLastPage(["p1", "p2"], ["p1", "p2", "p2", "p3"]), "p3");
  // A conversation shows its messages oldest first, and older ones come in above: the oldest message, at the top, where
  // "Show earlier messages" was.
  assert.equal(focusAfterLastPage(["m3", "m4"], ["m1", "m2", "m3", "m4"]), "m1");
  assert.equal(postAuthorId("p1"), "post-author-p1");
});

test("each step of the video picker hands focus to its first control, or to its line of text while it only reports", () => {
  const steps: PickerStep[] = ["idle", "reading", "trim", "preparing", "camera", "ready"];
  const ids = steps.map((step) => pickerFocusId(step, { trim: false }));
  assert.deepEqual(ids, ["video-choose", "video-status", "video-prepare", "video-status", "video-record", "video-again"]);
  assert.equal(pickerFocusId("trim", { trim: true }), "video-start", "a long clip: where its seconds start comes first");
  assert.equal(pickerFocusId("ready", { trim: false, ready: "story-caption" }), "story-caption", "the page's next field");
  // Preparing never puts focus on Cancel: a second press of the key that started it would throw the work away.
  assert.notEqual(pickerFocusId("preparing", { trim: false }), "video-cancel");
  // The story composer focuses the picker's first choice by this id when Video is chosen.
  assert.equal(PICKER_IDS.choose, "video-choose");
  assert.match(source("src/components/social/stories/StoryComposer.tsx"), /focusAfter\("video-choose"\)/);
});

test("the hand-off hook notes the loss as React takes the node off, and moves focus in the same commit", () => {
  const hook = source("src/components/social/useFocusHandOff.ts");
  assert.match(hook, /const \[handOff\] = useState\(focusHandOff\);/);
  // The ref is stable (React detaches it only when the element goes), and its cleanup runs while the element is still
  // on the page (react-dom detaches a deleted node's ref before it removes the node).
  assert.match(hook, /const ref = useCallback\(\(element: HTMLElement \| null\) => \{\s*if \(!element\) return;\s*node\.current = element;\s*return \(\) => \{\s*handOff\.left\(element\);/);
  assert.match(hook, /\}, \[handOff\]\);/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{\s*latest\.current = target;\s*if \(handOff\.settled\(document\)\) latest\.current\(\)\?\.focus\(\);\s*\}\);/);
  // Show more: what the commit added is worked out first (effects run in the order they are declared).
  const showMore = hook.slice(hook.indexOf("export function useShowMoreFocus"));
  assert.ok(showMore.indexOf("added.current = focusAfterLastPage(shown.current, ids);") < showMore.indexOf("return useFocusHandOff("));
  assert.match(showMore, /return useFocusHandOff\(\(\) => \(added\.current \? item\(added\.current\) : null\) \?\? end\(\)\);/);
  const dom = source("node_modules/react-dom/cjs/react-dom-client.production.js");
  const deletion = dom.slice(dom.indexOf("function commitDeletionEffectsOnFiber("));
  const hostCase = deletion.slice(deletion.indexOf("case 5:"), deletion.indexOf("case 18:"));
  assert.ok(hostCase.indexOf("safelyDetachRef(deletedFiber") < hostCase.indexOf("removeChild(deletedFiber.stateNode)"), "a node's ref is detached before it is removed");
});

test("every Show more in Explore hands focus to the first new item, else the end of its list", () => {
  const feed = source("src/components/social/FeedView.tsx");
  assert.match(feed, /useShowMoreFocus\(feed\.items\.map\(\(post\) => post\.id\), \(id\) => document\.getElementById\(postAuthorId\(id\)\), \(\) => document\.getElementById\("feed-end"\)\);/);
  assert.match(feed, /<button type="button" ref=\{showMoreRef\}[^>]*onClick=\{feed\.more\}/);
  assert.match(feed, /<p id="feed-end" tabIndex=\{-1\}[^>]*>You are up to date\.<\/p>/);
  assert.match(source("src/components/social/PostCard.tsx"), /<Link href=\{`\/explore\/u\/\$\{author\.username\}`\} id=\{postAuthorId\(state\.id\)\} className=\{styles\.who\}>/);

  const videos = source("src/components/social/videos/VideoFeed.tsx");
  assert.match(videos, /useShowMoreFocus\(feed\.items\.map\(\(post\) => post\.id\), \(id\) => document\.getElementById\(postAuthorId\(id\)\), \(\) => document\.getElementById\("videos-end"\)\);/);
  assert.match(videos, /<button type="button" ref=\{showMoreRef\}[^>]*onClick=\{feed\.more\}/);
  assert.match(videos, /<p id="videos-end" tabIndex=\{-1\}[^>]*>That is every video for now\.<\/p>/);
  assert.match(videos, /<Link href=\{`\/explore\/u\/\$\{author\.username\}`\} id=\{postAuthorId\(post\.id\)\} className=\{exploreStyles\.who\}>/);

  // Grids: the tile of the first new post, else the last tile.
  const grid = source("src/components/social/PostGrid.tsx");
  assert.match(grid, /<ul ref=\{ref\} className=\{styles\.grid\} aria-label=\{label\}>/);
  assert.match(grid, /aria-label=\{tileLabel\(post\)\} data-post-id=\{post\.id\}>/);
  for (const [file, list] of [["src/components/social/DiscoverView.tsx", "latest"], ["src/components/social/ProfileView.tsx", "posts"], ["src/components/social/ProfileView.tsx", "saved"]]) {
    const text = source(file);
    assert.match(text, new RegExp(`useShowMoreFocus\\(${list}\\.items\\.map\\(\\(post\\) => post\\.id\\), \\(id\\) => gridTile\\(grid\\.current, id\\), \\(\\) => lastTile\\(grid\\.current\\)\\);`), `${file}: ${list}`);
    assert.match(text, new RegExp(`<button type="button" ref=\\{showMoreRef\\}[^>]*onClick=\\{${list}\\.more\\}`), `${file}: ${list}'s Show more`);
    assert.match(text, new RegExp(`<PostGrid ref=\\{grid\\} posts=\\{${list}\\.items\\}`), `${file}: ${list}'s grid`);
  }

  const messages = source("src/components/social/messages/MessagesView.tsx");
  assert.match(messages, /a\[data-conversation-id="\$\{id\}"\]/);
  assert.match(messages, /"li:last-child > a"/);
  assert.match(messages, /data-conversation-id=\{item\.id\}/);
  assert.match(messages, /<button type="button" ref=\{showMoreRef\}[^>]*onClick=\{\(\) => void loadMore\(\)\}/);
  // No Show more in Explore is left without it: every button's words ("Show more" in a ternary, or as its text) have
  // their own hand-off.
  const files = ["src/components/social", "src/app/(dashboard)/explore", "src/app/(dashboard)/social"].flatMap(components);
  assert.ok(files.length > 50, "the sweep reads every Explore component");
  let found = 0;
  for (const file of files) {
    const text = source(file);
    const shows = (text.match(/"Show more"|>Show more</g) ?? []).length;
    found += shows;
    assert.equal((text.match(/ref=\{showMoreRef\}/g) ?? []).length, shows, `${file}: each Show more hands focus on`);
  }
  assert.equal(found, 6, "the feed, Videos, Discover's latest posts, a profile's posts and saved posts, Messages");
});

test("Show earlier messages hands focus to the oldest message, and lets the view go there with it", () => {
  const conversation = source("src/components/social/messages/ConversationView.tsx");
  assert.match(conversation, /const shownOrder = \[\.\.\.messages\]\.reverse\(\)\.map\(\(message\) => message\.id\);/, "oldest first, as the thread shows them");
  assert.match(conversation, /const \[earlierRef, earlierHasFocus\] = useShowMoreFocus\(shownOrder, messageControl, \(\) => \(shownOrder\[0\] \? messageControl\(shownOrder\[0\]\) : null\)\);/);
  assert.match(conversation, /const messageControl = \(id: string\) => document\.getElementById\(optionsId\(id\)\) \?\? document\.getElementById\(unsentId\(id\)\);/);
  assert.match(conversation, /<button type="button" ref=\{earlierRef\}[^>]*onClick=\{\(\) => void loadOlder\(\)\}>/);
  assert.match(conversation, /id=\{optionsId\(message\.id\)\}\s*className=\{styles\.more\}/);
  // The view is held where the member was reading only when focus is not about to take it to the top.
  assert.match(conversation, /const handOff = oldest && earlierHasFocus\(\);[\s\S]{0,200}?if \(!handOff\) requestAnimationFrame\(/);
  // The hook runs before the page's early returns (hooks are called every render).
  assert.ok(conversation.indexOf("useShowMoreFocus(shownOrder") < conversation.indexOf("if (!adult) {"));
});

test("the video picker moves focus on as each step replaces the one before", () => {
  const picker = source("src/components/social/videos/VideoPicker.tsx");
  // Every step's block carries the hand-off: choose, opening, trim, preparing, camera, ready.
  assert.equal((picker.match(/ref=\{stepRef\}/g) ?? []).length, 6);
  for (const kind of ["idle", "reading", "trim", "preparing", "camera", "ready"]) {
    assert.match(picker, new RegExp(`\\{stage\\.kind === "${kind}" && \\(\\s*<(div|p) ref=\\{stepRef\\}`), kind);
  }
  assert.match(picker, /return document\.getElementById\(pickerFocusId\(stage\.kind, \{ trim, ready: readyFocus \}\)\) \?\? document\.getElementById\(pickerFocusId\(stage\.kind, \{ trim \}\)\);/);
  assert.match(picker, /const trim = stage\.kind === "trim" && stage\.source\.durationMs > max;/, "the Start at slider is there only for a long clip");
  // The targets exist: the status lines take focus from script only.
  assert.equal((picker.match(/id=\{PICKER_IDS\.status\} tabIndex=\{-1\}/g) ?? []).length, 2, "Opening the video, Preparing the video");
  assert.match(picker, /<input id=\{PICKER_IDS\.choose\} type="file"/);
  assert.match(picker, /<input id=\{PICKER_IDS\.start\} type="range"/);
  assert.match(picker, /id=\{PICKER_IDS\.prepare\}[^\n]*>Prepare video</);
  assert.match(picker, /id=\{PICKER_IDS\.again\}[^>]*><RotateCcw[^>]*\/>Choose another</);
  // Start and Stop recording are one element whose words change, so focus stays on it while recording.
  assert.equal((picker.match(/<button type="button" id=\{PICKER_IDS\.record\} className="fitx-button"/g) ?? []).length, 2);
  // A ready clip: on to the story's caption, or the video post's description.
  assert.match(source("src/components/social/stories/StoryComposer.tsx"), /<VideoPicker target="story"[^>]*readyFocus="story-caption" \/>/);
  assert.match(source("src/components/social/videos/VideoComposer.tsx"), /<VideoPicker target="post"[^>]*readyFocus="video-alt" \/>/);
  assert.match(source("src/components/social/videos/VideoComposer.tsx"), /<input id="video-alt"/);
});

test("Create profile hands focus on into Explore: the link for the page now open, else its heading, else the first link", () => {
  const shell = source("src/components/social/ExploreShell.tsx");
  assert.match(shell, /if \(status === "setup"\) return <Setup ref=\{setupRef\} \/>;/);
  assert.match(shell, /function Setup\(\{ ref \}: \{ ref\?: Ref<HTMLDivElement> \}\) \{/);
  assert.match(shell, /<div ref=\{ref\} className=\{styles\.shell\}>\s*<section className=\{styles\.stage\} aria-labelledby="explore-setup-title">/);
  assert.match(shell, /const \[setupRef\] = useFocusHandOff\(\(\) => afterSetup\(shell\.current\)\);/);
  assert.match(shell, /<div ref=\{shell\} className=\{styles\.shell\}>\s*<ExploreNav \/>/);
  const after = shell.slice(shell.indexOf("function afterSetup("), shell.indexOf("function Gate("));
  assert.match(after, /'nav\[aria-label="Explore"\]'/);
  assert.match(after, /'a\[aria-current="page"\]'/);
  assert.ok(after.indexOf('a[aria-current="page"]') < after.indexOf('"h1"'), "the open page's link first");
  assert.match(after, /if \(heading && !heading\.hasAttribute\("tabindex"\)\) heading\.setAttribute\("tabindex", "-1"\);/);
  assert.match(after, /return heading \?\? nav\?\.querySelector<HTMLElement>\("a"\) \?\? null;/);
  // The rail it looks in is Explore's own navigation.
  assert.match(shell, /<nav className=\{styles\.subnav\} aria-label="Explore" data-tabs=\{items\.length\}>/);
  assert.match(shell, /aria-current=\{item\.active \? "page" : undefined\}/);
  // Hooks come before Gate's early returns.
  const gate = shell.slice(shell.indexOf("function Gate("));
  assert.ok(gate.indexOf("useFocusHandOff(") < gate.indexOf('if (status === "loading")'));
});

// The same mistake, found in the sweep for this round: a control that takes itself away when pressed.
test("the caption's More and the comment box's Cancel hand focus on instead of dropping it", () => {
  const card = source("src/components/social/PostCard.tsx");
  assert.match(card, /const \[moreRef\] = useFocusHandOff\(\(\) => document\.getElementById\(captionId\)\);/);
  assert.match(card, /<p id=\{captionId\} tabIndex=\{-1\} className=/, "the caption, open in full, to read on");
  assert.match(card, /<button type="button" ref=\{moreRef\} className=\{styles\.more\} onClick=\{\(\) => setExpanded\(true\)\}>More<\/button>/);
  const post = source("src/components/social/PostView.tsx");
  assert.match(post, /onClick=\{cancel\}>Cancel<\/button>/);
  const cancel = post.slice(post.indexOf("const cancel = () => {"), post.indexOf("const startReply"));
  assert.match(cancel, /setReplyTo\(null\);\s*setEditing\(null\);\s*setBody\(""\);\s*focusAfter\("comment-body", \(\) => \(edited \? document\.getElementById\(optionsId\(edited\)\) : null\) \?\? heading\.current\);/,
    "the box, else (an edit on a post that no longer takes comments) that comment's options, else the heading");
});
