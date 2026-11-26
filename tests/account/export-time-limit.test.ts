// Fix round 3d (open-3c-profile-save-timeout, the same mistake in Settings > Download my data): a request that never
// answered left "Collecting your data…" up, and the button on "Preparing…", until the page was reloaded. The download now
// stops only once a minute passes with no part of the account read (src/components/account/export-wait.ts): a big
// account on a slow connection still gets as long as it needs. Its requests are then cancelled, it says so, and nothing
// is downloaded.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXPORT_STALLED, EXPORT_STALL_LIMIT_MS, ExportStalled, isStalled, unlessStalled } from "@/components/account/export-wait";

const never = () => new Promise<never>(() => {});
const turn = () => new Promise((resolve) => setImmediate(resolve));

describe("Download my data waits while it keeps moving", () => {
  test("no limit on the whole: parts that each come within the limit go on for as long as it takes", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const parts: Array<() => void> = [];
    let signal: AbortSignal | undefined;
    const download = unlessStalled(async (given, progress) => {
      signal = given;
      for (let part = 0; part < 5; part += 1) {
        await new Promise<void>((resolve) => parts.push(resolve));
        progress();
      }
      return "file";
    });
    for (let part = 0; part < 5; part += 1) {
      await turn();
      t.mock.timers.tick(EXPORT_STALL_LIMIT_MS - 1);
      parts[part]();
    }
    assert.equal(await download, "file", "five minutes in all, never a minute without a part");
    assert.equal(signal?.aborted, false);
  });

  test("a minute with nothing new stops it, not before; its requests are cancelled and late progress does nothing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal: AbortSignal | undefined;
    let progressLater: () => void = () => undefined;
    let settled = false;
    const download = unlessStalled((given, progress) => {
      signal = given;
      progressLater = progress;
      return never();
    });
    void download.catch(() => { settled = true; });
    t.mock.timers.tick(EXPORT_STALL_LIMIT_MS - 1);
    await turn();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await assert.rejects(download, (error: unknown) => isStalled(error) && error instanceof ExportStalled && error.ms === EXPORT_STALL_LIMIT_MS);
    assert.equal(signal?.aborted, true, "the requests built with its signal are cancelled");
    progressLater();
    t.mock.timers.tick(EXPORT_STALL_LIMIT_MS);
    assert.equal(isStalled(new Error("other")), false);
  });

  test("an export that ends in time, or fails in time, gives its own outcome", async () => {
    assert.equal(await unlessStalled(async () => 7), 7);
    await assert.rejects(unlessStalled(async () => { throw new Error("We couldn't read your food log"); }), /food log/);
  });

  test("the message is plain and says nothing was downloaded", () => {
    assert.equal(EXPORT_STALL_LIMIT_MS, 60_000);
    assert.match(EXPORT_STALLED, /^Collecting your data is taking too long, so we stopped waiting\. Nothing was downloaded\. Check your connection and try again\.$/);
  });

  test("Settings uses it: the requests carry the signal, and nothing is downloaded after it stopped waiting", () => {
    const data = readFileSync(new URL("../../src/app/(dashboard)/settings/SettingsData.tsx", import.meta.url), "utf8");
    assert.match(data, /await unlessStalled\(async \(signal, progress\) => \{/);
    assert.match(data, /const data = await exportAccountData\(withAbortSignal\(supabase, signal\), user, \{/);
    assert.match(data, /onProgress: \(\{ done, total, label \}\) => \{\s*if \(signal\.aborted\) return;\s*progress\(\);/);
    assert.match(data, /\/\/ Finished only after it stopped waiting[^\n]*\n\s*if \(signal\.aborted\) return;\s*const name = exportFileName\(\);/);
    assert.match(data, /if \(isStalled\(error\)\) return setState\(\{ kind: "error", text: EXPORT_STALLED \}\);/);
    assert.match(data, /const \{ state: session, user \} = await checkSession<User>\(\(\) => supabase\.auth\.getUser\(\)\);\s*if \(signal\.aborted\) return;/, "the sign-in check is inside the limit too");
  });
});
