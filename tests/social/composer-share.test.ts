import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PHOTO_AREA_HINT, shareBlock, shareBlockText } from "@/lib/social/compose";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

// Bug 61 (explore-9): with a caption and no photo, Share post stayed disabled with no reason, and keyboard users
// tabbed straight past it.
test("Share post says why it cannot go yet: no photo, photos still being prepared, or already posting", () => {
  assert.equal(shareBlock({ media: 0, preparing: 0, posting: false }), "no_media");
  assert.equal(shareBlock({ media: 0, preparing: 1, posting: false }), "preparing", "a photo on its way is not 'no photo'");
  assert.equal(shareBlock({ media: 2, preparing: 1, posting: false }), "preparing");
  assert.equal(shareBlock({ media: 1, preparing: 0, posting: true }), "posting");
  assert.equal(shareBlock({ media: 1, preparing: 0, posting: false }), null);
  assert.equal(shareBlock({ media: 1, posting: false }), null, "the video composer has nothing to prepare");
  assert.equal(shareBlockText("no_media"), "Add at least one photo to share a post.");
  assert.equal(shareBlockText("no_media", "video"), "Choose a video to share a post.");
  assert.match(shareBlockText("preparing") ?? "", /still being made smaller/);
  assert.equal(shareBlockText("posting"), null, "the button itself says Posting…");
  assert.equal(shareBlockText(null), null);
  assert.equal(PHOTO_AREA_HINT, "A post needs 1 to 10 photos. They are made smaller on your device first.");
});

test("the composers keep Share reachable (aria-disabled, never disabled) with the reason as its description", () => {
  for (const [file, id] of [["src/components/social/ComposerView.tsx", "share-reason"], ["src/components/social/videos/VideoComposer.tsx", "share-video-reason"]]) {
    const composer = source(file);
    assert.doesNotMatch(composer, /disabled=\{!items\.length \|\| preparing > 0 \|\| busy\}|disabled=\{!video \|\| busy\}/, `${file}: no silent disabled`);
    assert.match(composer, /aria-disabled=\{block !== null \|\| undefined\}/, file);
    assert.match(composer, new RegExp(`aria-describedby=\\{reason \\? "${id}" : undefined\\}`), file);
    assert.match(composer, /if \(block === "posting"\) return;\s*if \(block\) \{ setNudged\(\(count\) => count \+ 1\); return; \}\s*void publish\(\);/, `${file}: pressed while blocked, it says why again`);
    assert.match(composer, new RegExp(`<p id="${id}" key=\\{nudged\\} role=\\{nudged \\? "alert" : undefined\\}`), file);
  }
  assert.match(source("src/components/social/ComposerView.tsx"), /\{!items\.length && <span className=\{styles\.hint\}>\{PHOTO_AREA_HINT\}<\/span>\}/);
});
