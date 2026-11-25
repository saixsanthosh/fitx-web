import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { routeId, routeSlug, routeUsername } from "@/lib/social/route-params";
import { EXPLORE_TITLE_TEMPLATE, exploreTabTitle, storyTitle } from "@/lib/social/titles";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const ID = "99ed72cc-91f2-45df-89ea-6860f32cacb4";

// Bug 78's rule for Explore's own routes: a malformed address showed the not-found page under the title of the page it
// would have been ("Profile · Explore · FITX"), and every profile had that same title, so moving between profiles
// announced nothing new.
test("Explore's addresses are read once, the same way for the page and its title", () => {
  assert.equal(routeUsername("ben.okafor"), "ben.okafor");
  assert.equal(routeUsername("@Ben.Okafor"), "ben.okafor");
  assert.equal(routeUsername("%40ben.okafor"), "ben.okafor");
  assert.equal(routeUsername("ben%20okafor"), null, "a space cannot be in a username");
  assert.equal(routeUsername("%E0%A4%A"), null, "a malformed escape is not found (it threw before)");
  assert.equal(routeUsername("a".repeat(31)), null);
  assert.equal(routeId(ID.toUpperCase()), ID);
  assert.equal(routeId("not-a-uuid"), null);
  assert.equal(routeSlug("Morning-Runners"), "morning-runners");
  assert.equal(routeSlug("-bad"), null);
  assert.equal(routeSlug("ab"), null, "three characters at least");
});

test("each dynamic Explore page calls notFound() from generateMetadata for a malformed address, so its title is Page not found", () => {
  const routes: [string, string, RegExp][] = [
    ["src/app/(dashboard)/explore/u/[username]/page.tsx", "routeUsername", /return \{ title: `@\$\{name\}` \};/],
    ["src/app/(dashboard)/explore/stories/[username]/page.tsx", "routeUsername", /return \{ title: storyTitle\(name\) \};/],
    ["src/app/(dashboard)/explore/p/[id]/page.tsx", "routeId", /return \{ title: "Post" \};/],
    ["src/app/(dashboard)/explore/c/[slug]/page.tsx", "routeSlug", /return \{ title: "Community" \};/],
    ["src/app/(dashboard)/explore/challenges/[id]/page.tsx", "routeId", /return \{ title: "Challenge" \};/],
    ["src/app/(dashboard)/explore/messages/[id]/page.tsx", "routeId", /return \{ title: "Conversation" \};/],
  ];
  for (const [file, reader, title] of routes) {
    const page = source(file);
    assert.doesNotMatch(page, /export const metadata/, `${file}: no fixed title that a not-found page would inherit`);
    const metadata = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("export default"));
    assert.match(metadata, new RegExp(`${reader}\\(\\(await params\\)\\.\\w+\\)`), file);
    assert.match(metadata, /notFound\(\);/, file);
    assert.match(metadata, title, file);
    assert.match(page.slice(page.indexOf("export default")), new RegExp(`${reader}\\(\\(await params\\)\\.\\w+\\);\\s*if \\(!\\w+\\) notFound\\(\\);`), `${file}: the page reads it the same way`);
  }
  // A conversation's title never names the other member (tabs and history are not private).
  assert.doesNotMatch(source("src/app/(dashboard)/explore/messages/[id]/page.tsx"), /title: `/);
});

// Review of bug 78: the viewer moves on to the next account in the tray with history.replaceState, which is no
// navigation, so the title stayed "Story by @ben.okafor · Explore · FITX" while Tara's story was on screen at
// /explore/stories/tara.shah.
test("the story viewer keeps the tab title, and the address, on the account on screen", () => {
  assert.equal(storyTitle("tara.shah"), "Story by @tara.shah");
  assert.equal(exploreTabTitle(storyTitle("tara.shah")), "Story by @tara.shah · Explore · FITX", "as Next fills in the template");
  assert.equal(exploreTabTitle("$&"), "$& · Explore · FITX", "the title is taken as it is");
  assert.match(source("src/app/(dashboard)/explore/layout.tsx"), /title: \{ default: "Explore", template: EXPLORE_TITLE_TEMPLATE \}/);
  assert.equal(EXPLORE_TITLE_TEMPLATE, "%s · Explore · FITX");
  const viewer = source("src/components/social/stories/StoryViewer.tsx");
  const follow = viewer.slice(viewer.indexOf("const shownName = useRef(username);"), viewer.indexOf("}, [name]);") + "}, [name]);".length);
  assert.ok(follow.length > 40, "one effect follows the account on screen");
  assert.match(follow, /if \(shownName\.current === name\) return;\s*shownName\.current = name;/, "nothing on opening: the page's own title and address name it");
  assert.match(follow, /window\.history\.replaceState\(window\.history\.state, "", `\/explore\/stories\/\$\{encodeURIComponent\(name\)\}`\);/);
  assert.match(follow, /document\.title = exploreTabTitle\(storyTitle\(name\)\);/);
  assert.equal(viewer.split("replaceState(").length - 1, 1, "the address changes only there (it also follows a skipped account now)");
  assert.match(viewer, /const name = account\?\.author\.username \?\? username;/);
});
