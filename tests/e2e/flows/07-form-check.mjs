// Flow 7: AI Form Check (formerly Home workout, and before that Form coach). The page states its promises (on-device,
// automatic framing, not medical advice) and offers at least twenty exercises, filterable by body area; an exercise opens
// with its photo demonstration, whose captions follow its steps and which can be paused, replayed, looped and stepped
// through; the coach voice can be Female, Male or Off and is remembered; starting the camera without permission ends in an
// honest explanation; both old addresses (/home-workout and /form-coach) land on the same exercise here; and with a camera
// (a stand-in stream showing a real exercise photo, small in the picture) the live view reports the camera's true
// resolution, zooms in on the person automatically, and has no animated "You" figure.
import { signInUi, textOf } from "./common.mjs";

/** Replaces the camera with a 1280 × 720 stream of a squat photo, small and off-centre, as a far-away member would be. */
function fakeCamera() {
  const devices = navigator.mediaDevices;
  if (!devices) return;
  devices.getUserMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    const photo = new Image();
    photo.src = "/media/home-workout-1/squat.webp";
    await photo.decode().catch(() => undefined);
    const draw = () => {
      context.fillStyle = "rgb(34, 36, 34)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(photo, 560, 250, 360, 463);
    };
    draw();
    window.setInterval(draw, 40);
    return canvas.captureStream(25);
  };
  devices.enumerateDevices = async () => [{ kind: "videoinput", deviceId: "stand-in", groupId: "stand-in", label: "Stand-in camera", toJSON() { return this; } }];
  // The browser itself was never asked, so its permission answer for the camera is "granted" for this stand-in.
  const query = navigator.permissions?.query?.bind(navigator.permissions);
  if (query) navigator.permissions.query = (descriptor) => (descriptor?.name === "camera" ? Promise.resolve({ state: "granted", onchange: null }) : query(descriptor));
}

