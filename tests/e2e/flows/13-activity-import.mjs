// Flow 13: Activity imports. Two files a watch or app might export (a Garmin-style GPX that says it is a run, and an
// Apple Health route GPX that names no sport) are chosen on /activity/import; the person picks the sport for the second,
// imports both, sees them saved with their source, imports the first again (recognised, not duplicated), finds the
// source badge on the activity page and in the history, filters the history by sport (and opens the run page). Then the
// newer sports (migration 20261123100050): a hiking GPX is recognised as a hike, saved with its best efforts and listed on
// the hike page, and a trail run chosen under More sports is recorded live from stand-in positions (CDP geolocation) with
// auto-pause and locked controls. Everything is deleted again.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signInUi, textOf } from "./common.mjs";

const START = { lat: 12.97634, lng: 77.59287 }; // Cubbon Park, Bengaluru

/** Points along a bearing at `speed` m/s, one a second, from `startMs`. */
function track(startMs, seconds, { bearing = 40, speed = 3, fromLat = START.lat, fromLng = START.lng } = {}) {
  const rad = (bearing * Math.PI) / 180;
  return Array.from({ length: seconds + 1 }, (_, i) => {
    const metres = i * speed;
    const lat = fromLat + (metres * Math.cos(rad)) / 111320;
    const lng = fromLng + (metres * Math.sin(rad)) / (111320 * Math.cos((fromLat * Math.PI) / 180));
    return { t: new Date(startMs + i * 1000).toISOString(), lat: lat.toFixed(7), lng: lng.toFixed(7), ele: (920 + i * 0.02).toFixed(1) };
  });
}

function garminGpx(points) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Lake loop</name><type>running</type><trkseg>
${points.map((p) => `    <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele><time>${p.t}</time></trkpt>`).join("\n")}
  </trkseg></trk>
</gpx>`;
}

function hikeGpx(points) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Suunto app" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Ridge walk</name><type>hiking</type><trkseg>
${points.map((p) => `    <trkpt lat="${p.lat}" lon="${p.lng}"><ele>${p.ele}</ele><time>${p.t}</time></trkpt>`).join("\n")}
  </trkseg></trk>
</gpx>`;
}

/** A point `metres` along a bearing from START, for the live recording. */
function along(metres, bearingDeg = 120) {
  const rad = (bearingDeg * Math.PI) / 180;
  return {
    latitude: START.lat + (metres * Math.cos(rad)) / 111320,
    longitude: START.lng + (metres * Math.sin(rad)) / (111320 * Math.cos((START.lat * Math.PI) / 180)),
  };
}

