import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { countParts, plural } from "@/lib/social/format";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

// Bug 92 (explore-7): the follower count's button was named "1 followers" while it showed "1 follower".
test("a count's spoken name is exactly what it shows: one is singular, large counts are shortened the same way", () => {
  assert.deepEqual(countParts(1, "follower"), { value: "1", unit: "follower", name: "1 follower" });
  assert.deepEqual(countParts(0, "follower"), { value: "0", unit: "followers", name: "0 followers" });
  assert.deepEqual(countParts(2, "follower"), { value: "2", unit: "followers", name: "2 followers" });
  assert.deepEqual(countParts(12_400, "follower"), { value: "12.4k", unit: "followers", name: "12.4k followers" }, "never the raw 12400");
  assert.deepEqual(countParts(1, "following", "following"), { value: "1", unit: "following", name: "1 following" });
  assert.equal(countParts(1_250, "post").name, "1,250 posts");
  // plural() is the same words.
  for (const count of [0, 1, 2, 9_999, 10_000, 2_500_000]) assert.equal(plural(count, "follower"), countParts(count, "follower").name, String(count));
});

test("the profile names its count buttons from the parts it draws, not from a second string", () => {
  const profile = source("src/components/social/ProfileView.tsx");
  assert.match(profile, /const followerCount = countParts\(counts\.followers, "follower"\);/);
  assert.match(profile, /aria-label=\{followerCount\.name\}>\s*<span className=\{styles\.countValue\}>\{followerCount\.value\}<\/span><span className=\{styles\.countLabel\}>\{followerCount\.unit\}<\/span>/);
  assert.match(profile, /aria-label=\{followingCount\.name\}>\s*<span className=\{styles\.countValue\}>\{followingCount\.value\}<\/span><span className=\{styles\.countLabel\}>\{followingCount\.unit\}<\/span>/);
  assert.doesNotMatch(profile, /aria-label=\{`\$\{counts\.(followers|following)\}/, "no label built from the raw number");
});
