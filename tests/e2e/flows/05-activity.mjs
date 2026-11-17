// Flow 5: Activity. Location is granted and positions are fed through CDP Emulation.setGeolocationOverride: a short
// walk is recorded with a pause, finished and saved; the detail page shows it (map tiles may be missing while outside
// hosts are blocked); it is renamed, its GPX is exported, a share image is downloaded, and it is deleted.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { signInUi, textOf } from "./common.mjs";

const START = { latitude: 12.97634, longitude: 77.59287 }; // Cubbon Park, Bengaluru

/** A point `metres` along a north-east bearing from START. */
function along(metres, bearingDeg = 40) {
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat = START.latitude + (metres * Math.cos(bearing)) / 111320;
  const lon = START.longitude + (metres * Math.sin(bearing)) / (111320 * Math.cos((START.latitude * Math.PI) / 180));
  return { latitude: lat, longitude: lon };
}

async function walk(cdp, page, fromMetres, seconds, speed = 3) {
  let metres = fromMetres;
  for (let i = 0; i < seconds; i += 1) {
    metres += speed;
    await cdp.send("Emulation.setGeolocationOverride", { ...along(metres), accuracy: 5 });
    await page.waitForTimeout(1000);
  }
  return metres;
}

export const flow = {
  id: "05-activity",
  title: "Activity: record a walk with a pause, detail, rename, GPX, share image, delete",
  async run(t, { standin, outDir }) {
    const page = await t.open({ permissions: ["geolocation"], geolocation: { ...START, accuracy: 5 } });
    const account = await standin.createAccount({ name: "Kavya Menon", tag: "activity" });
    await signInUi(t, account);
    const cdp = await t.context.newCDPSession(page);
    await cdp.send("Emulation.setGeolocationOverride", { ...START, accuracy: 5 });
    let activityId = null;

    await t.step("the recorder gets a location fix and starts a walk", async () => {
      await t.goto("/activity/record", { label: "activity recorder" });
      const walkButton = page.getByRole("group", { name: "Activity type" }).getByRole("button", { name: /walk/i });
      await walkButton.click();
      t.expect((await walkButton.getAttribute("aria-pressed")) === "true", "Walk should be selected");
      const allow = page.getByRole("button", { name: "Allow location" });
      if (await allow.isVisible().catch(() => false)) await allow.click();
      const start = page.getByRole("button", { name: /^Start walk/i });
      await start.waitFor({ timeout: 15000 });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll("button")].find((item) => /^Start walk/i.test(item.textContent?.trim() ?? ""));
        return button && !button.disabled;
      }, null, { timeout: 20000 });
      await t.checkpoint("recorder ready", { fullPage: false });
      await start.click();
      await page.getByRole("button", { name: "Pause" }).waitFor({ timeout: 15000 });
    });

    let metres = 0;
    await t.step("walk, pause, walk again", async () => {
      metres = await walk(cdp, page, metres, 35);
      const live = await textOf(page.getByRole("region", { name: "Live statistics" })).catch(() => "");
      t.note("live statistics before pausing", live);
      await t.checkpoint("recording", { fullPage: false, settle: false });
      await page.getByRole("button", { name: "Pause" }).click();
      await page.getByRole("button", { name: "Resume" }).waitFor({ timeout: 10000 });
      // Positions while paused must not add distance; the walk "jumps" ahead as if carried.
      metres = await walk(cdp, page, metres, 4, 3);
      const pausedStats = await textOf(page.getByRole("region", { name: "Live statistics" })).catch(() => "");
      t.note("live statistics while paused", pausedStats);
      await page.getByRole("button", { name: "Resume" }).click();
      await page.getByRole("button", { name: "Pause" }).waitFor({ timeout: 10000 });
      metres = await walk(cdp, page, metres, 15);
      t.note("metres fed", metres);
    });

    await t.step("finish and save the walk", async () => {
      await page.getByRole("button", { name: "Finish", exact: true }).first().click();
      const confirm = page.getByRole("alertdialog");
      await confirm.waitFor({ timeout: 10000 });
      await Promise.all([
        page.waitForURL(/\/activity\/[0-9a-f-]{36}/, { timeout: 30000 }),
        confirm.getByRole("button", { name: "Finish" }).click(),
      ]);
      activityId = /\/activity\/([0-9a-f-]{36})/.exec(page.url())[1];
      await t.settle();
      const row = await standin.one(`select sport, round(distance_m)::int distance_m, moving_seconds, elapsed_seconds, title,
          (select count(*) from public.activity_track_chunks c where c.activity_id = a.id)::int chunks from public.activities a where id = '${activityId}'`).catch(async () => standin.one(`select * from public.activities where id = '${activityId}'`));
      t.note("saved activity", row);
      t.expect(row && row.sport === "walk", "the walk should be saved to the account", row);
      t.expect(Number(row.distance_m) > 80, `the walk should have distance (${row.distance_m} m)`, row);
    });

    await t.step("the detail page shows the walk (map tiles may be missing while blocked)", async () => {
      const stats = await textOf(page.getByRole("region", { name: "Activity statistics" }));
      t.note("detail statistics", stats);
      t.expect(/km|m\b/.test(stats), "distance should be shown");
      const blockedTiles = t.blocked.filter((entry) => /openfreemap|tiles|maplibre|basemaps/i.test(entry.url));
      t.note("map requests blocked", [...new Set(blockedTiles.map((entry) => entry.url))].slice(0, 10));
      await t.checkpoint("activity detail");
    });

    await t.step("rename the activity", async () => {
      await page.getByRole("button", { name: "Rename activity" }).click();
      await page.getByLabel("Activity name").fill("Cubbon Park evening walk");
      await page.getByRole("button", { name: "Save name" }).click();
      await page.getByRole("heading", { name: "Cubbon Park evening walk" }).waitFor({ timeout: 10000 });
      const row = await standin.one(`select title from public.activities where id = '${activityId}'`);
      t.expect(row?.title === "Cubbon Park evening walk", "the new name should be saved", row);
    });

    await t.step("export the GPX file", async () => {
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: "GPX", exact: true }).click()]);
      const file = path.join(outDir, download.suggestedFilename());
      await download.saveAs(file);
      const gpx = readFileSync(file, "utf8");
      const points = (gpx.match(/<trkpt /g) ?? []).length;
      t.note("GPX", { file: path.basename(file), bytes: gpx.length, points, hasName: gpx.includes("Cubbon Park evening walk") });
      t.expect(gpx.includes("<gpx") && points > 5, `the GPX should hold the track (${points} points)`);
    });

    await t.step("download the share image", async () => {
      await page.getByRole("button", { name: "Share", exact: true }).click();
      const dialog = page.locator("[aria-labelledby=share-card-title]");
      await dialog.waitFor({ timeout: 10000 });
      const downloadButton = dialog.getByRole("button", { name: "Download image" });
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some((item) => /Download image/.test(item.textContent ?? "") && !item.disabled), null, { timeout: 20000 });
      await t.checkpoint("share card", { fullPage: false });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), downloadButton.click()]);
      const file = path.join(outDir, download.suggestedFilename());
      await download.saveAs(file);
      const bytes = statSync(file).size;
      const head = readFileSync(file).subarray(0, 4).toString("hex");
      t.note("share image", { file: path.basename(file), bytes, head });
      t.expect(bytes > 5000 && (head.startsWith("89504e47") || head.startsWith("ffd8")), "a real image should be downloaded", { bytes, head });
      await dialog.getByRole("button", { name: "Close" }).click();
    });

    await t.step("delete the activity", async () => {
      await page.getByRole("button", { name: "Delete activity" }).click();
      const confirm = page.getByRole("alertdialog");
      await confirm.waitFor();
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/activity", { timeout: 20000 }),
        confirm.getByRole("button", { name: "Delete" }).click(),
      ]);
      const row = await standin.one(`select (select count(*) from public.activities where id = '${activityId}')::int activities, (select count(*) from public.activity_track_chunks where activity_id = '${activityId}')::int chunks`);
      t.expect(row.activities === "0" && row.chunks === "0", "the activity and its GPS points should be deleted", row);
      await t.checkpoint("activity list after delete");
    });
  },
};
