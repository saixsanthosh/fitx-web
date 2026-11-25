import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { focusAfterRemoval } from "@/lib/social/focus";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

// Bug 82 (explore-6): after Unblock, Unsend, Delete comment and Delete everything, focus fell to the page body (the
// sheet handed it back to a button that was then removed), and Unblock in Explore settings said nothing at all.
test("focus goes to the next control left on the list, else the one before, else the caller's heading", () => {
  const rows = ["a", "b", "c", "d"];
  assert.equal(focusAfterRemoval(rows, ["b"]), "c", "the next one");
  assert.equal(focusAfterRemoval(rows, ["d"]), "c", "the last one: the one before");
  assert.equal(focusAfterRemoval(rows, ["a"]), "b");
  assert.equal(focusAfterRemoval(["a"], ["a"]), null, "the list is empty now: the heading");
  // A comment takes its replies with it: past all of them.
  assert.equal(focusAfterRemoval(["c1", "r1", "r2", "c2"], ["c1", "r1", "r2"]), "c2");
  assert.equal(focusAfterRemoval(["c1", "c2", "r1"], ["c2", "r1"]), "c1");
  assert.equal(focusAfterRemoval(rows, ["x"]), null, "not on the list: the heading");
  assert.equal(focusAfterRemoval([], ["a"]), null);
});

test("Explore settings: Unblock says so beside the list and keeps focus on the list or its heading", () => {
  const settings = source("src/components/social/SettingsView.tsx");
  assert.match(settings, /show\("success", kind === "blocked" \? `@\$\{user\.username\} is unblocked` : `Restriction on @\$\{user\.username\} removed`\);/);
  assert.match(settings, /focusAfter\(focusAfterRemoval\(order, \[safetyRow\(kind, user\.id\)\]\), \(\) => document\.getElementById\("settings-safety"\)\);/);
  assert.match(settings, /<h2 id="settings-safety" tabIndex=\{-1\}/);
  assert.match(settings, /<button type="button" id=\{safetyRow\(kind, user\.id\)\}/);
  // The confirmation is in a live region that is always there, inside the section.
  const safety = settings.slice(settings.indexOf("function Safety()"), settings.indexOf("/** \"23 Nov 2026\". */"));
  assert.match(safety, /<p role="status" className=\{notice && notice\.tone !== "error"/);
  // Deleting content: the next Delete, or the section's heading (after "Delete everything").
  assert.match(settings, /focusAfter\(pending\.kind === "all" \? null : focusAfterRemoval\(order, \[contentRow\(pending\.kind, pending\.id\)\]\), \(\) => heading\.current\);/);
  assert.match(settings, /<h2 id="settings-content" ref=\{heading\} tabIndex=\{-1\}/);
  // Removing the profile picture takes Remove away: focus goes to Change photo.
  assert.match(settings, /focusAfter\("explore-avatar-input"\);/);
});

test("Unsend, Delete comment, the profile's Unblock and answered requests move focus to what is left, not the body", () => {
  const conversation = source("src/components/social/messages/ConversationView.tsx");
  assert.match(conversation, /focusAfter\(unsentId\(message\.id\)\);/);
  assert.match(conversation, /<p id=\{unsentId\(message\.id\)\} tabIndex=\{-1\}/, "the unsent message takes focus in its own place");
  assert.match(conversation, /focusAfter\("conversation-message", \(\) => document\.getElementById\("conversation-back"\)\);/, "Accept: the message box");
  const post = source("src/components/social/PostView.tsx");
  assert.match(post, /focusAfter\(focusAfterRemoval\(order, gone\), \(\) => heading\.current\);/);
  assert.match(post, /<h2 id="comments-title" ref=\{heading\} tabIndex=\{-1\}/);
  assert.match(post, /<button type="button" id=\{optionsId\(comment\.id\)\}/);
  const profile = source("src/components/social/ProfileView.tsx");
  assert.match(profile, /`@\$\{profile\.username\} is unblocked`, "page", "profile-follow"\)/);
  assert.match(profile, /<FollowButton id="profile-follow"/);
  assert.match(source("src/components/social/NotificationsView.tsx"), /focusAfter\(focusAfterRemoval\(order, \[acceptId\(userId\)\]\)/);
  assert.match(source("src/components/social/community/CommunityView.tsx"), /focusAfter\(focusAfterRemoval\(order, \[joinAcceptId\(userId\)\]\)/);
  const challenge = source("src/components/social/challenges/ChallengeView.tsx");
  assert.match(challenge, /"You joined the challenge", "challenge-leave"\)/);
  assert.match(challenge, /"You left the challenge", "challenge-join"\)/);
});

test("the focus mover runs after the commit (so a closing sheet's own focus return comes first) and sets no state in its effect", () => {
  const hook = source("src/components/social/useFocusAfterRender.ts");
  assert.match(hook, /useEffect\(\(\) => \{\s*const request = pending\.current;/);
  assert.match(hook, /document\.getElementById\(request\.id\)/);
  assert.doesNotMatch(hook.slice(hook.indexOf("useEffect("), hook.indexOf("}, [tick]);")), /set[A-Z]\w*\(/);
});

test("busy controls in Explore are aria-disabled, not disabled, so they keep keyboard focus (D5)", () => {
  const files = [
    "src/components/social/FollowButton.tsx", "src/components/social/NotificationsView.tsx", "src/components/social/FeedView.tsx",
    "src/components/social/DiscoverView.tsx", "src/components/social/videos/VideoFeed.tsx", "src/components/social/messages/MessagesView.tsx",
    "src/components/social/messages/ConversationView.tsx", "src/components/social/community/CommunityView.tsx",
    "src/components/social/challenges/ChallengeView.tsx", "src/components/social/community/GroupComposer.tsx", "src/components/social/Switch.tsx",
  ];
  for (const file of files) {
    const text = source(file);
    assert.doesNotMatch(text, /disabled=\{(busy|answering|busy === user\.id|feed\.status === "more"|latest\.status === "more"|more === "busy")\}/, file);
    assert.match(text, /aria-disabled=\{/, file);
  }
  assert.match(source("src/components/social/Switch.tsx"), /onClick=\{\(\) => \{ if \(!busy\) onChange\(!checked\); \}\}/);
});
