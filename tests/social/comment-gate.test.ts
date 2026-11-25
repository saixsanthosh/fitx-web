import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { commentGate } from "@/lib/social/comment-gate";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const post = (comment_policy: "everyone" | "followers" | "off", can_comment: boolean, mine = false) => ({
  comment_policy, can_comment, mine, author: { username: "ben.okafor" },
});

// Bug 59 (explore-3): a followers-only post said "Comments are off." to a non-follower, and with comments already there
// the box and the Reply buttons simply disappeared.
test("a post says why the member cannot comment, from the post's own setting", () => {
  assert.equal(commentGate(post("followers", false)), "Only @ben.okafor’s followers can comment. Follow them to join in.");
  assert.equal(commentGate(post("off", false)), "Comments are off.");
  assert.equal(commentGate(post("off", false, true)), "Comments are off. Edit the post to turn them on.", "the owner is told how to turn them on");
  assert.equal(commentGate(post("everyone", false)), "You cannot comment on this post.", "never 'off' for a post whose comments are open");
  for (const policy of ["everyone", "followers", "off"] as const) assert.equal(commentGate(post(policy, true)), null, `${policy}: the box shows`);
});

test("the post page shows the reason where the box would be, with or without comments, and no 'Comments are off.' guess", () => {
  const view = source("src/components/social/PostView.tsx");
  assert.doesNotMatch(view, /post\.can_comment \? "No comments yet\." : "Comments are off\."/);
  assert.match(view, /const gate = commentGate\(post\);/);
  assert.match(view, /\{gate && !editing && <p className=\{`\$\{styles\.note\} mt-4`\}>\{gate\}<\/p>\}\s*\{\(post\.can_comment \|\| editing\) && \(/);
});
