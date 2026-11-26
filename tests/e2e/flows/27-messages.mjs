// Flow 27: direct messages between two adults (20261124100010). Asha follows Ben and writes to him; as Ben does not
// follow her, it lands in his Requests (one message, links kept plain, no actor named). Ben accepts and replies. Asha's
// unread badge updates through polling (a message arriving while she is on the inbox shows when the tab is shown
// again) and clears once she reads the conversation. She sends one of Ben's posts with "Send to…", unsends a message,
// sets who can message her to "No one" (Chen is then refused), and Ben blocks her from the conversation, after which
// neither inbox lists the other. Release 2a: each member reaches Messages from the Explore rail (whose "Messages" link
// carries the unread badge), Asha starts the conversation from Ben's profile ("Message"), and shares his post from the
// post's own share menu ("Send to…").
import { hasFocus, signInUi } from "./common.mjs";

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

/** Opens Messages from the Explore rail. */
async function openMessagesFromRail(t) {
  const page = t.page;
  // The link is named "Messages", or "Messages, <n> unread" while there are unread messages.
  await page.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: /^Messages(, \d+ unread)?$/ }).click({ timeout: 20000 });
  await page.waitForURL((url) => url.pathname === "/explore/messages", { timeout: 15000 });
}

async function sawOverflow(t, name) {
  const entry = await t.checkpoint(name);
  t.expect(!entry.overflow?.overflow, `${name}: no sideways scroll`, entry.overflow);
}

