import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { communityChallengesNote, type Challenge } from "@/lib/social/challenges";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

const open: Challenge = {
  id: "c1", kind: "weekly", title: "Five workouts", metric: "workouts", sport: null, target: 5,
  starts_at: "2026-11-23T00:00:00+05:30", ends_at: "2026-11-30T00:00:00+05:30", closed_at: null, community: null,
  participants: 3, joined: false, entry: null, badges: [],
};

// Bug 60 (explore-8): with no challenge open, Community hid its Challenges section, the only way to Challenges and
// the finished ones.
test("Community's Challenges section says why it is empty, and never calls a failed load 'none open'", () => {
  assert.equal(communityChallengesNote(null), null, "loading: the skeleton, no words");
  assert.equal(communityChallengesNote([open]), null, "open ones are listed instead");
  const none = communityChallengesNote([]);
  assert.ok(none);
  assert.match(none.text, /^No challenge is open right now\./);
  assert.equal(none.finishedLink, true, "the finished ones and their results are one step away");
  const failed = communityChallengesNote("failed");
  assert.ok(failed);
  assert.match(failed.text, /did not load/);
  assert.doesNotMatch(failed.text, /No challenge/, "unknown is never shown as none");
  assert.equal(failed.finishedLink, false);
});

test("the section and its All challenges link are drawn whether or not a challenge is open", () => {
  const directory = source("src/components/social/community/CommunityDirectory.tsx");
  const section = directory.indexOf('<section className={styles.section} aria-labelledby="community-challenges">');
  assert.ok(section > 0, "the section is found");
  // Nothing conditional wraps the section: the line before it is the comment, not `shown.length > 0 && (`.
  assert.doesNotMatch(directory.slice(Math.max(0, section - 220), section), /shown\.length > 0 &&|\) : shown/);
  assert.match(directory, /<Link href="\/explore\/challenges" [^>]*>All challenges/);
  assert.match(directory, /href="\/explore\/challenges\?box=closed"/, "a direct way to the Finished tab");
  assert.match(directory, /\.catch\(\(\) => \{ if \(live\) setChallenges\("failed"\); \}\)/, "a failed load is kept apart from an empty list");
  // The Challenges page itself keeps its Open and Finished tabs, which ?box=closed opens.
  const page = source("src/components/social/challenges/ChallengesView.tsx");
  assert.match(page, /params\?\.get\("box"\) === "closed" \? "closed" : "open"/);
  assert.match(page, /\{ value: "closed", label: "Finished" \}/);
});
