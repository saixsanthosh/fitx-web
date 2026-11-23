// Flow 26: communities and challenges (20261124100010). FITX's communities and a weekly challenge are written straight
// into the stand-in, as Admin would (nothing is seeded in the app). Asha joins a public community and starts a
// discussion; asks to join a private one, which Ben (its moderator) accepts. She joins the challenge: her value comes
// only from a workout she completed after joining; she opts in to the leaderboard and shares her progress, which
// carries the computed value. Ben, moderating the public community, removes her discussion (she is told without his
// name). A teen sees the age notice for communities and the leaderboard, and can still join the challenge.
import { signInUi } from "./common.mjs";

const tag = () => Math.random().toString(36).slice(2, 7);

async function settled(standin, query, ok) {
  let row = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
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

async function setUpProfile(t, username) {
  const page = t.page;
  await page.getByRole("heading", { name: "Your Explore profile" }).waitFor({ timeout: 20000 });
  await page.getByLabel("Username").fill(username);
  await page.getByText(`@${username} is free.`).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Create profile" }).click();
  await page.getByRole("navigation", { name: "Explore" }).waitFor({ timeout: 15000 });
}

async function sawOverflow(t, name) {
  const entry = await t.checkpoint(name);
  t.expect(!entry.overflow?.overflow, `${name}: no sideways scroll`, entry.overflow);
}

export const flow = {
  id: "26-community-challenges",
  sizes: ["phone", "tablet", "desktop"],
  title: "Explore communities and challenges: join, ask to join, discussions, moderator removal, computed values, opt-in board, progress shares, age notices",
  async run(t, { standin }) {
    const page = await t.open();
    const run = tag();
    const asha = await standin.createAccount({ name: "Asha Rao", tag: "grp-asha" });
    const ben = await standin.createAccount({ name: "Ben Okafor", tag: "grp-ben", profile: { gender: "male" } });
    const teen = await standin.createAccount({ name: "Tara Shah", tag: "grp-teen", profile: { age: 15 } });
    const ashaName = `asha_${run}`;
    const benName = `ben_${run}`;
    const openSlug = `morning-runners-${run}`;
    const closedSlug = `strength-club-${run}`;
    const ids = await standin.one(`select gen_random_uuid() as open_id, gen_random_uuid() as closed_id, gen_random_uuid() as challenge_id`);
    let discussionId = null;

    await t.step("FITX's communities and challenge exist; profiles", async () => {
      await switchTo(t, ben);
      await setUpProfile(t, benName);
      await switchTo(t, teen);
      await setUpProfile(t, `tara_${run}`);
      await standin.sql(`
        insert into public.social_communities (id, slug, name, description, visibility) values
          ('${ids.open_id}', '${openSlug}', 'Morning runners ${run}', 'Early miles before work, every pace welcome.', 'public'),
          ('${ids.closed_id}', '${closedSlug}', 'Strength club ${run}', 'Heavy lifting, technique and programming.', 'private');
        insert into public.social_community_members (community_id, user_id, role, status) values
          ('${ids.open_id}', '${ben.id}', 'moderator', 'accepted'), ('${ids.closed_id}', '${ben.id}', 'owner', 'accepted');
        insert into public.social_challenges (id, kind, title, metric, target, starts_at, ends_at) values
          ('${ids.challenge_id}', 'weekly', 'Two workouts ${run}', 'workouts', 2, now() - interval '1 day', now() + interval '6 days');`);
      await switchTo(t, asha, "/explore/community");
      await setUpProfile(t, ashaName);
      await t.goto("/explore/community", { label: "community directory" });
      await page.getByRole("heading", { level: 1, name: "Community" }).waitFor({ timeout: 20000 });
      await page.getByRole("heading", { level: 2, name: "Challenges" }).waitFor({ timeout: 15000 });
      await page.getByRole("searchbox", { name: "Search communities" }).fill(run);
      await page.getByRole("list", { name: "Communities" }).getByRole("link", { name: new RegExp(`Morning runners ${run}`) }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "community directory");
    });

    await t.step("Asha joins the public community and starts a discussion", async () => {
      await page.getByRole("list", { name: "Communities" }).getByRole("link", { name: new RegExp(`Morning runners ${run}`) }).click();
      await page.getByRole("heading", { level: 1, name: `Morning runners ${run}` }).waitFor({ timeout: 15000 });
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_join_community") && r.ok()), page.getByRole("button", { name: "Join", exact: true }).click()]);
      await page.getByRole("button", { name: "Leave", exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("textbox", { name: "Start a discussion" }).fill("Who is up for 6 am intervals on Thursday?");
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_create_group_post") && r.ok()), page.getByRole("button", { name: "Post", exact: true }).click()]);
      await page.locator("article").filter({ hasText: "Who is up for 6 am intervals" }).first().waitFor({ timeout: 15000 });
      const row = await settled(standin, `select id, kind from public.social_posts where user_id = '${asha.id}' and community_id = '${ids.open_id}'`, Boolean);
      t.expect(row?.kind === "text", "a discussion is a text post in the community", row);
      discussionId = row?.id;
      await sawOverflow(t, "public community");
    });

    await t.step("Asha asks to join the private community; its posts stay closed until Ben accepts", async () => {
      await t.goto(`/explore/c/${closedSlug}`, { label: "private community" });
      await page.getByRole("heading", { level: 1, name: `Strength club ${run}` }).waitFor({ timeout: 15000 });
      await page.getByRole("heading", { name: "Members only" }).waitFor();
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_join_community") && r.ok()), page.getByRole("button", { name: "Ask to join" }).click()]);
      await page.getByRole("button", { name: "Withdraw request" }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "private community requested");
      await switchTo(t, ben, `/explore/c/${closedSlug}`);
      await page.getByRole("region", { name: "Requests to join" }).waitFor({ timeout: 20000 });
      await sawOverflow(t, "moderator requests");
      await page.getByRole("button", { name: `Accept @${ashaName}` }).click();
      await page.getByText(`@${ashaName} joined`).waitFor({ timeout: 15000 });
      await page.getByRole("region", { name: "Requests to join" }).waitFor({ state: "detached", timeout: 15000 });
      const member = await settled(standin, `select status from public.social_community_members where community_id = '${ids.closed_id}' and user_id = '${asha.id}'`, (r) => r?.status === "accepted");
      t.expect(member?.status === "accepted", "Asha is a member", member);
      const note = await settled(standin, `select actor_id from public.social_notifications where user_id = '${asha.id}' and type = 'community_accepted'`, Boolean);
      t.expect(note && note.actor_id === null, "Asha is told, by FITX, not by name", note);
    });

    await t.step("Ben removes Asha's discussion from the public community", async () => {
      await t.goto(`/explore/c/${openSlug}`, { label: "moderator view" });
      const post = page.locator("article").filter({ hasText: "Who is up for 6 am intervals" }).first();
      await post.waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "Remove from community" }).first().click();
      const sheet = page.getByRole("dialog", { name: "Remove this post?" });
      await sheet.getByText("Off topic for this community").click();
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_moderator_remove_post") && r.ok()), sheet.getByRole("button", { name: "Remove", exact: true }).click()]);
      await page.getByText("Post removed from the community").waitFor({ timeout: 15000 });
      const row = await settled(standin, `select moderation_state from public.social_posts where id = '${discussionId}'`, (r) => r?.moderation_state === "hidden");
      t.expect(row?.moderation_state === "hidden", "the post is hidden", row);
      const action = await standin.one(`select actor_kind, reason_code from public.social_moderation_actions where target_id = '${discussionId}'`);
      t.expect(action?.actor_kind === "member" && action?.reason_code === "off_topic", "the removal is recorded as a community moderator's", action);
    });

    await t.step("Asha joins the challenge; her value counts only her own workout after joining", async () => {
      await switchTo(t, asha, `/explore/challenges/${ids.challenge_id}`);
      await page.getByRole("heading", { level: 1, name: `Two workouts ${run}` }).waitFor({ timeout: 20000 });
      // A workout from before she joins does not count.
      await standin.sql(`insert into public.workout_sessions (user_id, name, status, started_at, completed_at, duration_seconds)
        values ('${asha.id}', 'Before joining', 'completed', now() - interval '3 hours', now() - interval '150 minutes', 1800)`);
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_join_challenge") && r.ok()), page.getByRole("button", { name: "Join challenge" }).click()]);
      await page.getByRole("img", { name: "Your count: 0 workouts of 2 workouts" }).waitFor({ timeout: 15000 });
      await standin.sql(`insert into public.workout_sessions (user_id, name, status, started_at, completed_at, duration_seconds)
        values ('${asha.id}', 'Intervals', 'completed', now() - interval '40 minutes', now() - interval '5 minutes', 2100);
        update public.social_challenge_entries set synced_at = now() - interval '11 minutes', joined_at = now() - interval '1 hour'
        where challenge_id = '${ids.challenge_id}' and user_id = '${asha.id}'`);
      await t.goto(`/explore/challenges/${ids.challenge_id}`, { label: "challenge synced" });
      await page.getByRole("img", { name: "Your count: 1 workout of 2 workouts" }).waitFor({ timeout: 15000 });
      const entry = await standin.one(`select value::int value, on_leaderboard::text board from public.social_challenge_entries where challenge_id = '${ids.challenge_id}' and user_id = '${asha.id}'`);
      t.expect(entry?.value === 1 && entry?.board === "false", "one workout counted; off the board by default", entry);
      await sawOverflow(t, "challenge joined");
    });

    await t.step("she opts in to the leaderboard and shares progress with the computed value", async () => {
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_set_leaderboard") && r.ok()), page.getByRole("switch", { name: "Show me on the leaderboard" }).click()]);
      const board = page.getByRole("list", { name: "Leaderboard" });
      await board.getByText("You", { exact: true }).waitFor({ timeout: 15000 });
      await page.getByRole("textbox", { name: "Share your progress" }).fill("One down, one to go");
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_create_group_post") && r.ok()), page.getByRole("button", { name: "Share progress" }).click()]);
      await page.getByText(`@${ashaName} · 1 workout · 1st`).waitFor({ timeout: 15000 });
      const share = await settled(standin, `select count(*)::int n from public.social_posts where user_id = '${asha.id}' and challenge_id = '${ids.challenge_id}'`, (r) => Number(r?.n) === 1);
      t.expect(Number(share?.n) === 1, "the progress share is stored with the challenge", share);
      await sawOverflow(t, "challenge board");
      await t.goto("/explore/challenges", { label: "challenges list" });
      await page.getByRole("list", { name: "Open challenges" }).getByRole("link", { name: new RegExp(`Two workouts ${run}`) }).waitFor({ timeout: 15000 });
      await sawOverflow(t, "challenges list");
    });

    await t.step("a teen sees the age notices and can still join the challenge", async () => {
      await switchTo(t, teen, "/explore/community");
      await page.getByRole("heading", { level: 1, name: "Community" }).waitFor({ timeout: 20000 });
      await page.getByText("Joining communities is for members aged 18 and over.").waitFor({ timeout: 15000 });
      t.expect(await page.getByRole("searchbox", { name: "Search communities" }).count() === 0, "no community search for a teen");
      await sawOverflow(t, "teen community");
      await t.goto(`/explore/challenges/${ids.challenge_id}`, { label: "teen challenge" });
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_join_challenge") && r.ok()), page.getByRole("button", { name: "Join challenge" }).click()]);
      await page.getByText("The leaderboard is for members aged 18 and over.").first().waitFor({ timeout: 15000 });
      t.expect(await page.getByRole("switch", { name: "Show me on the leaderboard" }).count() === 0, "no leaderboard switch for a teen");
      t.expect(await page.getByRole("list", { name: "Leaderboard" }).count() === 0, "no board for a teen");
      await sawOverflow(t, "teen challenge");
    });
  },
};