export const flow = {
  id: "07-form-check",
  title: "AI Form Check: exercises, photo demonstration with captions, voice, camera permission, old addresses and automatic framing",
  async run(t, { standin, size }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Dev Patel", tag: "formcheck" });
    await signInUi(t, account);

    await t.step("the page explains what the camera does and offers the exercises", async () => {
      await t.goto("/workouts/form-check", { label: "ai form check" });
      t.expect(new URL(page.url()).pathname === "/workouts/form-check", `AI Form Check should open at /workouts/form-check (${page.url()})`);
      const title = await page.locator("main h1").first().innerText();
      t.expect(title.trim() === "AI Form Check", `the page title should be AI Form Check (got ${title})`);
      const facts = await textOf(page.locator("section[aria-label='How AI Form Check works']"));
      t.note("explainer", facts);
      t.expect(/Stays on your device/.test(facts) && /never uploaded/.test(facts), "the on-device promise should be stated");
      t.expect(/frames you automatically/.test(facts), "the automatic framing should be mentioned");
      t.expect(/Not medical advice/.test(facts), "the medical disclaimer should be stated");
      const choices = page.locator("section[aria-labelledby=coach-pick-title] a");
      const total = await choices.count();
      t.expect(total >= 20, `at least twenty exercises should be offered (got ${total})`);
      t.expect((await page.getByText(/^You$/).count()) === 0, "no animated You figure anywhere on the page");
      await t.checkpoint("ai form check picker");
    });

    await t.step("the exercises filter by body area", async () => {
      const choices = page.locator("section[aria-labelledby=coach-pick-title] a");
      const total = await choices.count();
      await page.getByRole("radiogroup", { name: "Show exercises for" }).getByRole("radio", { name: "Core" }).click();
      const core = await choices.count();
      const names = await choices.allInnerTexts();
      t.note("core exercises", names.join(" | ").replace(/\s+/g, " "));
      t.expect(core >= 3 && core < total, `Core should show a few of the exercises (${core} of ${total})`);
      t.expect(names.some((name) => /Plank/.test(name)), "Core should include the plank", names);
      await page.getByRole("radio", { name: "All" }).click();
      t.expect((await choices.count()) === total, "All should show every exercise again");
    });

    await t.step("an exercise opens its photo demonstration, with captions that follow its steps", async () => {
      await t.goto("/workouts/form-check?exercise=bodyweight_squat", { label: "squat" });
      await page.getByText("Set up your camera").waitFor();
      const demo = page.getByRole("figure", { name: "How to do a bodyweight squat" });
      t.expect((await demo.count()) === 1, "the squat should open with its demonstration");
      t.expect((await demo.getByRole("img").count()) === 2, "the squat demonstration shows both ends of the movement");
      const loop = demo.getByRole("button", { name: "Loop demonstration" });
      t.expect((await loop.getAttribute("aria-pressed")) === "true", "the demonstration loops by default");
      await loop.click();
      t.expect((await loop.getAttribute("aria-pressed")) === "false", "looping can be switched off");
      await loop.click();
      t.expect((await demo.getByRole("button", { name: "Replay demonstration" }).count()) === 1, "it can be replayed");
      const play = demo.getByRole("button", { name: /^(Pause|Play) demonstration$/ });
      t.expect((await play.count()) === 1, "it can be paused and played");
      if (/Pause/.test((await play.getAttribute("aria-label")) ?? "")) await play.click();
      await demo.getByRole("button", { name: /^Show step 3:/ }).click();
      const caption = await textOf(demo.locator("figcaption"));
      t.note("step 3 caption", caption);
      t.expect(/Thighs towards level/.test(caption), `step 3's caption should show (got ${caption})`);
      await demo.getByRole("button", { name: /^Show step 1:/ }).click();
      t.expect(/Stand tall/.test(await textOf(demo.locator("figcaption"))), "step 1's caption should show");
      const setup = await textOf(page.locator("main"));
      t.expect(/video is never uploaded or recorded/.test(setup), "the set-up should repeat the privacy promise");
      t.expect(/not medical advice/i.test(setup), "the set-up should say it is not medical advice");
      t.expect(/zooms and follows you/.test(setup), "the set-up should say the camera frames the member automatically");
      await t.checkpoint("exercise demonstration and set-up");
    });

    await t.step("the coach voice is Female, Male or Off, and is remembered", async () => {
      const voice = page.getByRole("radiogroup", { name: "Coach voice" });
      if ((await voice.count()) === 0) {
        t.note("coach voice", "this browser has no speech synthesis, so the voice choice is not shown");
        return;
      }
      for (const name of ["Female", "Male", "Off"]) t.expect((await voice.getByRole("radio", { name, exact: true }).count()) === 1, `the voice choice should offer ${name}`);
      await voice.getByRole("radio", { name: "Male", exact: true }).click();
      t.expect((await voice.getByRole("radio", { name: "Male", exact: true }).getAttribute("aria-checked")) === "true", "Male should be chosen");
      await page.reload();
      await page.getByText("Set up your camera").waitFor();
      const after = page.getByRole("radiogroup", { name: "Coach voice" }).getByRole("radio", { name: "Male", exact: true });
      t.expect((await after.getAttribute("aria-checked")) === "true", "the Male voice should be remembered after a reload");
    });

    await t.step("starting the camera without permission explains what to do", async () => {
      await page.getByRole("button", { name: "Start camera" }).click();
      const retry = page.getByRole("button", { name: "Try again" });
      await retry.waitFor({ timeout: 15000 });
      const help = await textOf(page.locator("main"));
      t.note("camera problem text", help.slice(0, 900));
      await t.checkpoint("camera blocked explanation");
    });

    await t.step("an exercise without a correct photo shows its captions, not a wrong picture", async () => {
      await t.goto("/workouts/form-check?exercise=lateral_raise", { label: "lateral raise" });
      await page.getByText("Set up your camera").waitFor();
      const demo = page.getByRole("figure", { name: "How to do a lateral raise" });
      t.expect((await demo.count()) === 1, "the lateral raise should have its demonstration");
      t.expect((await demo.getByRole("img").count()) === 0, "no photo is shown for it yet");
      t.expect(/Weights by your sides/.test(await textOf(demo.locator("figcaption"))), "its first caption shows");
      await t.checkpoint("lateral raise set-up");
    });

    await t.step("both old addresses open the same exercise in AI Form Check", async () => {
      for (const [from, exercise] of [["/home-workout?exercise=wall_sit", "wall_sit"], ["/form-coach?exercise=bodyweight_squat", "bodyweight_squat"]]) {
        const response = await t.goto(from, { label: `old address ${from}` });
        const url = new URL(page.url());
        t.expect(url.pathname === "/workouts/form-check" && url.searchParams.get("exercise") === exercise, `expected /workouts/form-check?exercise=${exercise} from ${from}, got ${url.pathname}${url.search}`);
        t.expect(response && response.status() < 400, `the redirected page answered ${response?.status()}`);
        await page.getByText("Set up your camera").waitFor();
      }
      await t.checkpoint("old address in ai form check");
    });

    await t.step("with a camera, the live view reports its real resolution, zooms in on a far-away member, and has no You figure", async () => {
      await page.addInitScript(fakeCamera);
      await t.goto("/workouts/form-check?exercise=bodyweight_squat", { label: "live view" });
      await page.getByRole("button", { name: "Start camera" }).click();
      const live = page.getByRole("dialog", { name: "Bodyweight squat" });
      await live.waitFor({ timeout: 15000 });
      t.expect((await live.getByText(/^You$/).count()) === 0, "the live view has no animated You figure");
      t.expect((await live.getByRole("figure", { name: "How to do a bodyweight squat" }).count()) === 1, "the live view shows the demonstration");
      // The pose model loads (about 20 MB, from FITX itself) and runs on the CPU in this browser: give it time.
      const zoom = await page.waitForFunction(() => {
        const layer = document.querySelector("[role=dialog] video")?.parentElement;
        const match = /scale\(([\d.]+)\)/.exec(layer?.style.transform ?? "");
        return match && Number(match[1]) > 0 ? Number(match[1]) : false;
      }, undefined, { timeout: 90000, polling: 500 }).then((handle) => handle.jsonValue()).catch(() => null);
      const status = await textOf(live.locator("header [role=status]")).catch(() => "(no status)");
      t.note("live status", status);
      t.expect(zoom !== null, "the framing should place the camera picture");
      // Fitting the whole picture is the base scale; once the member is found it zooms past it.
      const zoomed = await page.waitForFunction(() => {
        const viewport = document.querySelector("[role=dialog] video")?.parentElement?.parentElement;
        const layer = viewport?.firstElementChild;
        const scale = Number(/scale\(([\d.]+)\)/.exec(layer?.style.transform ?? "")?.[1] ?? 0);
        const base = layer ? Math.min(viewport.clientWidth / layer.clientWidth, viewport.clientHeight / layer.clientHeight) : 0;
        return base > 0 && scale > base * 1.15 ? scale / base : false;
      }, undefined, { timeout: 90000, polling: 500 }).then((handle) => handle.jsonValue()).catch(() => null);
      t.note("automatic zoom", zoomed === null ? "none" : `${Number(zoomed).toFixed(2)}x`);
      t.expect(zoomed !== null, `the far-away member should be zoomed in on (status: ${status})`);
      if (size === "desktop") t.expect((await live.getByText("720p").count()) >= 1, "the camera's real picture size (720p) should be shown");
      await t.checkpoint("live view auto-framed", { fullPage: false });
      await live.getByRole("button", { name: "Finish" }).click();
      await page.getByRole("button", { name: "Another set" }).waitFor({ timeout: 10000 });
      await t.checkpoint("set result after the live view");
    });
  },
};
