// Flow 9: Help. Send a support request and see it in "Your messages"; a staff reply (written through SQL the way
// the Admin reply function writes it) shows in the thread and the member answers (an empty answer is refused in
// words first). An announcement published
// through SQL shows in the app's banner, can be dismissed, and stays dismissed after a reload. A draft never shows.
// What FITX Admin sends (written through SQL as its functions write it): a maintenance notice from Settings shows
// under its own name and hides for the tab, and a notice sent to this account shows until dismissed. Help offers
// complaints once the database takes them.
import { hasFocus, signInUi, textOf } from "./common.mjs";

export const flow = {
  id: "09-help-announcements",
  title: "Help request thread and announcement banner",
  async run(t, { standin }) {
    const page = await t.open();
    const account = await standin.createAccount({ name: "Leela Nair", tag: "help" });
    const subject = `Workout timer stops ${Date.now().toString(36)}`;
    let requestId = null;
    await signInUi(t, account);
    try {
      await this.steps(t, { standin, account, subject, page, state: { requestId } });
    } finally {
      await standin.sql(`delete from public.announcements where title in ('Planned maintenance tonight', 'Draft that must not show')`).catch(() => undefined);
      await standin.sql(`update public.platform_settings set maintenance = null where id = 1`).catch(() => undefined);
    }
  },

  async steps(t, { standin, account, subject, page, state }) {
    let requestId = state.requestId;
    await t.step("send a support request", async () => {
      await t.goto("/help", { label: "help" });
      await t.checkpoint("help page");
      const form = page.locator("form[aria-labelledby=help-form-title]");
      const categories = await form.getByLabel("What is it about?").locator("option").evaluateAll((options) => options.map((option) => option.value));
      t.note("categories", categories);
      t.expect(categories.includes("complaint"), "Help should offer complaints once the database takes them", categories);
      await form.getByLabel("What is it about?").selectOption("problem");
      await form.getByLabel("Subject").fill(subject);
      await form.getByLabel("Message").fill("The rest timer stops when I lock my phone during a workout. I expected it to keep counting.");
      await form.getByRole("button", { name: "Send message" }).click();
      const status = form.locator("[role=status], [role=alert]");
      await status.waitFor({ timeout: 15000 });
      const said = await textOf(status);
      t.note("after sending", said);
      t.expect(!/couldn|could not|try again/i.test(said), `sending failed: ${said}`);
      const row = await standin.one(`select r.id, r.category, r.status, r.page_path, (select count(*) from public.support_messages m where m.request_id = r.id)::int messages
        from public.support_requests r where r.user_id = '${account.id}' and r.subject = '${subject.replace(/'/g, "''")}'`);
      t.note("stored request", row);
      t.expect(row && row.category === "problem" && row.status === "open", "the request should be stored as an open problem", row);
      requestId = row.id;
    });

    await t.step("the request shows in Your messages", async () => {
      await page.getByText(subject).first().waitFor({ timeout: 15000 });
      const threads = await textOf(page.locator("main"));
      t.expect(threads.includes("Received"), "the thread should show its status (Received)");
      await t.checkpoint("help with the new thread");
    });

    await t.step("a staff reply shows in the thread and the member answers", async () => {
      await standin.sql(`insert into public.support_messages (request_id, author_id, author_kind, body) values ('${requestId}', null, 'staff', 'Thanks Leela. Does it also stop with the screen on?');
        update public.support_requests set status = 'waiting_on_user', last_message_at = now(), updated_at = now() where id = '${requestId}';`);
      await t.goto("/help", { label: "help after staff reply" });
      await page.getByText("Does it also stop with the screen on?").waitFor({ timeout: 15000 });
      t.expect((await page.getByText("Waiting for your reply").count()) > 0, "the thread should say it waits for the member");
      const reply = page.getByLabel("Reply");
      // An empty reply is refused in words beside the box, which is marked and keeps the focus (bug 47), never a
      // silent nothing or the browser's own bubble.
      await page.getByRole("button", { name: "Send reply" }).click();
      await page.getByRole("alert").filter({ hasText: "Write 1 to 4,000 characters." }).waitFor({ timeout: 10000 });
      t.expect((await reply.getAttribute("aria-invalid")) === "true" && (await hasFocus(reply)), "the empty reply box is marked and has the focus");
      await reply.fill("Only when the screen locks. With the screen on it keeps counting.");
      // Typing clears the message.
      await page.getByRole("alert").filter({ hasText: "Write 1 to 4,000 characters." }).waitFor({ state: "detached", timeout: 5000 });
      // What the page asks the server for after sending (router.refresh() is an RSC request for /help).
      const timeline = [];
      const clickAt = Date.now();
      const onRequest = (request) => { if (request.headers().rsc) timeline.push(`${Date.now() - clickAt}ms ${request.method()} ${new URL(request.url()).pathname}${request.headers()["next-router-state-tree"] ? " (refresh)" : ""}`); };
      const onResponse = (response) => {
        if (!response.request().headers().rsc || new URL(response.url()).pathname !== "/help") return;
        const at = Date.now() - clickAt;
        void response.text().then(
          (text) => timeline.push(`${at}ms ${response.status()} response /help (${text.length} bytes, reply ${text.includes("Only when the screen locks") ? "included" : "missing"}, status ${/waiting_on_user/.test(text) ? "waiting_on_user" : /"open"/.test(text) ? "open" : "?"})`),
          () => timeline.push(`${at}ms ${response.status()} response /help (body unreadable)`),
        );
      };
      page.on("request", onRequest);
      page.on("response", onResponse);
      await page.getByRole("button", { name: "Send reply" }).click();
      const appeared = await page.getByText("Only when the screen locks.").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
      page.off("request", onRequest);
      page.off("response", onResponse);
      if (!appeared) {
        const box = await reply.inputValue().catch(() => null);
        t.note("the sent reply did not appear; requests after the click", { timeline, replyBoxAfter: box });
        await t.checkpoint("reply sent but not shown", { settle: false });
        await page.reload();
        const afterReload = await page.getByText("Only when the screen locks.").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
        t.note("after a manual reload the reply shows", afterReload);
      }
      t.expect(appeared, "the member's reply should appear in the thread after sending (it stays hidden until a reload)");
      const stored = await standin.one(`select (select count(*) from public.support_messages where request_id = '${requestId}' and author_kind = 'user')::int user_messages, status from public.support_requests where id = '${requestId}'`);
      t.note("after the member's reply", stored);
      // The request's own body is its first message; replies are support_messages, and a reply reopens the request.
      t.expect(stored.user_messages === "1" && stored.status === "open", "the member's reply should be stored and reopen the request", stored);
      await t.checkpoint("help thread with replies");
    }, { soft: true });

    await t.step("a published announcement shows in the banner; a draft does not", async () => {
      const rows = await standin.sql(`insert into public.announcements (title, body, tone, status, published_at, link_url, link_label)
          values ('Planned maintenance tonight', 'FITX may be slow between 1 and 2 am IST while we upgrade the database.', 'warning', 'published', now(), '/help', 'Get help')
          returning id;`);
      t.announcementId = rows[0].id;
      await standin.sql(`insert into public.announcements (title, body, tone, status) values ('Draft that must not show', 'Not published yet.', 'info', 'draft');`);
      await t.goto("/dashboard", { label: "dashboard with announcement" });
      const banner = page.getByRole("region", { name: "Announcement" });
      await banner.waitFor({ timeout: 15000 });
      const text = await textOf(banner);
      t.note("banner", text);
      t.expect(/Planned maintenance tonight/.test(text), "the published announcement should show");
      t.expect(!/Draft that must not show/.test(await textOf(page.locator("body"))), "a draft must not show");
      await t.checkpoint("announcement banner");
    });

    await t.step("dismissing hides it for good", async () => {
      await page.getByRole("button", { name: "Dismiss announcement" }).click();
      await page.getByRole("region", { name: "Announcement" }).waitFor({ state: "detached", timeout: 10000 });
      let stored = null;
      for (let i = 0; i < 20 && !stored; i += 1) {
        stored = await standin.one(`select dismissed_at from public.announcement_dismissals where user_id = '${account.id}' and announcement_id = '${t.announcementId}'`);
        if (!stored) await page.waitForTimeout(250);
      }
      t.expect(Boolean(stored), "the dismissal should be stored on the account");
      await t.goto("/workouts", { label: "after dismissing" });
      t.expect((await page.getByRole("region", { name: "Announcement" }).count()) === 0, "the banner should stay dismissed on other pages and after reload");
      await t.checkpoint("after dismissing the announcement");
    });

    await t.step("a maintenance notice and a notice to this account show under their own names", async () => {
      await standin.sql(`update public.platform_settings set maintenance = '{"title": "Planned upgrade tonight", "body": "FITX may be slow from 1 am IST.", "startsAt": null, "endsAt": null}'::jsonb where id = 1;
        insert into public.member_notifications (batch_id, user_id, title, body, tone, link_url, link_label)
        values (gen_random_uuid(), '${account.id}', 'Your plan changed', 'We moved your rest day to Sunday.', 'success', '/workouts', 'Open workouts');`);
      await t.goto("/dashboard", { label: "dashboard with notices" });
      const maintenance = page.getByRole("region", { name: "Maintenance" });
      await maintenance.waitFor({ timeout: 15000 });
      t.expect(/Planned upgrade tonight/.test(await textOf(maintenance)), "the maintenance notice should show");
      const message = page.getByRole("region", { name: "Message from FITX" });
      await message.waitFor({ timeout: 15000 });
      t.expect(/Your plan changed/.test(await textOf(message)), "the notice sent to this account should show");
      t.expect((await page.getByRole("region", { name: "Announcement" }).count()) === 0, "the dismissed announcement stays hidden");
      await t.checkpoint("maintenance and personal notice");
    });

    await t.step("dismissing the notice sticks; hiding maintenance lasts for the tab", async () => {
      await page.getByRole("button", { name: "Dismiss message" }).click();
      await page.getByRole("region", { name: "Message from FITX" }).waitFor({ state: "detached", timeout: 10000 });
      let stored = null;
      for (let i = 0; i < 20 && !stored; i += 1) {
        stored = await standin.one(`select dismissed_at from public.member_notifications where user_id = '${account.id}' and dismissed_at is not null`);
        if (!stored) await page.waitForTimeout(250);
      }
      t.expect(Boolean(stored), "the dismissal should be stored on the notice");
      await page.getByRole("button", { name: "Hide maintenance notice" }).click();
      await page.getByRole("region", { name: "Maintenance" }).waitFor({ state: "detached", timeout: 10000 });
      await t.goto("/workouts", { label: "after hiding notices" });
      await page.waitForTimeout(1500);
      t.expect((await page.getByRole("region", { name: "Message from FITX" }).count()) === 0, "a dismissed notice should not come back");
      t.expect((await page.getByRole("region", { name: "Maintenance" }).count()) === 0, "a hidden maintenance notice stays hidden in this tab");
      await t.checkpoint("after hiding the notices");
    });
  },
};
