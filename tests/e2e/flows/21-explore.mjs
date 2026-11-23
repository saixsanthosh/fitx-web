// Flow 21: Explore with two members. Ben makes a private profile and posts two photos (made smaller in the browser,
// uploaded to the private social-media bucket); Asha makes a public profile, finds Ben by search, asks to follow and
// sees nothing until Ben accepts from his notifications. Then Asha sees the post in her feed, likes, saves and
// comments; Ben sees those notifications, replies, edits his caption, posts and deletes a second post (its photos
// leave the bucket); Asha finds the hashtag, reports the post, blocks Ben (follows end, his profile is hidden) and
// unblocks him from Explore settings. /social now leads to /explore. Wave 2 (20261124100000): Ben blocks Asha and still
// reports her account; a suspended Asha reads why and reaches her settings; Chen, whom FITX has no date of birth for,
// adds it in Explore settings; with Explore switched off in Admin, Ben still deletes his own post from Explore settings.
// Release 2a: the rail shows Feed, Discover, Community and Messages (Videos only while FITX has videos on), the story
// tray sits above the feed, and "New post" opens the create menu (Photo post and Story; Video only while videos are on).
import { signInUi, textOf } from "./common.mjs";
import { makePng } from "../support/png.mjs";

const tag = () => Math.random().toString(36).slice(2, 7);

