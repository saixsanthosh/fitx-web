// Release 3 fix round 3c (an earlier open item of this stream): the note shown when a map's tiles fail always said
// "Your route is still being recorded.", also before Start and on a saved activity's page, where nothing is being
// recorded. Each map now says what it shows (routeState) and the note is true in every state; the no-WebGL note
// likewise no longer promises a route before there is one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapNotice, recordMapState, type MapState } from "@/components/activity/messages";
import type { RecorderPhase } from "@/lib/activity/recorder";

const STATES: MapState[] = ["ready", "recording", "paused", "finished", "saved", "on-device"];

test("the tiles note says what is true for the route in each state", () => {
  assert.deepEqual(Object.fromEntries(STATES.map((state) => [state, mapNotice("tiles", state)])), {
    ready: "Map tiles couldn’t load. You can still record your route.",
    recording: "Map tiles couldn’t load. Your route is still being recorded.",
    paused: "Map tiles couldn’t load. Your route so far is kept.",
    finished: "Map tiles couldn’t load. Your route is kept with the activity.",
    saved: "Map tiles couldn’t load. Your route is saved with this activity.",
    "on-device": "Map tiles couldn’t load. Your route is saved on this device.",
  });
  for (const state of STATES.filter((item) => item !== "recording")) {
    assert.doesNotMatch(mapNotice("tiles", state), /being recorded/, `${state}: nothing is being recorded`);
  }
});

test("without WebGL: the route is drawn once there is one", () => {
  assert.equal(mapNotice("no-map", "ready"), "Map unavailable on this device: your route will be drawn here as you record.");
  for (const state of STATES.filter((item) => item !== "ready")) assert.equal(mapNotice("no-map", state), "Map unavailable on this device: showing the route only.");
});

test("the Record screen's map follows the recorder; an activity's page says whether it is saved to the account", () => {
  const phases: Array<[RecorderPhase, MapState]> = [["idle", "ready"], ["locating", "ready"], ["recording", "recording"], ["paused", "paused"], ["finished", "finished"]];
  for (const [phase, state] of phases) assert.equal(recordMapState(phase), state, phase);
  assert.match(readFileSync("src/components/activity/ActivityRecorderScreen.tsx", "utf8"), /label=\{recording \? "Map of your route so far" : "Map of your current position"\}\s+routeState=\{recordMapState\(phase\)\}/);
  assert.match(readFileSync("src/components/activity/ActivityDetailScreen.tsx", "utf8"), /<ActivityMap [^\n]*routeState=\{view\.local \? "on-device" : "saved"\} \/>/);
  const map = readFileSync("src/components/activity/ActivityMap.tsx", "utf8");
  assert.match(map, /\{mapNotice\("tiles", routeState\)\}<\/p>/);
  assert.match(map, /<p className=\{styles\.notice\}>\{mapNotice\("no-map", routeState\)\}<\/p>/);
  assert.doesNotMatch(map, /still being recorded/, "the words live in messages.ts only");
});
