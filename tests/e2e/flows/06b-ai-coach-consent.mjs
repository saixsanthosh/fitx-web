// Flow 6b: the AI coach's consent screen, which only shows once an AI service is set up. A second app server
// (E2E_COACH_URL, started by run.mjs) is pointed at support/fake-ollama.mjs on 127.0.0.1, the only provider FITX
// accepts on localhost, so nothing leaves this machine. The screen starts with no choice made ("Use my FITX data"
// is not preselected); "Questions only" is stored as not sharing, only the coach jobs that need no data are offered,
// push to talk explains where speech goes first, and the question sent carries no name or e-mail.
import { readFileSync } from "node:fs";
import path from "node:path";
import { signInUi, textOf } from "./common.mjs";

function providerRequests(outDir, since) {
  try {
    return readFileSync(path.join(outDir, "..", "fake-ollama.jsonl"), "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line)).filter((entry) => entry.at >= since);
  } catch {
    return [];
  }
}

export const flow = {
  id: "06b-ai-coach-consent",
  title: "AI coach consent screen with a local stand-in provider",
  async run(t, { standin, outDir }) {
    const coachUrl = process.env.E2E_COACH_URL;
    if (!coachUrl) {
      t.steps.push({ name: "skipped: E2E_COACH_URL (second app server with the local provider) is not running", status: "skip" });
      return;
    }
    const page = await t.open({ appUrl: coachUrl });
    const since = new Date().toISOString();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "consent" });
    await signInUi(t, account);

    await t.step("the consent screen starts with nothing chosen", async () => {
      await t.goto("/ai-coach", { label: "coach consent" });
      await page.getByRole("heading", { name: "Coaching built on your own numbers" }).waitFor({ timeout: 20000 });
      const share = page.getByRole("radio", { name: /Use my FITX data/ });
      const questions = page.getByRole("radio", { name: /Questions only/ });
      t.expect(!(await share.isChecked()) && !(await questions.isChecked()), "neither choice should be preselected");
      t.expect(await page.getByRole("button", { name: "Start coaching" }).isDisabled(), "Start coaching should wait for a choice");
      t.expect(await page.getByText("Choose how the coach should work to start.").isVisible(), "the screen should ask for a choice");
      const who = await textOf(page.locator("section[aria-labelledby=coach-consent-title]"));
      t.note("consent screen", who.slice(0, 1600));
      t.expect(/Ollama \(this computer\)/.test(who) && /Nothing leaves the machine/.test(who), "the local provider and its data use should be named");
      await t.checkpoint("coach consent screen");
    });

    await t.step("Questions only is stored as not sharing, and a question is answered locally", async () => {
      await page.locator("label").filter({ hasText: "Questions only" }).click();
      await page.getByRole("button", { name: "Start coaching" }).click();
      const message = page.getByLabel("Message", { exact: true });
      await message.waitFor({ timeout: 20000 });
      const consent = await standin.one(`select share_personal_data from public.ai_coach_consents where user_id = '${account.id}'`);
      t.expect(consent?.share_personal_data === "f", "the consent should record that nothing is shared", consent);
      // Questions only: the starting prompts are general ones, never written from the member's data.
      const suggestions = page.getByRole("list", { name: "Suggested questions" });
      await suggestions.waitFor({ timeout: 15000 });
      const suggested = await textOf(suggestions);
      t.note("suggested questions", suggested);
      t.expect(!/Today ·|Last workout|kcal/.test(suggested), "no prompt built from logs with Questions only", suggested);
      await suggestions.getByRole("button").first().click();
      t.expect((await message.inputValue()).length > 0, "a suggestion fills the message box");
      // The coach's jobs: with Questions only, just the ones that need no data, in general wording.
      const skills = page.getByRole("list", { name: "What the coach can do" });
      const skillText = await textOf(skills);
      t.note("coach jobs offered", skillText);
      t.expect(/Exercise help/.test(skillText) && /Recovery check/.test(skillText) && /Daily boost/.test(skillText), "the general jobs are offered", skillText);
      t.expect(!/Plan a workout|Plan my meals|Analyse my progress/.test(skillText), "jobs that need the member's data are not offered with Questions only", skillText);
      await skills.getByRole("button", { name: "Recovery check" }).click();
      t.expect(/when should I see a professional/.test(await message.inputValue()), "a job fills the message box with a general question");
      // Push to talk explains where speech goes before the microphone is used (Chromium has speech recognition).
      const talk = page.getByRole("button", { name: "Hold to talk" });
      if (await talk.isVisible().catch(() => false)) {
        await talk.click();
        const explain = page.getByRole("dialog", { name: "Talk to your coach" });
        await explain.waitFor({ timeout: 5000 });
        t.expect(/FITX receives only the text/.test(await textOf(explain)), "the voice note says FITX gets only the text");
        await t.checkpoint("voice privacy note");
        await explain.getByRole("button", { name: "Not now" }).click();
      } else {
        t.note("voice", "no speech recognition in this browser: no microphone button (as designed)");
      }
      t.expect(/1 AI service ready/.test(await textOf(page.locator("main"))), "the page says which AI services are ready, by name only");
      await t.checkpoint("coach ready");
      await message.fill("How many push-ups should I do as a beginner?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByText("try 3 sets of 8 to 12 push-ups").first().waitFor({ timeout: 30000 });
      await t.checkpoint("coach answered");
      const sent = providerRequests(outDir, since);
      const text = JSON.stringify(sent.map((entry) => entry.body?.messages ?? []));
      t.note("requests to the local provider", sent.map((entry) => ({ path: entry.path, stream: entry.body?.stream, messages: (entry.body?.messages ?? []).map((item) => ({ role: item.role, chars: String(item.content ?? "").length })) })));
      t.expect(sent.length > 0, "the question should reach the local provider");
      t.expect(!text.includes(account.email) && !text.includes("Meera") && !text.includes(account.id), "no name, e-mail or account id should be sent with Questions only");
    });

    await t.step("no request left this machine", async () => {
      const outside = t.blocked.filter((entry) => !/fitx-e2e/.test(entry.url));
      t.note("blocked browser requests", outside);
      t.expect(!outside.some((entry) => /googleapis|groq|openrouter|openai/i.test(entry.url)), "no AI service on the internet should be contacted", outside);
    });
  },
};