export const flow = {
  id: "27-messages",
  sizes: ["phone", "tablet", "desktop"],
  title: "Explore messages: requests, accept, replies, unread badge by polling, Send to…, unsend, who can message you, block",
  async run(t, { standin }) {
    const page = await t.open();
    const asha = await standin.createAccount({ name: "Asha Rao", tag: "dm-asha" });
    const ben = await standin.createAccount({ name: "Ben Okafor", tag: "dm-ben", profile: { gender: "male" } });
    const chen = await standin.createAccount({ name: "Chen Liu", tag: "dm-chen" });
    const ashaName = `asha_${tag()}`;
    const benName = `ben_${tag()}`;
    const chenName = `chen_${tag()}`;
    let conversation = null;

    await t.step("profiles; Asha follows Ben, and her inbox starts empty", async () => {
      await switchTo(t, ben);
      await setUpProfile(t, benName);
      await switchTo(t, chen);
      await setUpProfile(t, chenName);
      await switchTo(t, asha);
      await setUpProfile(t, ashaName);
      await standin.sql(`insert into public.social_follows (user_id, following_id, status, accepted_at) values ('${asha.id}', '${ben.id}', 'accepted', now())`);
      await t.goto("/explore", { label: "feed" });
      await openMessagesFromRail(t);
      await page.getByRole("heading", { level: 1, name: "Messages" }).waitFor({ timeout: 20000 });
      await page.getByRole("heading", { name: "No messages yet" }).waitFor({ timeout: 15000 });
      await page.getByText("not end-to-end encrypted").first().waitFor();
      await sawOverflow(t, "empty inbox");
    });

    await t.step("Asha writes to Ben from his profile; it waits in his Requests", async () => {
      await t.goto(`/explore/u/${benName}`, { label: "ben's profile" });
      await page.getByRole("heading", { level: 1, name: "Ben Okafor" }).waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "Message", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "New message" });
      await sheet.getByText(`@${benName}`).first().waitFor({ timeout: 15000 });
      // Whether a first message is taken, and lands in Requests, is Ben's own setting: the sheet promises neither (bug 19).
      await sheet.getByText(`If @${benName} takes messages from you, it goes to their inbox, or to their requests if they do not follow you.`).waitFor({ timeout: 10000 });
      await sheet.getByRole("textbox", { name: "Message" }).fill("Hi Ben, tempo run on Saturday? https://fitx.example/route");
      await sawOverflow(t, "new message");
      await Promise.all([page.waitForURL(/\/explore\/messages\/[0-9a-f-]{36}$/, { timeout: 20000 }), sheet.getByRole("button", { name: "Send" }).click()]);
      conversation = page.url().split("/").pop();
      await page.getByText("Hi Ben, tempo run on Saturday?").waitFor({ timeout: 15000 });
      await page.getByText("Your message request is waiting.").waitFor();
      t.expect(await page.getByRole("textbox", { name: "Message" }).count() === 0, "no composer while the request waits");
      await sawOverflow(t, "request sent");
      const row = await settled(standin, `select status, requested_by from public.social_conversations where id = '${conversation}'`, (r) => r?.status === "request");
      t.expect(row?.status === "request" && row?.requested_by === asha.id, "the conversation is a request from Asha", row);
      const note = await settled(standin, `select type, actor_id from public.social_notifications where user_id = '${ben.id}' and conversation_id = '${conversation}'`, Boolean);
      t.expect(note?.type === "message_request" && note?.actor_id === null, "one message request notice that names nobody", note);
    });

    await t.step("Ben accepts from Requests and replies", async () => {
      await switchTo(t, ben);
      await openMessagesFromRail(t);
      await page.getByRole("heading", { level: 1, name: "Messages" }).waitFor({ timeout: 20000 });
      await page.getByRole("tab", { name: /Requests/ }).click();
      await page.getByRole("list", { name: "Message requests" }).getByRole("link", { name: new RegExp(ashaName) }).click();
      const banner = page.getByRole("region", { name: "Message request" });
      await banner.waitFor({ timeout: 15000 });
      t.expect(await page.getByRole("link", { name: "https://fitx.example/route" }).count() === 0, "a request's links stay plain text");
      await sawOverflow(t, "request received");
      await banner.getByRole("button", { name: "Accept" }).click();
      await page.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 15000 });
      await page.getByRole("textbox", { name: "Message" }).fill("Saturday works. 7 am?");
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_send_message") && r.ok()), page.getByRole("button", { name: "Send" }).click()]);
      await page.getByText("Saturday works. 7 am?").waitFor({ timeout: 15000 });
      // The emptied box turns Send off, so the box keeps the focus for the next message (D5).
      t.expect(await hasFocus(page.getByRole("textbox", { name: "Message" })), "after sending, the focus is in the message box");
      await sawOverflow(t, "conversation");
      const row = await settled(standin, `select status from public.social_conversations where id = '${conversation}'`, (r) => r?.status === "accepted");
      t.expect(row?.status === "accepted", "the conversation is accepted", row);
    });

    await t.step("Asha's unread badge shows the reply, updates by polling and clears once she reads", async () => {
      await switchTo(t, asha);
      // The rail's Messages link carries the badge on every Explore page.
      await page.getByRole("navigation", { name: "Explore" }).getByLabel("1 unread message", { exact: true }).waitFor({ timeout: 20000 });
      // The link itself carries the count in its name (its own name would otherwise hide the badge's).
      await page.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "Messages, 1 unread", exact: true }).waitFor({ timeout: 20000 });
      await openMessagesFromRail(t);
      await page.getByRole("heading", { level: 1, name: "Messages" }).waitFor({ timeout: 20000 });
      await page.getByLabel("1 unread message", { exact: true }).first().waitFor({ timeout: 20000 });
      // A message arrives while she is on the page; it shows when the tab is shown again (the polling fallback).
      await standin.sql(`insert into public.social_messages (conversation_id, user_id, body) values ('${conversation}', '${ben.id}', 'Bring water.');
        update public.social_conversations set last_message_at = now() where id = '${conversation}'`);
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await page.getByLabel("2 unread messages", { exact: true }).first().waitFor({ timeout: 15000 });
      await sawOverflow(t, "inbox unread");
      await page.getByRole("list", { name: "Conversations" }).getByRole("link", { name: new RegExp(benName) }).click();
      await page.getByText("Bring water.").waitFor({ timeout: 15000 });
      await t.settle();
      const side = await settled(standin, `select (last_read_at > (select max(created_at) from public.social_messages where conversation_id = '${conversation}' and user_id = '${ben.id}'))::text read
        from public.social_conversation_sides where conversation_id = '${conversation}' and user_id = '${asha.id}'`, (r) => r?.read === "true");
      t.expect(side?.read === "true", "reading the conversation marks it read", side);
      await t.goto("/explore/messages", { label: "inbox read" });
      await page.getByRole("list", { name: "Conversations" }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(1500);
      t.expect(await page.getByLabel(/unread message/).count() === 0, "no unread badge after reading");
    });

    await t.step("Asha sends Ben's post with Send to… from its share menu, then unsends her first message", async () => {
      const post = await standin.one(`insert into public.social_posts (user_id, kind, caption) values ('${ben.id}', 'photo', 'Tempo run done, 8 km') returning id`);
      await t.goto(`/explore/p/${post.id}`, { label: "ben's post" });
      await page.locator("article").first().getByRole("button", { name: "Share", exact: true }).click({ timeout: 20000 });
      const sheet = page.getByRole("dialog", { name: "Share post" });
      await sheet.getByRole("button", { name: "Send to…" }).click();
      await sheet.getByRole("searchbox", { name: "Search people to send to" }).fill(benName);
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_send_message") && r.ok()), sheet.getByRole("button", { name: new RegExp(benName) }).click()]);
      // Said inside the open Share sheet, where a toast would be hidden under it (D6).
      await sheet.getByText(`Sent to @${benName}`).waitFor({ timeout: 15000 });
      await sawOverflow(t, "send to");
      const shared = await settled(standin, `select count(*)::int n from public.social_messages where conversation_id = '${conversation}' and shared_post_id = '${post.id}'`, (r) => Number(r?.n) === 1);
      t.expect(Number(shared?.n) === 1, "the post is shared in the conversation", shared);
      await sheet.getByRole("button", { name: "Done" }).click();
      await t.goto(`/explore/messages/${conversation}`, { label: "shared post" });
      await page.getByRole("link", { name: new RegExp(`Post by @${benName}`) }).waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: /^Options for your message: Hi Ben, tempo run on Saturday/ }).click();
      await page.getByRole("dialog", { name: "Your message" }).getByRole("button", { name: "Unsend" }).click();
      await page.getByText("You unsent a message").waitFor({ timeout: 15000 });
      // The message's options button went with it: the focus is on "You unsent a message" in its place (bug 82, D5).
      t.expect(await hasFocus(page.getByText("You unsent a message", { exact: true })), "after Unsend, the focus is on the unsent message's place");
      const gone = await settled(standin, `select count(*)::int n from public.social_messages where conversation_id = '${conversation}' and user_id = '${asha.id}' and deleted_at is not null and body = ''`, (r) => Number(r?.n) === 1);
      t.expect(Number(gone?.n) === 1, "unsending blanks the body", gone);
      await sawOverflow(t, "unsent");
    });

    await t.step("with who can message her set to No one, Chen cannot start a conversation", async () => {
      // Explore settings points to the setting, which lives with the messages and opens at once.
      await t.goto("/explore/settings", { label: "explore settings" });
      await page.getByRole("link", { name: "Who can message you" }).click({ timeout: 20000 });
      await page.waitForURL((url) => url.pathname === "/explore/messages", { timeout: 15000 });
      const sheet = page.getByRole("dialog", { name: "Who can message you" });
      await sheet.waitFor({ timeout: 15000 });
      await sheet.getByText("No one", { exact: true }).click();
      await sawOverflow(t, "message settings");
      await Promise.all([page.waitForResponse((r) => r.url().includes("/rpc/fitx_social_set_dm_policy") && r.ok()), sheet.getByRole("button", { name: "Save" }).click()]);
      const policy = await settled(standin, `select dm_policy from public.social_profiles where user_id = '${asha.id}'`, (r) => r?.dm_policy === "off");
      t.expect(policy?.dm_policy === "off", "the setting is stored", policy);
      // The inbox's own "Message settings" button opens the same setting.
      if (await sheet.count()) await page.keyboard.press("Escape");
      await sheet.waitFor({ state: "hidden", timeout: 10000 });
      await page.getByRole("button", { name: "Message settings" }).click();
      await sheet.waitFor({ timeout: 10000 });
      await page.keyboard.press("Escape");
      await switchTo(t, chen, "/explore/messages");
      await page.getByRole("button", { name: "New message" }).first().click();
      const compose = page.getByRole("dialog", { name: "New message" });
      await compose.getByRole("searchbox", { name: "Search people" }).fill(ashaName);
      await compose.getByRole("button", { name: new RegExp(ashaName) }).click();
      await compose.getByRole("textbox", { name: "Message" }).fill("Hello Asha");
      await compose.getByRole("button", { name: "Send" }).click();
      // Picked from search, so the sheet doesn't know whether Chen follows Asha: the refusal says what Chen can do and
      // reveals neither Asha's setting nor her age (bug 19).
      await compose.getByRole("alert").getByText(`@${ashaName} is not taking messages from you. If you do not follow them yet, follow them first, then try again.`, { exact: true }).waitFor({ timeout: 15000 });
      const none = await standin.one(`select count(*)::int n from public.social_conversations where '${chen.id}' in (user_low, user_high)`);
      t.expect(Number(none?.n) === 0, "no conversation was made", none);
      await standin.sql(`update public.social_profiles set dm_policy = 'followers' where user_id = '${asha.id}'`);
    });

    await t.step("Ben blocks Asha from the conversation; neither inbox lists the other", async () => {
      await switchTo(t, ben, `/explore/messages/${conversation}`);
      await page.getByRole("button", { name: `Block @${ashaName}` }).click();
      await page.getByRole("dialog", { name: `Block @${ashaName}?` }).getByRole("button", { name: "Block", exact: true }).click();
      await page.waitForURL(/\/explore\/messages$/, { timeout: 15000 });
      await page.getByRole("heading", { name: "No messages yet" }).waitFor({ timeout: 15000 });
      const block = await settled(standin, `select count(*)::int n from public.social_blocks where user_id = '${ben.id}' and blocked_id = '${asha.id}'`, (r) => Number(r?.n) === 1);
      t.expect(Number(block?.n) === 1, "the block is stored", block);
      await switchTo(t, asha, `/explore/messages/${conversation}`);
      await page.getByRole("heading", { name: "Conversation not available" }).waitFor({ timeout: 20000 });
      await sawOverflow(t, "blocked conversation");
      await standin.sql(`delete from public.social_blocks where user_id = '${ben.id}' and blocked_id = '${asha.id}'`);
    });
  },
};
