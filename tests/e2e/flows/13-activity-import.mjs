// Flow 13: Activity imports. Two files a watch or app might export (a Garmin-style GPX that says it is a run, and an
// Apple Health route GPX that names no sport) are chosen on /activity/import; the person picks the sport for the second,
// imports both, sees them saved with their source, imports the first again (recognised, not duplicated), finds the
// source badge on the activity page and in the history, and deletes them again.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signInUi } from "./common.mjs";

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

function appleGpx(points) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Apple Health Export" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Route</name><trkseg>
${points.map((p) => `<trkpt lon="${p.lng}" lat="${p.lat}"><ele>${p.ele}</ele><time>${p.t}</time><extensions><speed>1.3</speed><hAcc>4.0</hAcc><vAcc>3.0</vAcc></extensions></trkpt>`).join("\n")}
</trkseg></trk></gpx>`;
}

export const flow = {
  id: "13-activity-import",
  title: "Activity imports: choose GPX files, confirm sports, import, re-import, source badges, delete",
  async run(t, { standin, outDir }) {
    const page = await t.open();
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

    await t.step("delete the imports", async () => {
      for (const id of (await standin.one(`select string_agg(id::text, ',') ids from public.activities where ${mine}`)).ids.split(",")) {
        await t.goto(`/activity/${id}`, { label: "delete import" });
        await page.getByRole("button", { name: "Delete activity" }).click();
        const confirm = page.getByRole("alertdialog");
        await confirm.waitFor();
        await Promise.all([page.waitForURL((url) => url.pathname === "/activity", { timeout: 20000 }), confirm.getByRole("button", { name: "Delete" }).click()]);
      }
      const row = await standin.one(`select count(*)::int n from public.activities where ${mine}`);
      t.expect(Number(row.n) === 0, "the imports are deleted", row);
    });
  },
};
