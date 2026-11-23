// Flow 21: Explore with two members. Ben makes a private profile and posts two photos (made smaller in the browser,
// uploaded to the private social-media bucket); Asha makes a public profile, finds Ben by search, asks to follow and
// sees nothing until Ben accepts from his notifications. Then Asha sees the post in her feed, likes, saves and
// comments; Ben sees those notifications, replies, edits his caption, posts and deletes a second post (its photos
// leave the bucket); Asha finds the hashtag, reports the post, blocks Ben (follows end, his profile is hidden) and
// unblocks him from Explore settings. /social now leads to /explore.
import { signInUi, textOf } from "./common.mjs";
import { makePng } from "../support/png.mjs";

const tag = () => Math.random().toString(36).slice(2, 7);

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

async function sawOverflow(t, name) {
  const entry = await t.checkpoint(name);
  t.expect(!entry.overflow?.overflow, `${name}: no sideways scroll`, entry.overflow);
}

export const flow = {
  id: "21-explore",
  title: "Explore: profiles, private follow approval, photo posts, likes, comments, saves, edits, deletes, search, reports, blocks, notifications",
  async run(t, { standin }) {
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
      const row = await standin.one(`select username, is_private from public.social_profiles where user_id = '${ben.id}'`);
      t.expect(row?.username === benName && row?.is_private === true, "the private profile is stored", row);
      await page.getByRole("heading", { name: "Your feed is quiet" }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "empty feed");
    });

    await t.step("Ben posts two photos with a caption, hashtag, place and topic", async () => {
      await page.getByRole("link", { name: "New post" }).first().click();
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
      const objects = await standin.one(`select count(*)::int n, string_agg(distinct metadata->>'mimetype', ',') types from storage.objects where bucket_id = 'social-media' and name like '${ben.id}/${postId}/%'`);
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
      const follow = await standin.one(`select status from public.social_follows where user_id = '${asha.id}' and following_id = '${ben.id}'`);
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
      const follow = await standin.one(`select status from public.social_follows where user_id = '${asha.id}' and following_id = '${ben.id}'`);
      t.expect(follow?.status === "accepted", "the follow is accepted", follow);
    });

    await t.step("Asha's feed shows the post; she likes, saves and comments", async () => {
      await switchTo(t, asha);
      const post = page.locator("article").filter({ hasText: "Leg day done" }).first();
      await post.waitFor({ timeout: 20000 });
      await post.getByRole("button", { name: "Like", exact: true }).click();
      await post.locator("button[aria-label='Like'][aria-pressed='true']").waitFor({ timeout: 10000 });
      await post.getByText("1 like").waitFor();
      await post.getByRole("button", { name: "Save", exact: true }).click();
      await post.locator("button[aria-label='Save'][aria-pressed='true']").waitFor({ timeout: 10000 });
      await sawOverflow(t, "feed with post");
      await post.getByRole("link", { name: "Comment" }).click();
      await page.getByLabel("Add a comment").fill("Strong session!");
      await page.getByRole("button", { name: "Post", exact: true }).click();
      await page.locator("#comments").getByText("Strong session!").waitFor({ timeout: 15000 });
      const counts = await standin.one(`select (select count(*) from public.social_likes where post_id = '${postId}')::int likes,
        (select count(*) from public.social_saves where post_id = '${postId}' and user_id = '${asha.id}')::int saves,
        (select count(*) from public.social_comments where post_id = '${postId}')::int comments`);
      t.expect(counts?.likes === 1 && counts?.saves === 1 && counts?.comments === 1, "like, save and comment are stored", counts);
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
      const edited = await standin.one(`select caption, edited_at is not null edited from public.social_posts where id = '${postId}'`);
      t.expect(edited?.edited === true && /new squat best/.test(edited.caption), "the edit is stored", edited);
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
      const left = await standin.one(`select (select count(*) from public.social_posts where id = '${secondId}')::int posts,
        (select count(*) from storage.objects where bucket_id = 'social-media' and name like '${ben.id}/${secondId}/%')::int files`);
      t.expect(left?.posts === 0 && left?.files === 0, "the post and its photo are gone", left);
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
      const stored = await standin.one(`select reason, status, target_user_id from public.social_reports where user_id = '${asha.id}' and target_id = '${postId}'`);
      t.expect(stored?.reason === "spam" && stored?.status === "open" && stored?.target_user_id === ben.id, "the report is stored for moderation", stored);

      await t.goto(`/explore/u/${benName}`, { label: "block" });
      await page.getByRole("button", { name: "Account options" }).click();
      await page.getByRole("button", { name: "Block", exact: true }).click();
      await page.getByRole("dialog", { name: `Block @${benName}?` }).getByRole("button", { name: "Block", exact: true }).click();
      await page.getByText("You blocked this account").waitFor({ timeout: 15000 });
      const after = await standin.one(`select (select count(*) from public.social_follows where (user_id = '${asha.id}' and following_id = '${ben.id}') or (user_id = '${ben.id}' and following_id = '${asha.id}'))::int follows,
        (select count(*) from public.social_blocks where user_id = '${asha.id}' and blocked_id = '${ben.id}')::int blocks`);
      t.expect(after?.follows === 0 && after?.blocks === 1, "blocking ends the follow", after);
      await t.goto("/explore", { label: "feed after block" });
      await page.getByRole("heading", { name: "Your feed is quiet" }).waitFor({ timeout: 15000 });

      await t.goto("/explore/settings", { label: "explore settings" });
      const safety = page.locator("section[aria-labelledby=settings-safety]");
      await safety.getByRole("button", { name: `Unblock @${benName}` }).click();
      await safety.getByText("You have not blocked or restricted anyone.").waitFor({ timeout: 15000 });
      await page.getByRole("switch", { name: "Likes" }).click();
      await page.locator("button[role=switch][aria-checked='false']#pref-likes").waitFor({ timeout: 10000 });
      const prefs = await standin.one(`select likes from public.social_notification_prefs where user_id = '${asha.id}'`);
      t.expect(prefs?.likes === false, "the notification setting is stored", prefs);
      await sawOverflow(t, "explore settings");
      const text = await textOf(page.locator("main"));
      t.expect(!/\b(kg|kcal|bpm)\b/i.test(text), "no health data appears in Explore", text.slice(0, 300));
    });
  },
};