function appleGpx(points) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Apple Health Export" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Route</name><trkseg>
${points.map((p) => `<trkpt lon="${p.lng}" lat="${p.lat}"><ele>${p.ele}</ele><time>${p.t}</time><extensions><speed>1.3</speed><hAcc>4.0</hAcc><vAcc>3.0</vAcc></extensions></trkpt>`).join("\n")}
</trkseg></trk></gpx>`;
}

export const flow = {
  id: "13-activity-import",
  title: "Activity imports and newer sports: GPX files, sports, re-import, source badges, a hike's best efforts, a live trail run, delete",
  async run(t, { standin, outDir }) {
    const page = await t.open({ permissions: ["geolocation"], geolocation: { latitude: START.lat, longitude: START.lng, accuracy: 5 } });
    const account = await standin.createAccount({ name: "Arjun Rao", tag: "import" });
    await signInUi(t, account);
    mkdirSync(outDir, { recursive: true });
    // Every query is limited to this run's account: other flows and the other screen size share the stand-in.
    const mine = `user_id = '${account.id}'`;
    // Yesterday morning and the evening before, so both keep their GPS points (kept for 90 days).
    const yesterday = Date.now() - 86_400_000;
    const runFile = path.join(outDir, "Lake_loop.gpx");
    const walkFile = path.join(outDir, "route_walk.gpx");
    writeFileSync(runFile, garminGpx(track(yesterday, 900)));
    writeFileSync(walkFile, appleGpx(track(yesterday - 12 * 3600_000, 1200, { bearing: 200, speed: 1.3 })));

    await t.step("the import page is open (the sources migration is applied)", async () => {
      await t.goto("/activity/import", { label: "import page" });
      await page.getByRole("heading", { name: "Import activities" }).waitFor({ timeout: 15000 });
      const ready = await page.getByText("Choose files", { exact: true }).waitFor({ timeout: 15000 }).then(() => true, () => false);
      t.expect(ready, "the file picker should show once the database has the source columns");
      await t.checkpoint("import page", { fullPage: false });
    });

    await t.step("choose two files: one says it is a run, one names no sport", async () => {
      await page.locator("input[type=file]").setInputFiles([runFile, walkFile]);
      await page.getByText("Ready to import").first().waitFor({ timeout: 20000 });
      const runSport = page.getByRole("group", { name: "Sport for Lake_loop.gpx" }).getByRole("button", { name: /Run/ });
      t.expect((await runSport.getAttribute("aria-pressed")) === "true", "the run's sport comes from the file");
      const walkGroup = page.getByRole("group", { name: "Sport for route_walk.gpx" });
      t.expect((await walkGroup.getByRole("button", { name: /Walk/ }).getAttribute("aria-pressed")) === "false", "a file without a sport waits for the person");
      await walkGroup.getByRole("button", { name: /Walk/ }).click();
      await page.getByRole("button", { name: "Import 2 activities" }).waitFor({ timeout: 10000 });
      await t.checkpoint("two files ready", { fullPage: true });
    });

    await t.step("import both: saved with their source", async () => {
      await page.getByRole("button", { name: "Import 2 activities" }).click();
      await page.getByText("2 imported.").waitFor({ timeout: 30000 });
      const rows = await standin.sql(`select sport, source, source_format, source_device, round(distance_m)::int distance_m from public.activities where ${mine} order by started_at`);
      t.note("imported rows", rows);
      const summary = await standin.one(`select count(*)::int n, count(*) filter (where source = 'file')::int files,
          count(*) filter (where source_device = 'Garmin Connect' and source_format = 'gpx' and sport = 'run')::int garmin,
          count(*) filter (where source_device = 'Apple Health Export' and sport = 'walk')::int apple,
          (select count(*) from public.activity_track_chunks where ${mine})::int chunks from public.activities where ${mine}`);
      t.expect(Number(summary.n) === 2 && Number(summary.files) === 2, "both imports should be saved as files", summary);
      t.expect(Number(summary.garmin) === 1 && Number(summary.apple) === 1, "each keeps its device and the sport chosen", summary);
      t.expect(Number(summary.chunks) > 0, "recent imports keep their GPS points", summary);
      await t.checkpoint("imported", { fullPage: true });
    });

    await t.step("importing the same file again is recognised, not duplicated", async () => {
      await page.getByRole("button", { name: "Clear list" }).click();
      await page.locator("input[type=file]").setInputFiles([runFile]);
      await page.getByText("Already in FITX, so it won’t be imported again.").waitFor({ timeout: 20000 });
      const row = await standin.one(`select count(*)::int n from public.activities where ${mine}`);
      t.expect(Number(row.n) === 2, "still two activities", row);
    });

    await t.step("the activity page and the history show where it came from", async () => {
      const id = (await standin.one(`select id from public.activities where ${mine} and source_device = 'Garmin Connect'`)).id;
      await t.goto(`/activity/${id}`, { label: "imported activity" });
      await page.getByText("Imported · Garmin Connect · GPX").first().waitFor({ timeout: 15000 });
      await t.checkpoint("imported activity page");
      await t.goto("/activity", { label: "history with imports" });
      await page.getByText("Imported · Apple Health Export · GPX").first().waitFor({ timeout: 15000 });
      await t.checkpoint("history with source badges");
    });

    await t.step("each sport keeps its own history: the run under Runs and on the run page, the walk under Walks", async () => {
      const feed = page.locator("section[aria-labelledby=feed-title]");
      const garmin = feed.getByText("Imported · Garmin Connect · GPX");
      const apple = feed.getByText("Imported · Apple Health Export · GPX");
      await page.getByRole("radiogroup", { name: "Show" }).getByText("Runs", { exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("sport") === "run", { timeout: 10000 });
      const walkGone = await apple.first().waitFor({ state: "detached", timeout: 15000 }).then(() => true, () => false);
      t.expect(walkGone, "the walk is not listed under runs");
      await garmin.first().waitFor({ timeout: 15000 });
      await t.checkpoint("history filtered to runs", { fullPage: true });
      await page.getByRole("radiogroup", { name: "Show" }).getByText("Walks", { exact: true }).click();
      const runGone = await garmin.first().waitFor({ state: "detached", timeout: 15000 }).then(() => true, () => false);
      t.expect(runGone, "the run is not listed under walks");
      await apple.first().waitFor({ timeout: 15000 });
      await t.goto("/activity/run", { label: "run page with an import" });
      await page.getByText("Imported · Garmin Connect · GPX").first().waitFor({ timeout: 15000 });
      const stats = await textOf(page.getByRole("region", { name: "Run statistics" }));
      t.note("run statistics", stats);
      t.expect(/Longest run/.test(stats) && /Average pace/.test(stats) && !/Not logged/.test(stats), "the run page shows running figures from the import", stats);
      await t.checkpoint("run page");
    });

    await t.step("a hiking file is a hike: saved with its best efforts and listed on the hike page", async () => {
      const hikeFile = path.join(outDir, "Ridge_walk.gpx");
      writeFileSync(hikeFile, hikeGpx(track(yesterday - 30 * 3600_000, 1500, { bearing: 300, speed: 1.4 })));
      await t.goto("/activity/import", { label: "import a hike" });
      await page.getByText("Choose files", { exact: true }).waitFor({ timeout: 15000 });
      await page.locator("input[type=file]").setInputFiles([hikeFile]);
      await page.getByText("Ready to import").first().waitFor({ timeout: 20000 });
      const hike = page.getByRole("group", { name: "Sport for Ridge_walk.gpx" }).getByRole("button", { name: "Hike", exact: true });
      t.expect((await hike.getAttribute("aria-pressed")) === "true", "the file's hiking type is read as a hike");
      await page.getByRole("button", { name: "Import 1 activity" }).click();
      await page.getByText("1 imported.").waitFor({ timeout: 30000 });
      const row = await standin.one(`select id, sport, jsonb_array_length(best_efforts)::int efforts, (best_efforts -> 0 ->> 'd')::numeric first_d from public.activities where ${mine} and sport = 'hike'`);
      t.note("hike row", row);
      t.expect(row.sport === "hike" && Number(row.efforts) >= 1 && Number(row.first_d) === 1000, "the hike keeps its best efforts (1 km first)", row);
      await t.goto(`/activity/${row.id}`, { label: "hike page" });
      const efforts = page.getByRole("region", { name: "Best efforts" });
      await efforts.waitFor({ timeout: 20000 });
      const text = await textOf(efforts);
      t.expect(/1 km/.test(text) && /PR/.test(text), "the hike's best efforts show, its 1 km a PR", text);
      await t.checkpoint("hike with best efforts", { fullPage: true });
      await t.goto("/activity/hike", { label: "hike sport page" });
      await page.getByRole("heading", { name: "Hike", level: 1 }).waitFor({ timeout: 15000 });
      await page.getByText("Imported · Suunto app · GPX").first().waitFor({ timeout: 15000 });
      await t.checkpoint("hike sport page");
    });

    await t.step("a trail run chosen under More sports records live: distance, pace, auto-pause and locked controls", async () => {
      const cdp = await t.context.newCDPSession(page);
      await cdp.send("Emulation.setGeolocationOverride", { ...along(0), accuracy: 5 });
      await t.goto("/activity/record", { label: "record screen" });
      await page.getByRole("button", { name: "More sports" }).click();
      await page.getByRole("group", { name: "Foot and wheelchair" }).getByRole("button", { name: "Trail run" }).click();
      const quick = page.getByRole("group", { name: "Activity type" }).getByRole("button", { name: "Trail run" });
      t.expect((await quick.getAttribute("aria-pressed")) === "true", "the chosen sport joins the quick row, selected");
      const autoPause = page.getByRole("switch", { name: "Auto-pause" });
      if ((await autoPause.getAttribute("aria-checked")) !== "true") await autoPause.click();
      const allow = page.getByRole("button", { name: "Allow location" });
      if (await allow.isVisible().catch(() => false)) await allow.click();
      await page.getByRole("button", { name: /^Start trail run/ }).click();
      await page.getByRole("button", { name: "Pause" }).waitFor({ timeout: 15000 });
      let metres = 0;
      for (let i = 0; i < 40; i += 1) {
        metres += 3.5;
        await cdp.send("Emulation.setGeolocationOverride", { ...along(metres), accuracy: 5 });
        await page.waitForTimeout(1000);
      }
      const live = await textOf(page.getByRole("region", { name: "Live statistics" }));
      t.note("live statistics", live);
      t.expect(/Moving time/.test(live) && /Pace/.test(live) && /Last km/.test(live), "live moving time and pace while moving (auto-pause on)", live);
      await t.checkpoint("trail run recording");
      // Standing still: the clock holds and says so.
      for (let i = 0; i < 16; i += 1) {
        await cdp.send("Emulation.setGeolocationOverride", { ...along(metres), accuracy: 5 });
        await page.waitForTimeout(1000);
      }
      const held = await page.getByRole("region", { name: "Live statistics" }).getByText("Auto-paused").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
      t.expect(held, "standing still shows Auto-paused");
      await page.getByRole("button", { name: "Lock" }).click();
      const unlock = page.getByRole("button", { name: "Hold to unlock controls" });
      await unlock.waitFor({ timeout: 5000 });
      t.expect(!(await page.getByRole("button", { name: "Pause" }).isVisible().catch(() => false)), "locked: Pause is not on screen");
      await t.checkpoint("controls locked");
      await unlock.click();
      t.expect(await unlock.isVisible(), "a tap does not unlock");
      const box = await unlock.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(1100);
      await page.mouse.up();
      await page.getByRole("button", { name: "Pause" }).waitFor({ timeout: 5000 });
      await page.getByRole("button", { name: "Finish", exact: true }).first().click();
      const confirm = page.getByRole("alertdialog");
      await confirm.waitFor();
      await Promise.all([page.waitForURL((url) => /^\/activity\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 30000 }), confirm.getByRole("button", { name: "Finish" }).click()]);
      const saved = await standin.one(`select sport, round(distance_m)::int distance_m, moving_seconds, elapsed_seconds from public.activities where ${mine} and source = 'fitx_gps'`);
      t.note("recorded trail run", saved);
      t.expect(saved.sport === "trail_run" && Number(saved.distance_m) > 50 && Number(saved.moving_seconds) < Number(saved.elapsed_seconds), "saved as a trail run, with stops left out of moving time", saved);
      await cdp.detach().catch(() => {});
    });

    await t.step("delete the imports", async () => {
      for (const id of (await standin.one(`select string_agg(id::text, ',') ids from public.activities where ${mine}`)).ids.split(",")) {
        await t.goto(`/activity/${id}`, { label: "delete import" });
        await page.getByRole("button", { name: "Delete activity" }).click();
        const confirm = page.getByRole("alertdialog");
        await confirm.waitFor();
        await Promise.all([page.waitForURL((url) => url.pathname === "/activity", { timeout: 20000 }), confirm.getByRole("button", { name: "Delete" }).click()]);
      }
      const row = await standin.one(`select count(*)::int n from public.activities where ${mine}`);
      t.expect(Number(row.n) === 0, "the imports and the recording are deleted", row);
    });
  },
};
