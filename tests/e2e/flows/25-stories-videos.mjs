// Flow 25: Explore stories and short videos (wave 2, P14.4 and P14.3), with Chrome's fake camera. Mira shares a photo
// story (made smaller in the browser, private bucket); Theo, who follows her, finds it in the story tray, views it
// (the view is stored, her ring turns to seen) and Mira reads "Seen by 1" and who it was. While FITX has videos off
// (explore_video, the default) there is no video control anywhere and the links route answers 503. With videos on (in
// this local database only): a video made in the page with canvas and MediaRecorder is posted (stored as MP4, with a
// poster), Theo taps to play it (the server signs it within his daily budget) and Mira records a video story with the
// camera. Moving the stories' expires_at back ends them for Theo at once, and the hourly clean-up queues their files.
import { readFileSync } from "node:fs";
import path from "node:path";
import { signInUi } from "./common.mjs";
import { makePng } from "../support/png.mjs";

const tag = () => Math.random().toString(36).slice(2, 7);

async function settled(standin, query, ok, attempts = 24) {
  let row = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    row = await standin.one(query);
    if (ok(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return row;
}

async function switchTo(t, account, next = "/explore") {
  await t.context.clearCookies();
  await signInUi(t, account, { next, label: `sign in as ${account.name}` });
}

async function sawOverflow(t, name) {
  const entry = await t.checkpoint(name);
  t.expect(!entry.overflow?.overflow, `${name}: no sideways scroll`, entry.overflow);
}

/** Makes a short MP4 in the page: an animated canvas recorded by MediaRecorder (as a phone's own clip would be). */
async function makeClipInPage(page, ms = 2600) {
  return page.evaluate(async (length) => {
    const type = ["video/mp4;codecs=avc1,mp4a", "video/mp4;codecs=avc1", "video/mp4"].find((item) => MediaRecorder.isTypeSupported(item));
    if (!type) return { error: "MediaRecorder cannot write MP4 here" };
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 500_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    const started = performance.now();
    recorder.start(500);
    await new Promise((resolve) => {
      const draw = () => {
        const t = (performance.now() - started) / length;
        context.fillStyle = `hsl(${Math.round(t * 300)}, 60%, 40%)`;
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = "white";
        context.fillRect(40 + t * 480, 140, 80, 80);
        if (t >= 1) return resolve();
        requestAnimationFrame(draw);
      };
      draw();
    });
    recorder.stop();
    await done;
    const blob = new Blob(chunks, { type: "video/mp4" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { type, base64: btoa(binary) };
  }, ms);
}

const isMp4 = (bytes) => bytes.length > 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp";

export const flow = {
  id: "25-stories-videos",
  sizes: ["phone", "tablet", "desktop"],
  browser: { fakeMedia: true },
  title: "Explore stories and short videos: photo story, tray, viewer, views, expiry; video posts made in the browser, tap to play, camera stories; video controls only while videos are on",
  async run(t, { standin, outDir }) {
    const page = await t.open();
    const storageDir = path.join(path.dirname(outDir), "storage-files");
    const storedBytes = (name) => readFileSync(path.join(storageDir, encodeURIComponent("social-media"), encodeURIComponent(name)));
    const mira = await standin.createAccount({ name: "Mira Das", tag: "stories-mira" });
    const theo = await standin.createAccount({ name: "Theo Grant", tag: "stories-theo", profile: { gender: "male" } });
    const miraName = `mira_${tag()}`;
    const theoName = `theo_${tag()}`;
    // Profiles and the follow are set up directly: flow 21 covers making them in the app.
    await standin.sql(`insert into public.social_profiles (user_id, username, display_name) values ('${mira.id}', '${miraName}', 'Mira Das'), ('${theo.id}', '${theoName}', 'Theo Grant');
      insert into public.social_follows (user_id, following_id, status, accepted_at) values ('${theo.id}', '${mira.id}', 'accepted', now());`);
    await standin.sql(`update public.platform_settings set features = features - 'explore_video' where id = 1`);
    const caption = `Morning run done ${tag()}`;

    await t.step("Mira shares a photo story; with videos off there is no video choice", async () => {
      await switchTo(t, mira, "/explore/stories");
      const tray = page.getByRole("region", { name: "Stories" });
      await tray.waitFor({ timeout: 20000 });
      await page.getByText("Stories from people you follow show here for 24 hours.").waitFor({ timeout: 15000 });
      await sawOverflow(t, "empty tray");
      await tray.getByRole("link", { name: "New story" }).click();
      await page.getByRole("heading", { level: 1, name: "New story" }).waitFor({ timeout: 15000 });
      t.expect(await page.getByRole("button", { name: /^Video/ }).count() === 0, "no video choice while videos are off");
      await page.getByLabel("Add a photo").setInputFiles({ name: "run.png", mimeType: "image/png", buffer: makePng(1440, 2560, [30, 60, 90], [220, 120, 80]) });
      await page.getByRole("img", { name: "Your story photo" }).waitFor({ timeout: 20000 });
      await page.getByLabel("Caption (optional)").fill(caption);
      await sawOverflow(t, "story composer");
      await page.getByRole("button", { name: "Share story" }).click();
      await page.waitForURL(new RegExp(`/explore/stories/${miraName}$`), { timeout: 30000 });
      await page.getByRole("dialog", { name: `Story by ${miraName}` }).waitFor({ timeout: 15000 });
      const row = await settled(standin, `select kind, storage_path, width, height, caption, round(extract(epoch from expires_at - created_at))::int life from public.social_stories where user_id = '${mira.id}'`, (r) => Boolean(r));
      t.note("stored story", row);
      t.expect(row?.kind === "image" && row?.caption === caption, "the photo story is stored with its caption", row);
      t.expect(new RegExp(`^${mira.id}/[0-9a-f-]{36}/0\\.(webp|jpg)$`).test(row?.storage_path ?? ""), "the file is at <uid>/<story id>/0.webp|jpg", row);
      t.expect(Math.max(Number(row?.width), Number(row?.height)) === 1600, "made smaller in the browser (1,600 px long edge)", row);
      t.expect(Number(row?.life) === 86400, "it lives 24 hours", row);
      await sawOverflow(t, "own story viewer");
      await page.getByRole("button", { name: "Close story" }).first().click();
      await page.waitForURL((url) => url.pathname === "/explore", { timeout: 15000 });
    });

    await t.step("Theo finds Mira in the tray and views her story; the view is stored and her ring turns to seen", async () => {
      await switchTo(t, theo, "/explore/stories");
      const tray = page.getByRole("region", { name: "Stories" });
      await tray.getByRole("link", { name: `Story by ${miraName}, new` }).click({ timeout: 20000 });
      const viewer = page.getByRole("dialog", { name: `Story by ${miraName}` });
      await viewer.waitFor({ timeout: 15000 });
      await viewer.getByRole("img", { name: `Story: ${caption}` }).waitFor({ timeout: 15000 });
      await viewer.getByText(caption).first().waitFor();
      t.expect(await viewer.getByRole("button", { name: "Delete story" }).count() === 0, "no Delete on someone else's story");
      await viewer.getByRole("button", { name: "Like story" }).click();
      await sawOverflow(t, "story viewer");
      const view = await settled(standin, `select count(*)::int n, (select count(*)::int from public.social_story_likes l join public.social_stories s on s.id = l.story_id where s.user_id = '${mira.id}' and l.user_id = '${theo.id}') likes
        from public.social_story_views v join public.social_stories s on s.id = v.story_id where s.user_id = '${mira.id}' and v.user_id = '${theo.id}'`, (r) => Number(r?.n) === 1 && Number(r?.likes) === 1);
      t.expect(Number(view?.n) === 1 && Number(view?.likes) === 1, "the view and the like are stored once", view);
      await viewer.getByRole("button", { name: "Next story" }).first().click();
      await page.waitForURL((url) => url.pathname === "/explore/stories", { timeout: 15000 });
      await tray.getByRole("link", { name: `Story by ${miraName}` }).waitFor({ timeout: 15000 });
      t.expect(await tray.getByRole("link", { name: `Story by ${miraName}, new` }).count() === 0, "the ring shows it as seen");
    });

    await t.step("Mira reads \"Seen by 1\" and who viewed it", async () => {
      await switchTo(t, mira, `/explore/stories/${miraName}`);
      const viewer = page.getByRole("dialog", { name: `Story by ${miraName}` });
      await viewer.getByRole("button", { name: "Seen by 1" }).click({ timeout: 20000 });
      const sheet = page.getByRole("dialog", { name: "Seen by 1" });
      await sheet.getByRole("link", { name: new RegExp(theoName) }).waitFor({ timeout: 15000 });
      await sheet.getByText("Liked it").waitFor();
      await sawOverflow(t, "story viewers");
    });

    await t.step("videos off: the Videos tab and composer show the pause, and the links route answers 503", async () => {
      await t.goto("/explore/videos", { label: "videos paused" });
      await page.getByText("Videos are paused by FITX").first().waitFor({ timeout: 15000 });
      t.expect(await page.getByRole("link", { name: "New video" }).count() === 0, "no New video link while paused");
      await sawOverflow(t, "videos paused");
      await t.goto("/explore/videos/new", { label: "video composer paused" });
      await page.getByRole("heading", { name: "Videos are paused by FITX" }).waitFor({ timeout: 15000 });
      t.expect(await page.getByLabel("Choose a video").count() === 0, "no video picker while paused");
      const status = await page.evaluate(async (paths) => (await fetch("/api/social/video-links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paths }) })).status, [`${mira.id}/${mira.id}/0.mp4`]);
      t.expect(status === 503, "the links route answers 503 with videos off", status);
    });

    await standin.sql(`update public.platform_settings set features = features || '{"explore_video": true}'::jsonb where id = 1`);
    try {
      let postId = null;
      await t.step("Mira posts a video made in the page; it is stored as an MP4 with a poster", async () => {
        await t.goto("/explore/videos/new", { label: "video composer" });
        await page.getByRole("heading", { level: 1, name: "New video" }).waitFor({ timeout: 15000 });
        const clip = await makeClipInPage(page);
        t.expect(!clip.error, "the page can record MP4", clip.error);
        const bytes = Buffer.from(clip.base64, "base64");
        t.note("clip made in the page", { type: clip.type, bytes: bytes.length });
        t.expect(isMp4(bytes), "MediaRecorder wrote an MP4 (ftyp first)");
        await page.getByLabel("Choose a video").setInputFiles({ name: "jumps.mp4", mimeType: "video/mp4", buffer: bytes });
        const ready = page.getByRole("button", { name: "Choose another" });
        const prepare = page.getByRole("button", { name: "Prepare video" });
        await Promise.race([page.getByLabel("Your video").waitFor({ timeout: 30000 }), prepare.waitFor({ timeout: 30000 })]);
        if (await prepare.count()) {
          t.note("the clip was shortened in the browser");
          await prepare.click();
        }
        await page.getByLabel("Your video").waitFor({ timeout: 60000 });
        await ready.waitFor();
        await page.getByLabel("Caption").fill("Box jumps #Plyo");
        await sawOverflow(t, "video composer");
        await page.getByRole("button", { name: "Share video" }).click();
        await page.waitForURL(/\/explore\/videos\?v=[0-9a-f-]{36}$/, { timeout: 30000 });
        postId = new URL(page.url()).searchParams.get("v");
        const media = await settled(standin, `select p.kind, m.kind media_kind, m.storage_path, m.poster_path, m.duration_ms, m.width, m.height,
            (select metadata->>'mimetype' from storage.objects o where o.bucket_id = 'social-media' and o.name = m.storage_path) video_type,
            (select metadata->>'mimetype' from storage.objects o where o.bucket_id = 'social-media' and o.name = m.poster_path) poster_type
          from public.social_posts p join public.social_post_media m on m.post_id = p.id where p.id = '${postId}'`, (r) => Boolean(r?.video_type));
        t.note("stored video", media);
        t.expect(media?.kind === "video" && media?.media_kind === "video", "a video post with one video item", media);
        t.expect(media?.storage_path === `${mira.id}/${postId}/0.mp4` && media?.poster_path === `${mira.id}/${postId}/0p.webp`, "files at …/0.mp4 and …/0p.webp", media);
        t.expect(media?.video_type === "video/mp4" && /^image\/(webp|jpeg)$/.test(media?.poster_type ?? ""), "the bucket holds an MP4 and a poster", media);
        t.expect(Number(media?.duration_ms) >= 1000 && Number(media?.duration_ms) <= 30000, "its length is stored", media);
        t.expect(isMp4(storedBytes(media.storage_path)), "the stored file is an MP4");
        await page.locator(`[data-post-video="${postId}"]`).waitFor({ timeout: 15000 });
        await sawOverflow(t, "videos tab with own video");
      });

      await t.step("Theo taps play: the server signs the video within his budget and it plays, muted until he turns the sound on", async () => {
        await switchTo(t, theo, "/explore/videos");
        const card = page.locator("article").filter({ hasText: "Box jumps" }).first();
        await card.waitFor({ timeout: 20000 });
        const [response] = await Promise.all([
          page.waitForResponse((r) => r.url().includes("/api/social/video-links"), { timeout: 20000 }),
          card.getByRole("button", { name: "Play video" }).click(),
        ]);
        t.expect(response.status() === 200, "the links route signed it", response.status());
        await card.getByRole("button", { name: "Pause video" }).waitFor({ timeout: 20000 });
        const played = await card.locator("video").evaluate((video) => new Promise((resolve) => {
          const until = performance.now() + 15000;
          const check = () => (video.currentTime > 0.2 || performance.now() > until ? resolve({ time: video.currentTime, muted: video.muted }) : setTimeout(check, 100));
          check();
        }));
        t.note("playback", played);
        t.expect(played.time > 0.2, "the video plays", played);
        t.expect(played.muted === true, "it plays muted", played);
        await card.getByRole("button", { name: "Sound" }).click();
        t.expect(await card.getByRole("button", { name: "Sound" }).getAttribute("aria-pressed") === "true", "the sound turns on");
        const budget = await settled(standin, `select coalesce(sum(hits), 0)::int bytes from public.social_rate_counters where user_id = '${theo.id}' and action = 'video_bytes:day'`, (r) => Number(r?.bytes) > 0);
        t.expect(Number(budget?.bytes) > 0, "the play is counted against the daily budget", budget);
        await sawOverflow(t, "video playing");
      });

      await t.step("Mira records a video story with the camera", async () => {
        await switchTo(t, mira, "/explore/stories/new");
        await page.getByRole("heading", { level: 1, name: "New story" }).waitFor({ timeout: 15000 });
        await page.getByRole("button", { name: /^Video/ }).click();
        await page.getByRole("button", { name: /Record with the camera/ }).click();
        await page.getByLabel("Camera preview").waitFor({ timeout: 15000 });
        await page.getByRole("button", { name: "Start recording" }).click();
        await page.waitForTimeout(2600);
        await sawOverflow(t, "recording a story");
        await page.getByRole("button", { name: "Stop recording" }).click();
        await page.getByLabel("Your video").waitFor({ timeout: 30000 });
        await page.getByRole("button", { name: "Share story" }).click();
        await page.waitForURL(new RegExp(`/explore/stories/${miraName}$`), { timeout: 30000 });
        const row = await settled(standin, `select kind, storage_path, poster_path, duration_ms from public.social_stories where user_id = '${mira.id}' and kind = 'video'`, (r) => Boolean(r));
        t.note("stored video story", row);
        t.expect(row?.kind === "video" && Number(row?.duration_ms) >= 1000 && Number(row?.duration_ms) <= 15000, "a video story of up to 15 s", row);
        t.expect(isMp4(storedBytes(row.storage_path)), "the camera clip is stored as an MP4");
        await page.getByRole("dialog", { name: `Story by ${miraName}` }).waitFor({ timeout: 15000 });
      });
    } finally {
      await standin.sql(`update public.platform_settings set features = features - 'explore_video' where id = 1`);
    }

    await t.step("ended stories are gone for Theo at once; the hourly clean-up queues their files", async () => {
      await standin.sql(`update public.social_stories set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' where user_id = '${mira.id}'`);
      await switchTo(t, theo, "/explore/stories");
      await page.getByRole("region", { name: "Stories" }).waitFor({ timeout: 20000 });
      await page.getByText("Stories from people you follow show here for 24 hours.").waitFor({ timeout: 15000 });
      t.expect(await page.getByRole("link", { name: new RegExp(`Story by ${miraName}`) }).count() === 0, "no ended story in the tray");
      await t.goto(`/explore/stories/${miraName}`, { label: "ended story" });
      await page.getByRole("heading", { name: "No stories right now" }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "ended story");
      await standin.sql("select public.fitx_social_hourly()");
      const left = await standin.one(`select (select count(*)::int from public.social_stories where user_id = '${mira.id}') stories,
        (select count(*)::int from public.social_storage_trash where path like '${mira.id}/%' and reason = 'story_expired') queued`);
      t.expect(Number(left?.stories) === 0 && Number(left?.queued) >= 1, "the stories are deleted and their files queued for the sweep", left);
    });

    await t.step("with videos off again, the video shows its poster and no play control", async () => {
      await t.goto("/explore/videos", { label: "videos paused again" });
      const card = page.locator("article").filter({ hasText: "Box jumps" }).first();
      await card.waitFor({ timeout: 20000 });
      await card.getByText("Videos are paused by FITX").waitFor();
      t.expect(await card.getByRole("button", { name: "Play video" }).count() === 0, "no play control while paused");
      await sawOverflow(t, "videos paused with a video");
    });
  },
};
