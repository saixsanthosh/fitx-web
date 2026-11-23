// Flow 28: Explore moderation as members meet it. FITX's actions come from Admin's database functions
// (fitx_admin_op_moderate, 20261124100020), run here as an operator of the local database. Ben posts a photo and Asha
// reports it; once FITX hides it, Asha no longer sees it and hears FITX reviewed her report, while Ben still sees it
// marked "Hidden by FITX". A warning reaches Ben as a notice in the app; a suspension shows him why and keeps Explore
// settings open; with Explore switched off in Admin, /explore lands on the paused page with a link to manage or delete
// his content, and /explore/settings still opens.
import { signInUi } from "./common.mjs";
import { makePng } from "../support/png.mjs";

const tag = () => Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads `query` until `ok(row)` holds, at most about 5 s. */
async function settled(standin, query, ok) {
  let row = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    row = await standin.one(query);
    if (ok(row)) return row;
    await sleep(250);
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

/**
 * The app reads platform settings at most once a minute per server (src/lib/platform/gate.ts), so after a switch
 * changes, /explore needs up to a minute to follow. Reloads until the paused page shows (closed) or not (open).
 */
async function waitForGate(t, closed) {
  const page = t.page;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    await t.goto("/explore", { label: closed ? "explore switched off" : "explore switched on again" });
    const paused = (await page.getByText("Back soon. Your data is safe.").count()) > 0;
    if (paused === closed) return attempt;
    await sleep(5000);
  }
  throw new Error(`the platform gate did not ${closed ? "close" : "reopen"} /explore within 90 s`);
}

