// /activity/<segment>: a sport page, an activity, or not found, decided once for the page and its title (D3: a
// not-found address keeps "Page not found" as its title, never "Activity").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activityRoute, activityRouteTitle } from "@/lib/activity/route";

const ID = "6f1c6b1e-0d55-4b1c-9d59-1d2f3c4b5a69";

test("sport slugs, saved and device ids are pages; anything else is not", () => {
  assert.deepEqual(activityRoute("hike"), { kind: "sport", sport: "hike" });
  assert.deepEqual(activityRoute("trail-run"), { kind: "sport", sport: "trail_run" });
  assert.deepEqual(activityRoute(ID.toUpperCase()), { kind: "activity", id: ID });
  assert.deepEqual(activityRoute(`local-${ID}`), { kind: "activity", id: `local-${ID}` });
  for (const segment of ["not-a-uuid", "", "local-", `${ID}x`, "Hike"]) assert.equal(activityRoute(segment), null, segment);
});

test("titles: the sport's name or Activity", () => {
  assert.equal(activityRouteTitle({ kind: "sport", sport: "hike" }), "Hikes");
  assert.equal(activityRouteTitle({ kind: "activity", id: ID }), "Activity");
});

test("the page's metadata is not found for an address that isn't a page, like the page itself", () => {
  const page = readFileSync("src/app/(dashboard)/activity/[id]/page.tsx", "utf8");
  const metadata = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("export default"));
  assert.match(metadata, /if \(!route\) notFound\(\);/);
  assert.match(page.slice(page.indexOf("export default")), /if \(!route\) notFound\(\);/);
});
