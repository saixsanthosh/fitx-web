// Flow 6: the AI coach with no provider keys. The page says honestly that the coach is not switched on, no
// conversation or consent can start, the coach APIs refuse the same way, and no request leaves this machine
// (neither from the browser nor from the app server).
import { readFileSync } from "node:fs";
import path from "node:path";
import { signInUi, textOf } from "./common.mjs";

const AI_HOSTS = /generativelanguage\.googleapis\.com|api\.groq\.com|api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai|api\.cerebras\.ai|api\.mistral\.ai|openrouter\.ai|api\.openai\.com|anthropic|ollama/i;

function outboundSince(outDir, since) {
  try {
    return readFileSync(path.join(outDir, "..", "server-outbound.jsonl"), "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line)).filter((entry) => entry.at >= since);
  } catch {
    return [];
  }
}

export const flow = {
  id: "06-ai-coach",
  title: "AI coach without provider keys",
  async run(t, { standin, outDir }) {
    const page = await t.open();
    const since = new Date().toISOString();
    const account = await standin.createAccount({ name: "Meera Iyer", tag: "coach" });
    await signInUi(t, account);

    await t.step("the coach page says it is not switched on", async () => {
      await t.goto("/ai-coach", { label: "ai coach" });
      const panel = page.locator("section[aria-labelledby=coach-unavailable-title]");
      await panel.waitFor({ timeout: 15000 });
      const text = await textOf(panel);
      t.note("coach panel", text);
      t.expect(/isn.t switched on yet/.test(text), `expected the honest not-switched-on state, got: ${text}`);
      t.expect((await page.getByRole("textbox").count()) === 0, "no message box should be offered");
      t.expect((await page.getByText("Use my FITX data").count()) === 0, "the consent screen is not shown while no AI service is set up");
      await t.checkpoint("ai coach not switched on");
    });

    await t.step("the coach APIs refuse the same way", async () => {
      const answers = await page.evaluate(async () => {
        const call = async (url, init) => {
          const response = await fetch(url, { credentials: "same-origin", ...init });
          let body = null;
          try { body = await response.json(); } catch { body = null; }
          return { url, status: response.status, body };
        };
        return [
          await call("/api/coach/status"),
          await call("/api/coach/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Plan my meals for today", task: "chat" }) }),
          await call("/api/coach/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ shareData: true }) }),
        ];
      });
      t.note("coach API answers", answers);
      const [status, chat, consent] = answers;
      t.expect(status.status < 500, `status endpoint failed with ${status.status}`, status);
      t.expect(chat.status >= 400, `chat should be refused without a provider (got ${chat.status})`, chat);
      const messages = await standin.one(`select count(*)::int n from public.ai_coach_messages where user_id = '${account.id}'`);
      t.expect(messages.n === "0", "no coach message should be stored", messages);
      t.answers = { chat, consent };
    });

    await t.step("the APIs say 'not set up' rather than asking for consent (API only)", async () => {
      const { chat, consent } = t.answers;
      const stored = await standin.one(`select share_personal_data from public.ai_coach_consents where user_id = '${account.id}'`);
      t.note("consent row after POST /api/coach/consent", stored);
      t.expect(chat.body?.error?.code === "not_configured", `chat answered ${chat.status} ${chat.body?.error?.code} instead of not_configured`, chat);
      t.expect(consent.status >= 400 && !stored, `consent was stored (HTTP ${consent.status}, share_personal_data=${stored?.share_personal_data}) although no AI service is set up and no consent screen was shown`, consent);
    }, { soft: true });

    await t.step("no request left this machine", async () => {
      const browserAi = t.blocked.filter((entry) => AI_HOSTS.test(entry.url));
      const serverAi = outboundSince(outDir, since).filter((entry) => AI_HOSTS.test(entry.target));
      t.note("blocked browser requests during the flow", t.blocked);
      t.expect(!browserAi.length, "the browser should not try any AI service", browserAi);
      t.expect(!serverAi.length, "the app server should not try any AI service", serverAi);
    });
  },
};