export const flow = {
  id: "28-explore-moderation",
  sizes: ["phone", "tablet", "desktop"],
  title: "Explore moderation: a hidden post for others and its owner, the reporter told, a warning, a suspension, Explore switched off",
  async run(t, { standin }) {
    const page = await t.open();
    const ben = await standin.createAccount({ name: "Ben Moderated", tag: "mod-ben", profile: { gender: "male" } });
    const asha = await standin.createAccount({ name: "Asha Reporter", tag: "mod-asha" });
    const benName = `ben_${tag()}`;
    const ashaName = `asha_${tag()}`;
    await standin.sql(`insert into public.social_profiles (user_id, username, display_name) values
      ('${ben.id}', '${benName}', 'Ben Moderated'), ('${asha.id}', '${ashaName}', 'Asha Reporter')`);
    // An operator who may moderate (admin role), made the way Admin makes operators.
    const operator = await standin.one(`select public.fitx_admin_op_create_operator(public.fitx_admin_op_root_sign_in('e2e-owner'),
      'e2e-mod-${tag()}', 'admin', 'scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:${"M".repeat(86)}')::text as id`);
    /** Runs fitx_admin_op_moderate as the operator; `args` are the SQL arguments after the operator id. */
    const moderate = (args) => standin.one(`select public.fitx_admin_op_moderate('${operator.id}', ${args})::text as result`);
    let postId = null;
    let reportId = null;

    await t.step("Ben posts a photo and Asha reports it", async () => {
      await switchTo(t, ben);
      // An earlier flow may have switched Explore off a moment ago: wait until the app's cached settings follow.
      await waitForGate(t, false);
      await t.goto("/explore/new", { label: "composer" });
      await page.getByRole("heading", { level: 1, name: "New post" }).waitFor({ timeout: 20000 });
      await page.getByLabel("Add photos").setInputFiles([{ name: "plank.png", mimeType: "image/png", buffer: makePng(1200, 900) }]);
      await page.getByRole("img", { name: "Photo 1" }).waitFor({ timeout: 20000 });
      await page.getByLabel("Caption").fill("Plank hold, day 12");
      await page.getByRole("button", { name: "Share post" }).click();
      await page.waitForURL(/\/explore\/p\/[0-9a-f-]{36}$/, { timeout: 30000 });
      postId = page.url().split("/").pop();
      // Asha's report, as fitx_social_report stores it (the report flow itself is flow 21's).
      const report = await standin.one(`insert into public.social_reports (user_id, target_type, target_id, target_user_id, reason, evidence)
        values ('${asha.id}', 'post', '${postId}', '${ben.id}', 'spam', jsonb_build_object('caption', 'Plank hold, day 12', 'author', '${benName}'))
        returning id::text as id`);
      reportId = report.id;
      await switchTo(t, asha, `/explore/p/${postId}`);
      await page.locator("article").filter({ hasText: "Plank hold, day 12" }).first().waitFor({ timeout: 20000 });
    });

    await t.step("FITX hides it: gone for Asha, who hears FITX reviewed her report", async () => {
      const result = JSON.parse((await moderate(`'${reportId}', 'hide', 'spam', 'Looks like spam'`)).result);
      t.note("moderation result", result);
      t.expect(result.status === "actioned" && result.report_ids.length === 1, "the report closes as actioned", result);
      await t.goto(`/explore/p/${postId}`, { label: "hidden post as asha" });
      await page.getByRole("heading", { name: "Post not available" }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "hidden post for others");
      await t.goto("/explore/notifications", { label: "asha notifications" });
      await page.getByText("FITX reviewed your report. Thank you for helping keep Explore safe.").first().waitFor({ timeout: 15000 });
      await sawOverflow(t, "report reviewed notice");
    });

    await t.step("Ben still sees his post, marked Hidden by FITX", async () => {
      await switchTo(t, ben, `/explore/p/${postId}`);
      // Open the page again so the screenshot shows it rather than the sign-in reveal on top of it.
      await t.goto(`/explore/p/${postId}`, { label: "hidden post as its owner" });
      const post = page.locator("article").filter({ hasText: "Plank hold, day 12" }).first();
      await post.waitFor({ timeout: 20000 });
      await post.getByText("Hidden by FITX").waitFor({ timeout: 15000 });
      await sawOverflow(t, "hidden post for its owner");
    });

    await t.step("a warning from FITX reaches Ben as a notice in the app", async () => {
      await moderate(`null, 'warn', 'harassment', null, null, 'explore', '${ben.id}'`);
      const notice = await settled(standin, `select title, tone from public.member_notifications where user_id = '${ben.id}' and dismissed_at is null order by created_at desc limit 1`, (r) => Boolean(r));
      t.expect(notice?.tone === "warning", "the warning is stored as a warning notice", notice);
      await t.goto("/dashboard", { label: "warning banner" });
      await page.getByText("A warning from FITX about Explore").first().waitFor({ timeout: 20000 });
      await page.getByText(/broke the Explore rules \(bullying or harassment\)/).first().waitFor();
      await sawOverflow(t, "warning banner");
    });

    await t.step("a suspension shows Ben why, and Explore settings stay open", async () => {
      await moderate(`null, 'suspend', 'spam', null, now() + interval '7 days', 'explore', '${ben.id}'`);
      try {
        await t.goto("/explore", { label: "suspended" });
        await page.getByRole("heading", { name: "Your Explore account is paused" }).waitFor({ timeout: 20000 });
        await page.getByText(/FITX has paused your Explore account until \d{1,2} \w+ \d{4}\./).waitFor();
        await sawOverflow(t, "suspended");
        await page.getByRole("link", { name: "Manage or delete my Explore content" }).click();
        await page.getByRole("heading", { name: "Your Explore content" }).waitFor({ timeout: 15000 });
        await sawOverflow(t, "suspended settings");
      } finally {
        await moderate(`null, 'lift', null, null, null, 'explore', '${ben.id}'`);
      }
      const active = await standin.one(`select count(*)::int as n from public.social_member_sanctions where user_id = '${ben.id}' and lifted_at is null`);
      t.expect(Number(active?.n) === 0, "the suspension is lifted", active);
    });

    await t.step("with Explore switched off, /explore is paused with the content link, and settings still open", async () => {
      await standin.sql(`update public.platform_settings set features = features || '{"explore": false}'::jsonb where id = 1`);
      try {
        const tries = await waitForGate(t, true);
        t.note("reloads until the gate closed", tries);
        await page.getByRole("heading", { level: 1, name: "Explore is paused" }).waitFor({ timeout: 10000 });
        t.expect(new URL(page.url()).pathname === "/explore", "the address stays /explore (the page is rewritten)", page.url());
        await sawOverflow(t, "explore switched off");
        await page.getByRole("link", { name: "Manage or delete my Explore content" }).click();
        await page.waitForURL(/\/explore\/settings$/, { timeout: 15000 });
        await page.getByRole("heading", { level: 1, name: "Explore settings" }).waitFor({ timeout: 15000 });
        await page.getByRole("heading", { name: "Your Explore content" }).waitFor({ timeout: 15000 });
        await sawOverflow(t, "settings while switched off");
      } finally {
        await standin.sql(`update public.platform_settings set features = features - 'explore' where id = 1`);
        // Later flows meet Explore open again.
        await waitForGate(t, false).catch((error) => t.note("gate still closed at the end", String(error.message)));
      }
    });
  },
};
