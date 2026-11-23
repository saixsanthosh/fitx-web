// The GPS sports: every sport is complete (thresholds, words, page, calories rule), the migration lists exactly
// these, and the recorder offers the newer ones only once the database takes them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateKcal, estimatesKcal, kcalMethodFor, metFor } from "@/lib/activity/calories";
import { SPORT_CONFIG, SPORT_GROUPS, SPORT_INFO, sportFamily, sportFromSlug, usesPace } from "@/lib/activity/config";
import { defaultTitle } from "@/lib/activity/format";
import { toGpx } from "@/lib/activity/gpx";
import { ORIGINAL_SPORTS, PRIMARY_SPORTS, SPORTS, isSport } from "@/lib/activity/types";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("every sport has thresholds, words, a page and a group; walk, run and ride are kept", () => {
  assert.deepEqual(ORIGINAL_SPORTS, ["walk", "run", "ride"]);
  assert.deepEqual(PRIMARY_SPORTS, ["walk", "run", "ride"]);
  const slugs = new Set<string>();
  for (const sport of SPORTS) {
    assert.ok(SPORT_CONFIG[sport].maxSpeedMps > 0, sport);
    assert.ok(SPORT_INFO[sport].label && SPORT_INFO[sport].noun && SPORT_INFO[sport].plural, sport);
    assert.equal(sportFromSlug(SPORT_INFO[sport].slug), sport);
    slugs.add(SPORT_INFO[sport].slug);
    assert.match(defaultTitle(sport, new Date(2026, 10, 20, 7)), /^Morning /);
    assert.match(toGpx({ name: "x", sport, segments: [] }), /<type>[a-z_]+<\/type>/);
  }
  assert.equal(slugs.size, SPORTS.length, "slugs are unique");
  assert.deepEqual(SPORT_GROUPS.flatMap((group) => group.sports).sort(), [...SPORTS].sort(), "every sport is in exactly one chooser group");
  assert.equal(isSport("trail_run"), true);
  assert.equal(isSport("swim"), false);
  assert.equal(sportFromSlug("trail-run"), "trail_run");
  assert.equal(sportFromSlug("00000000-0000-4000-8000-000000000000"), null, "an activity id is never a sport page");
});

test("pace or speed follows the sport", () => {
  assert.deepEqual(SPORTS.filter(usesPace), ["walk", "run", "hike", "trail_run", "wheelchair"]);
  assert.equal(sportFamily("mtb"), "ride");
  assert.equal(sportFamily("hike"), "walk");
});

test("calories only where a Compendium table fits; off-road sports say they are likely low", () => {
  assert.deepEqual(SPORTS.filter(estimatesKcal), ["walk", "run", "ride", "hike", "trail_run", "mtb"]);
  for (const sport of ["ebike", "wheelchair", "skate", "paddle"] as const) {
    assert.equal(estimateKcal(sport, [{ distanceM: 1000, movingSeconds: 300 }], 70), null, `${sport}: never guessed`);
  }
  assert.equal(metFor("hike", 1.3), metFor("walk", 1.3));
  assert.equal(metFor("mtb", 5), metFor("ride", 5));
  assert.match(kcalMethodFor("hike"), /likely low on hills and rough ground/);
  assert.doesNotMatch(kcalMethodFor("run"), /likely low/);
});

test("the migration's sport check lists exactly these sports", () => {
  const sql = source("supabase/migrations/20261123100050_fitx_coach_activity_v2.sql");
  const listed = /check \(sport in \(([^)]+)\)\)/.exec(sql)?.[1].split(",").map((item) => item.trim().replace(/'/g, ""));
  assert.deepEqual(listed?.sort(), [...SPORTS].sort());
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\bdrop table\b|\bdrop column\b|\btruncate\b/i);
});

test("the recorder offers the newer sports only once migration 20261123100050 is there", () => {
  const recorder = source("src/components/activity/ActivityRecorderScreen.tsx");
  assert.match(recorder, /<SportPicker sport=\{sport\} onChoose=\{chooseSport\} more=\{v2 === true\} \/>/);
  assert.match(recorder, /if \(v2 === false && !recording && phase !== "finished" && !PRIMARY_SPORTS\.includes\(sport\)\) setSport\("run"\);/);
  const importer = source("src/components/activity/ActivityImportScreen.tsx");
  assert.match(importer, /const importSports: readonly Sport\[\] = v2 \? SPORTS : PRIMARY_SPORTS;/);
  const home = source("src/components/activity/ActivityHome.tsx");
  assert.match(home, /v2 === true \|\| used\.has\(sport\)/);
});

test("recording extras: auto-pause and cues are per-device switches, cues use an on-device voice, controls lock with a hold", () => {
  const extras = source("src/components/activity/RecordingExtras.tsx");
  assert.match(extras, /role="switch"/);
  assert.match(extras, /pickVoice\(voices as unknown as VoiceLike\[\]/, "the coach's on-device voice picker");
  assert.match(extras, /aria-label="Hold to unlock controls"/);
  assert.match(extras, /const HOLD_MS = 800;/);
  assert.match(extras, /role="group" aria-label="Activity type"/, "the flows' sport group keeps its name");
  const recorder = source("src/components/activity/ActivityRecorderScreen.tsx");
  assert.match(recorder, /\{cueVoice\.available && \(/, "no cue switch without an on-device voice");
  assert.match(recorder, /label="Lock"/);
  assert.match(recorder, /Moving time · auto-paused/);
});
