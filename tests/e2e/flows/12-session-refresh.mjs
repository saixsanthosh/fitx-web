// Flow 12: staying signed in while access tokens expire and refresh. Runs only when the stand-in issues
// short-lived tokens (E2E_ACCESS_TTL of 300 s or less): two tabs of one browser keep moving between app pages
// for about three token lifetimes, so the browser client, the proxy and both tabs all refresh the session.
// Nobody may land on the sign-in page, and Supabase Auth must never see a refresh token reused outside its
// grace period (which ends the whole session, as on Supabase).
import { readFileSync } from "node:fs";
import path from "node:path";
import { signInUi } from "./common.mjs";

const PAGES = ["/dashboard", "/workouts", "/nutrition", "/progress?panel=goals", "/activity", "/settings", "/progress", "/help"];

function authLog(outDir, since) {
  try {
    return readFileSync(path.join(outDir, "..", "standin-requests.jsonl"), "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line)).filter((entry) => entry.at >= since && entry.path.startsWith("/auth/v1/"));
  } catch {
    return [];
  }
}

export const flow = {
  id: "12-session-refresh",
  title: "Staying signed in across token refreshes (two tabs)",
  sizes: ["phone"],
  schemes: () => ["light"],
  async run(t, { standin, outDir }) {
    const ttl = Number(process.env.E2E_ACCESS_TTL ?? 3600);
    if (!(ttl <= 300)) {
      t.steps.push({ name: `skipped: needs short-lived tokens (E2E_ACCESS_TTL=${ttl}; run with E2E_ACCESS_TTL=60)`, status: "skip" });
      return;
    }
    const page = await t.open();
    const since = new Date().toISOString();
    const account = await standin.createAccount({ name: "Session Keeper", tag: "session" });
    await signInUi(t, account);
    const second = await t.context.newPage();
    t.instrument(second);
    await second.goto("/progress?panel=goals");

    await t.step(`two tabs stay signed in for ${Math.round((ttl * 3 + 30) / 60)} minutes of refreshes`, async () => {
      const until = Date.now() + (ttl * 3 + 30) * 1000;
      const visits = [];
      let index = 0;
      while (Date.now() < until) {
        const tab = index % 2 === 0 ? page : second;
        const target = PAGES[index % PAGES.length];
        if (index % 3 === 0) await tab.reload({ waitUntil: "load" });
        else await tab.goto(target, { waitUntil: "load" });
        const landed = new URL(tab.url()).pathname;
        visits.push(`${Math.round((until - Date.now()) / 1000)}s left: tab ${index % 2 + 1} ${landed}`);
        if (landed === "/signin") {
          t.note("visits", visits);
          throw new Error(`tab ${index % 2 + 1} was signed out at ${target} after ${visits.length} visits`);
        }
        index += 1;
        await tab.waitForTimeout(7000);
      }
      const log = authLog(outDir, since);
      const refreshes = log.filter((entry) => entry.path.includes("grant_type=refresh_token"));
      const failures = log.filter((entry) => entry.status >= 400);
      t.note("auth traffic", { visits: visits.length, refreshes: refreshes.length, failures: failures.map((entry) => `${entry.at} ${entry.method} ${entry.path.split("?")[0]} ${entry.status} ${entry.code ?? ""}`) });
      t.expect(refreshes.length >= 2, `the session should have refreshed during the run (${refreshes.length} refreshes)`);
      t.expect(!failures.some((entry) => entry.code === "refresh_token_already_used"), "no refresh token may be reused outside the grace period", failures);
      await t.checkpoint("still signed in after refreshes");
    });
  },
};