/** Reads `query` until `ok(row)` holds (the stand-in may take a moment to show a write), at most about 5 s. */
async function settled(standin, query, ok) {
  let row = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    row = await standin.one(query);
    if (ok(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return row;
}

async function switchTo(t, account) {
  await t.context.clearCookies();
  await signInUi(t, account, { next: "/explore", label: `sign in as ${account.name}` });
}

async function setUpProfile(t, username, { isPrivate }) {
  const page = t.page;
  await page.getByRole("heading", { name: "Your Explore profile" }).waitFor({ timeout: 20000 });
  await page.getByLabel("Username").fill(username);
  await page.getByText(`@${username} is free.`).waitFor({ timeout: 15000 });
  if (isPrivate) await page.getByRole("switch", { name: "Private account" }).click();
  await page.getByRole("button", { name: "Create profile" }).click();
  await page.getByRole("navigation", { name: "Explore" }).waitFor({ timeout: 15000 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After Explore is switched back on, the app keeps its platform settings for up to 60 s, so /explore can still show
 * the paused page for a while: reload every 5 s, at most 90 s, until it is gone (as flow 28's waitForGate does), so the
 * next step and the next size start on an open Explore.
 */
async function waitForExploreOpen(t) {
  const page = t.page;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    await t.goto("/explore", { label: "explore switched on again" });
    if ((await page.getByText("Back soon. Your data is safe.").count()) === 0) return attempt;
    await sleep(5000);
  }
  throw new Error("the platform gate did not reopen /explore within 90 s");
}

async function sawOverflow(t, name) {
  const entry = await t.checkpoint(name);
  t.expect(!entry.overflow?.overflow, `${name}: no sideways scroll`, entry.overflow);
}

export const flow = {
  id: "21-explore",
  sizes: ["phone", "tablet", "desktop"],
  title: "Explore: profiles, private follow approval, photo posts, likes, comments, saves, edits, deletes, search, reports, blocks, notifications",
  async run(t, { standin, size }) {
    const page = await t.open();
    const ben = await standin.createAccount({ name: "Ben Okafor", tag: "explore-ben", profile: { gender: "male" } });
    const asha = await standin.createAccount({ name: "Asha Rao", tag: "explore-asha" });
    const benName = `ben_${tag()}`;
    const ashaName = `asha.${tag()}`;
    let postId = null;

    await t.step("/social leads to Explore, which asks for a profile first", async () => {
      await signInUi(t, ben);
      await t.goto("/social", { label: "social redirect" });
      t.expect(new URL(page.url()).pathname === "/explore", "the old Social page redirects to /explore", page.url());
      await page.getByRole("heading", { name: "Your Explore profile" }).waitFor({ timeout: 20000 });
      const suggested = await page.getByLabel("Username").inputValue();
      t.expect(suggested === "ben.okafor", "a username is suggested from the name", suggested);
      await sawOverflow(t, "explore setup");
      await page.getByLabel("Username").fill("ad");
      await page.getByText("At least 3 characters.").waitFor();
      t.expect(await page.getByRole("button", { name: "Create profile" }).isDisabled(), "an invalid username cannot be saved");
      await setUpProfile(t, benName, { isPrivate: true });
      const row = await settled(standin, `select username, is_private::text is_private from public.social_profiles where user_id = '${ben.id}'`, (r) => r?.username === benName);
      t.expect(row?.username === benName && row?.is_private === "true", "the private profile is stored", row);
      await page.getByRole("heading", { name: "Your feed is quiet" }).waitFor({ timeout: 15000 });
      // The story tray sits above the feed (FEED_TOP_SLOT), with "New story" first.
      const tray = page.getByRole("region", { name: "Stories" });
      await tray.getByRole("link", { name: "New story" }).waitFor({ timeout: 15000 });
      const nav = page.getByRole("navigation", { name: "Explore" });
      for (const name of ["Feed", "Discover", "Community", "Messages"]) await nav.getByRole("link", { name, exact: true }).waitFor({ timeout: 10000 });
      t.expect(await nav.getByRole("link", { name: "Videos", exact: true }).count() === 0, "no Videos tab while FITX has videos off");
      await sawOverflow(t, "empty feed");
    });

    await t.step("Ben posts two photos with a caption, hashtag, place and topic", async () => {
      await page.getByRole("button", { name: "New post" }).first().click();
      const menu = page.getByRole("menu", { name: "Create" });
      await menu.getByRole("menuitem", { name: /Photo post/ }).waitFor({ timeout: 10000 });
      await menu.getByRole("menuitem", { name: /Story/ }).waitFor();
      t.expect(await menu.getByRole("menuitem", { name: /Video/ }).count() === 0, "no Video in the create menu while videos are off");
      await menu.getByRole("menuitem", { name: /Photo post/ }).click();
      await page.getByRole("heading", { level: 1, name: "New post" }).waitFor({ timeout: 15000 });
      await page.getByLabel("Add photos").setInputFiles([
        { name: "squat.png", mimeType: "image/png", buffer: makePng(2400, 1800) },
        { name: "rack.png", mimeType: "image/png", buffer: makePng(900, 1200, [40, 90, 70], [200, 220, 190]) },
      ]);
      await page.getByRole("img", { name: "Photo 2" }).waitFor({ timeout: 20000 });
      await page.getByLabel("Caption").fill("Leg day done #LegDay");
      await page.getByLabel("Place (optional)").fill("Pune");
      await page.getByRole("button", { name: "Gym workouts" }).click();
      await sawOverflow(t, "composer");
      await page.getByRole("button", { name: "Share post" }).click();
      await page.waitForURL(/\/explore\/p\/[0-9a-f-]{36}$/, { timeout: 30000 });
      postId = page.url().split("/").pop();
      const media = await standin.sql(`select storage_path, width, height, bytes from public.social_post_media where post_id = '${postId}' order by position`);
      t.note("stored photos", media);
      t.expect(media.length === 2, "both photos are stored", media);
      t.expect(Math.max(Number(media[0].width), Number(media[0].height)) === 1600, "the long edge was made 1,600 px in the browser", media[0]);
      t.expect(media.every((m) => m.storage_path.startsWith(`${ben.id}/${postId}/`)), "photos are in Ben's post folder", media);
      const objects = await settled(standin, `select count(*)::int n, string_agg(distinct metadata->>'mimetype', ',') types from storage.objects where bucket_id = 'social-media' and name like '${ben.id}/${postId}/%'`, (r) => Number(r?.n) === 2);
      t.expect(Number(objects?.n) === 2 && /image\/(webp|jpeg)/.test(objects?.types ?? ""), "the bucket holds two WebP or JPEG files", objects);
      const post = page.locator("article").first();
      await post.getByText("Pune").waitFor();
      await post.getByRole("link", { name: "#LegDay" }).waitFor();
      await post.getByRole("img", { name: /Photo 1 of 2/ }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "post page");
    });

    await t.step("Asha makes a public profile, finds Ben and asks to follow; his posts stay hidden", async () => {
      await switchTo(t, asha);
      await setUpProfile(t, ashaName, { isPrivate: false });
      await page.getByRole("link", { name: "Discover" }).click();
      await page.getByRole("searchbox", { name: "Search Explore" }).fill(benName);
      await page.getByRole("link", { name: new RegExp(benName) }).first().click();
      await page.getByRole("heading", { level: 1, name: "Ben Okafor" }).waitFor({ timeout: 15000 });
      await page.getByText("This account is private").waitFor();
      t.expect(await page.getByRole("link", { name: /Post by/ }).count() === 0, "no post tiles before approval");
      await page.getByRole("button", { name: `Follow @${benName}` }).click();
      await page.getByRole("button", { name: `Withdraw request to @${benName}` }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "private profile");
      await t.goto(`/explore/p/${postId}`, { label: "hidden post" });
      await page.getByRole("heading", { name: "Post not available" }).waitFor({ timeout: 15000 });
      const follow = await settled(standin, `select status from public.social_follows where user_id = '${asha.id}' and following_id = '${ben.id}'`, (r) => r?.status === "pending");
      t.expect(follow?.status === "pending", "the follow waits for approval", follow);
    });

    await t.step("Ben accepts the request from his notifications", async () => {
      await switchTo(t, ben);
      const nav = page.getByRole("navigation", { name: "Explore" });
      await nav.getByRole("link", { name: /Notifications, 1 new/ }).waitFor({ timeout: 15000 });
      await nav.getByRole("link", { name: /Notifications/ }).click();
      await page.getByRole("heading", { name: "Follow requests" }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "notifications with request");
      await page.getByRole("button", { name: `Accept @${ashaName}` }).click();
      await page.getByText(`@${ashaName} can now see your posts`).waitFor({ timeout: 15000 });
      const follow = await settled(standin, `select status from public.social_follows where user_id = '${asha.id}' and following_id = '${ben.id}'`, (r) => r?.status === "accepted");
      t.expect(follow?.status === "accepted", "the follow is accepted", follow);
    });

    await t.step("Asha's feed shows the post; she likes, saves and comments", async () => {
      await switchTo(t, asha);
      const post = page.locator("article").filter({ hasText: "Leg day done" }).first();
      await post.waitFor({ timeout: 20000 });
      // Like and save show at once and are confirmed by the server; wait for the server's answer.
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_set_like") && r.ok()), post.getByRole("button", { name: "Like", exact: true }).click()]);
      await post.locator("button[aria-label='Like'][aria-pressed='true']").waitFor({ timeout: 10000 });
      await post.getByText("1 like").waitFor();
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_set_save") && r.ok()), post.getByRole("button", { name: "Save", exact: true }).click()]);
      await post.locator("button[aria-label='Save'][aria-pressed='true']").waitFor({ timeout: 10000 });
      await sawOverflow(t, "feed with post");
      await post.getByRole("link", { name: "Comment" }).click();
      await page.getByLabel("Add a comment").fill("Strong session!");
      await page.getByRole("button", { name: "Post", exact: true }).click();
      await page.locator("#comments").getByText("Strong session!").waitFor({ timeout: 15000 });
      const counts = await settled(standin, `select (select count(*) from public.social_likes where post_id = '${postId}')::int likes,
        (select count(*) from public.social_saves where post_id = '${postId}' and user_id = '${asha.id}')::int saves,
        (select count(*) from public.social_comments where post_id = '${postId}')::int comments`, (row) => Number(row?.comments) === 1);
      t.note("stored engagement", counts);
      t.expect(Number(counts?.likes) === 1 && Number(counts?.saves) === 1 && Number(counts?.comments) === 1, "like, save and comment are stored", counts);
      await t.goto(`/explore/u/${ashaName}`, { label: "own profile" });
      await page.getByRole("radio", { name: "Saved" }).check({ force: true });
      await page.getByRole("link", { name: new RegExp(`Post by @${benName}`) }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "saved posts");
    });

    await t.step("Ben sees the like and comment, replies, and edits his caption", async () => {
      await switchTo(t, ben);
      await t.goto("/explore/notifications", { label: "ben notifications" });
      await page.getByText("liked your post.").waitFor({ timeout: 15000 });
      await page.getByText("commented: Strong session!").waitFor();
      await t.goto(`/explore/p/${postId}`, { label: "ben post" });
      await page.getByRole("button", { name: `Reply to ${ashaName}` }).click();
      await page.getByLabel("Add a comment").fill(`@${ashaName} thanks, same time next week`);
      await page.getByRole("button", { name: "Post", exact: true }).click();
      await page.getByRole("list", { name: `Replies to ${ashaName}` }).getByText("same time next week").waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Post options" }).click();
      await page.getByRole("button", { name: "Edit post" }).click();
      const dialog = page.getByRole("dialog", { name: "Edit post" });
      await dialog.getByLabel("Caption").fill("Leg day done, new squat best #LegDay #strength");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await page.locator("article").first().getByText("new squat best").waitFor({ timeout: 15000 });
      await page.locator("article").first().getByText("Edited").waitFor();
      const edited = await settled(standin, `select caption, (edited_at is not null)::text edited from public.social_posts where id = '${postId}'`, (r) => r?.edited === "true");
      t.expect(edited?.edited === "true" && /new squat best/.test(edited.caption), "the edit is stored", edited);
      await sawOverflow(t, "post with comments");
    });

    await t.step("Ben posts a second photo and deletes it; its file leaves the bucket", async () => {
      await t.goto("/explore/new", { label: "second post" });
      await page.getByLabel("Add photos").setInputFiles([{ name: "extra.png", mimeType: "image/png", buffer: makePng(800, 800) }]);
      await page.getByRole("img", { name: "Photo 1" }).waitFor({ timeout: 20000 });
      await page.getByLabel("Caption").fill("Delete me");
      await page.getByRole("button", { name: "Share post" }).click();
      await page.waitForURL(/\/explore\/p\/[0-9a-f-]{36}$/, { timeout: 30000 });
      const secondId = page.url().split("/").pop();
      await page.getByRole("button", { name: "Post options" }).click();
      await page.getByRole("button", { name: "Delete post" }).click();
      await page.getByRole("dialog", { name: "Delete this post?" }).getByRole("button", { name: "Delete", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/explore", { timeout: 15000 });
      const left = await settled(standin, `select (select count(*) from public.social_posts where id = '${secondId}')::int posts,
        (select count(*) from storage.objects where bucket_id = 'social-media' and name like '${ben.id}/${secondId}/%')::int files`, (r) => Number(r?.posts) === 0 && Number(r?.files) === 0);
      t.expect(Number(left?.posts) === 0 && Number(left?.files) === 0, "the post and its photo are gone", left);
    });

    await t.step("Asha finds the hashtag, reports the post, then blocks and unblocks Ben", async () => {
      await switchTo(t, asha);
      await t.goto("/explore/notifications", { label: "asha notifications" });
      await page.getByText("accepted your follow request.").waitFor({ timeout: 15000 });
      await page.getByText(/replied: @/).waitFor();
      await t.goto("/explore/discover", { label: "discover" });
      await page.getByRole("searchbox", { name: "Search Explore" }).fill("#legd");
      await page.getByRole("link", { name: /#legday/ }).click();
      await page.getByRole("heading", { name: "#legday" }).waitFor({ timeout: 15000 });
      await page.getByRole("link", { name: new RegExp(`Post by @${benName}`) }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "hashtag");

      await t.goto(`/explore/p/${postId}`, { label: "report post" });
      await page.getByRole("button", { name: "Post options" }).click();
      await page.getByRole("button", { name: "Report post" }).click();
      const report = page.getByRole("dialog", { name: "Report post" });
      await report.getByText("Spam", { exact: true }).click();
      await report.getByRole("button", { name: "Send report" }).click();
      await page.getByText("Report sent. Thank you.").waitFor({ timeout: 15000 });
      const stored = await settled(standin, `select reason, status, target_user_id from public.social_reports where user_id = '${asha.id}' and target_id = '${postId}'`, (r) => Boolean(r));
      t.expect(stored?.reason === "spam" && stored?.status === "open" && stored?.target_user_id === ben.id, "the report is stored for moderation", stored);

      await t.goto(`/explore/u/${benName}`, { label: "block" });
      await page.getByRole("button", { name: "Account options" }).click();
      await page.getByRole("button", { name: "Block", exact: true }).click();
      await page.getByRole("dialog", { name: `Block @${benName}?` }).getByRole("button", { name: "Block", exact: true }).click();
      await page.getByText("You blocked this account").waitFor({ timeout: 15000 });
      const after = await settled(standin, `select (select count(*) from public.social_follows where (user_id = '${asha.id}' and following_id = '${ben.id}') or (user_id = '${ben.id}' and following_id = '${asha.id}'))::int follows,
        (select count(*) from public.social_blocks where user_id = '${asha.id}' and blocked_id = '${ben.id}')::int blocks`, (r) => Number(r?.follows) === 0 && Number(r?.blocks) === 1);
      t.expect(Number(after?.follows) === 0 && Number(after?.blocks) === 1, "blocking ends the follow", after);
      await t.goto("/explore", { label: "feed after block" });
      await page.getByRole("heading", { name: "Your feed is quiet" }).waitFor({ timeout: 15000 });

      await t.goto("/explore/settings", { label: "explore settings" });
      const safety = page.locator("section[aria-labelledby=settings-safety]");
      await safety.getByRole("button", { name: `Unblock @${benName}` }).click();
      await safety.getByText("You have not blocked or restricted anyone.").waitFor({ timeout: 15000 });
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_save_notification_prefs") && r.ok()), page.getByRole("switch", { name: "Likes", exact: true }).click()]);
      await page.locator("button[role=switch][aria-checked='false']#pref-likes").waitFor({ timeout: 10000 });
      const prefs = await settled(standin, `select likes::text likes from public.social_notification_prefs where user_id = '${asha.id}'`, (r) => r?.likes === "false");
      t.note("stored notification settings", prefs);
      t.expect(prefs?.likes === "false", "the notification setting is stored", prefs);
      await sawOverflow(t, "explore settings");
      const text = await textOf(page.locator("main"));
      t.expect(!/\b(kg|kcal|bpm)\b/i.test(text), "no health data appears in Explore", text.slice(0, 300));
    });

    await t.step("Ben blocks Asha and still reports her account", async () => {
      await switchTo(t, ben);
      await t.goto(`/explore/u/${ashaName}`, { label: "ben blocks asha" });
      await page.getByRole("button", { name: "Account options" }).click();
      await page.getByRole("button", { name: "Block", exact: true }).click();
      await page.getByRole("dialog", { name: `Block @${ashaName}?` }).getByRole("button", { name: "Block", exact: true }).click();
      await page.getByText("You blocked this account").waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Account options" }).click();
      await page.getByRole("button", { name: "Report account" }).click();
      const report = page.getByRole("dialog", { name: "Report account" });
      await report.getByText("Bullying or harassment", { exact: true }).click();
      await report.getByRole("button", { name: "Send report" }).click();
      await page.getByText("Report sent. Thank you.").waitFor({ timeout: 15000 });
      const stored = await settled(standin, `select reason, evidence->>'username' username from public.social_reports where user_id = '${ben.id}' and target_type = 'account' and target_id = '${asha.id}'`, (r) => Boolean(r));
      t.expect(stored?.reason === "harassment" && stored?.username === ashaName, "a report after a block is stored, with the account as evidence", stored);
      await t.goto("/explore/settings", { label: "ben unblocks asha" });
      await page.locator("section[aria-labelledby=settings-safety]").getByRole("button", { name: `Unblock @${ashaName}` }).click();
      await page.locator("section[aria-labelledby=settings-safety]").getByText("You have not blocked or restricted anyone.").waitFor({ timeout: 15000 });
    });

    await t.step("a suspended member reads why, and can still reach Explore settings", async () => {
      await standin.sql(`insert into public.social_member_sanctions (user_id, kind, until, reason_code) values ('${asha.id}', 'explore', now() + interval '7 days', 'spam')`);
      try {
        await switchTo(t, asha);
        await page.getByRole("heading", { name: "Your Explore account is paused" }).waitFor({ timeout: 20000 });
        // Open the page again so the screenshot shows it rather than the sign-in reveal on top of it.
        await t.goto("/explore", { label: "suspended" });
        await page.getByRole("heading", { name: "Your Explore account is paused" }).waitFor({ timeout: 20000 });
        await page.getByText(/FITX has paused your Explore account until \d{1,2} \w+ \d{4}\./).waitFor();
        t.expect(await page.getByRole("navigation", { name: "Explore" }).count() === 0, "no Explore navigation while suspended");
        await sawOverflow(t, "suspended");
        await page.getByRole("link", { name: "Manage or delete my Explore content" }).click();
        await page.getByRole("heading", { level: 1, name: "Explore settings" }).waitFor({ timeout: 15000 });
        await page.getByRole("heading", { name: "Your Explore content" }).waitFor({ timeout: 15000 });
        t.expect(await page.getByRole("heading", { name: "Profile" }).count() === 0, "profile editing is closed while suspended");
        await sawOverflow(t, "suspended settings");
      } finally {
        await standin.sql(`update public.social_member_sanctions set lifted_at = now() where user_id = '${asha.id}'`);
      }
    });

    await t.step("a member with no date of birth adds it in Explore settings", async () => {
      const chen = await standin.createAccount({ name: "Chen Liu", tag: "explore-chen" });
      await standin.sql(`update public.profiles set age = null, date_of_birth = null where id = '${chen.id}'`);
      await switchTo(t, chen);
      await setUpProfile(t, `chen_${tag()}`, { isPrivate: false });
      await t.goto("/explore/settings", { label: "chen settings" });
      const section = page.locator("section#birth-date");
      await section.getByRole("heading", { name: "Date of birth" }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "date of birth");
      await section.getByLabel("Date of birth").fill("2015-03-01");
      await section.getByText("Explore is for members aged 13 and over.").waitFor();
      t.expect(await section.getByRole("button", { name: "Add your date of birth" }).isDisabled(), "an under-13 date cannot be saved");
      await section.getByLabel("Date of birth").fill("1994-06-15");
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_set_birth_date") && r.ok()), section.getByRole("button", { name: "Add your date of birth" }).click()]);
      await page.getByText("Date of birth saved").waitFor({ timeout: 15000 });
      const row = await settled(standin, `select date_of_birth::text dob, age, (select (birth_date_added_at is not null)::text from public.social_profiles where user_id = '${chen.id}') stamped from public.profiles where id = '${chen.id}'`, (r) => r?.dob === "1994-06-15");
      t.expect(row?.dob === "1994-06-15" && row?.stamped === "true", "the date is stored once and stamped for Admin", row);
      await page.locator("section#birth-date").waitFor({ state: "detached", timeout: 15000 });
    });

    await t.step("with Explore switched off, Ben still deletes his own post from Explore settings", async () => {
      await standin.sql(`update public.platform_settings set features = features || '{"explore": false}'::jsonb where id = 1`);
      try {
        await switchTo(t, ben);
        await page.getByRole("heading", { name: "Explore is paused" }).waitFor({ timeout: 20000 });
        await t.goto("/explore", { label: "explore paused" });
        await page.getByRole("heading", { name: "Explore is paused" }).waitFor({ timeout: 20000 });
        await sawOverflow(t, "explore paused");
        await page.getByRole("link", { name: "Manage or delete my Explore content" }).click();
        await page.getByRole("heading", { name: "Your Explore content" }).waitFor({ timeout: 15000 });
        await page.getByRole("status").getByText("Explore is paused").waitFor();
        await sawOverflow(t, "paused settings");
        await page.getByRole("list", { name: "Your posts" }).getByRole("button", { name: /^Delete post: Leg day done/ }).click();
        await page.getByRole("dialog", { name: "Delete this post?" }).getByRole("button", { name: "Delete", exact: true }).click();
        await page.getByText("Post deleted").waitFor({ timeout: 15000 });
        const left = await settled(standin, `select (select count(*) from public.social_posts where id = '${postId}')::int posts,
          (select count(*) from storage.objects where bucket_id = 'social-media' and name like '${ben.id}/${postId}/%')::int files`, (r) => Number(r?.posts) === 0 && Number(r?.files) === 0);
        t.expect(Number(left?.posts) === 0 && Number(left?.files) === 0, "the post and its photos are gone while Explore is off", left);
      } finally {
        await standin.sql(`update public.platform_settings set features = features - 'explore' where id = 1`);
      }
      const waited = await waitForExploreOpen(t);
      t.note("reloads until Explore was open again", waited);
    });

    if (size === "desktop") {
      await t.step("at 768 px (tablet) Discover, a profile and settings fit without sideways scroll", async () => {
        await page.setViewportSize({ width: 768, height: 1024 });
        // The wave-2 steps end as Ben; this step looks at Ben's private profile as Asha.
        await switchTo(t, asha);
        await t.goto("/explore/discover", { label: "tablet discover" });
        await page.getByRole("heading", { level: 1, name: "Discover" }).waitFor({ timeout: 15000 });
        await sawOverflow(t, "tablet discover");
        // Blocking ended Asha's follow of Ben's private account, so his profile shows its private state.
        await t.goto(`/explore/u/${benName}`, { label: "tablet profile" });
        await page.getByRole("heading", { level: 1, name: "Ben Okafor" }).waitFor({ timeout: 15000 });
        await page.getByText("This account is private").waitFor();
        await sawOverflow(t, "tablet private profile");
        await t.goto("/explore/settings", { label: "tablet settings" });
        await page.getByRole("heading", { level: 1, name: "Explore settings" }).waitFor({ timeout: 15000 });
        await sawOverflow(t, "tablet settings");
      });
    }
  },
};
