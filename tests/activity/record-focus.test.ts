// Release 3 fix round 3c (open item from round 3a, D5): on the Record screen, Lock swaps the recording controls for
// "Hold to unlock" and unlocking swaps them back, and "Allow location" gives way to Start: each swap removed the
// focused control and dropped focus to the page. A sport page's figures Try again went the same way once the figures
// loaded. Focus now moves to the control that took the pressed one's place (record-focus.ts), and a key still held
// from that press never presses the control focus moved to.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusAfterSwap, ignoreHeldKey, isHeldKeyRepeat, type RecordScreenState } from "@/lib/activity/record-focus";

const read = (file: string) => readFileSync(file, "utf8");
const state = (overrides: Partial<RecordScreenState> = {}): RecordScreenState => ({
  phase: "recording", locked: false, needsPermission: false, startUsable: false, reasonShown: false, ...overrides,
});

describe("which control takes focus after a swap", () => {
  test("Lock hands focus to Hold to unlock, and the hold back to Lock", () => {
    assert.equal(focusAfterSwap("locked", state({ locked: true })), "unlock");
    assert.equal(focusAfterSwap("unlocked", state({ locked: false })), "lock", "Lock and Hold to unlock are one control's two states");
    // Paused is never locked (Lock is offered only while recording); were it so, focus would go to Resume.
    assert.equal(focusAfterSwap("unlocked", state({ phase: "paused" })), "main");
    // Recording stopped meanwhile (finished, discarded): nothing took the pressed control's place.
    assert.equal(focusAfterSwap("locked", state({ phase: "finished", locked: true })), null);
    assert.equal(focusAfterSwap("unlocked", state({ phase: "finished" })), null);
    assert.equal(focusAfterSwap("unlocked", state({ locked: true })), null, "still locked: the hold didn't finish");
  });

  test("Allow location hands focus to Start, or to the note saying why Start can't be pressed", () => {
    const asked = state({ phase: "locating", needsPermission: false, startUsable: true });
    assert.equal(focusAfterSwap("allowed", asked), "start");
    // Insecure page or no geolocation (said at once by the press), or a recording in another tab: Start is disabled.
    assert.equal(focusAfterSwap("allowed", state({ phase: "idle", startUsable: false, reasonShown: true })), "reason");
    // Nothing changed yet: Allow location is still there, with focus.
    assert.equal(focusAfterSwap("allowed", state({ phase: "idle", needsPermission: true })), null);
    assert.equal(focusAfterSwap("allowed", state({ phase: "idle", startUsable: false, reasonShown: false })), null);
    // Allow location went because a restored recording was resumed: Pause takes focus (round 3a), not a Start that isn't there.
    assert.equal(focusAfterSwap("allowed", state({ phase: "recording", startUsable: true })), null);
    assert.equal(focusAfterSwap("allowed", state({ phase: "finished", startUsable: true })), null);
  });

  test("Start, then location blocked at the browser's prompt: focus goes to the banner that says why", () => {
    assert.equal(focusAfterSwap("blocked", state({ phase: "idle", startUsable: false, reasonShown: true })), "reason");
    assert.equal(focusAfterSwap("blocked", state({ phase: "idle", startUsable: true, reasonShown: true })), null, "Start can still be pressed");
    assert.equal(focusAfterSwap("blocked", state({ phase: "idle", startUsable: false, reasonShown: false })), null);
  });
});

describe("a key held from the press that moved focus", () => {
  test("its repeats are ignored by the control focus moved to; a fresh press is not", () => {
    assert.equal(isHeldKeyRepeat({ key: "Enter", repeat: true }), true);
    assert.equal(isHeldKeyRepeat({ key: " ", repeat: true }), true);
    assert.equal(isHeldKeyRepeat({ key: "Enter", repeat: false }), false);
    assert.equal(isHeldKeyRepeat({ key: " ", repeat: false }), false);
    assert.equal(isHeldKeyRepeat({ key: "Tab", repeat: true }), false, "moving on with a held Tab still works");
    const pressed = (key: string, repeat: boolean) => {
      let prevented = false;
      ignoreHeldKey({ key, repeat, preventDefault: () => { prevented = true; } });
      return prevented;
    };
    // Cancelling the repeated keydown stops Enter's press (no keypress follows) and Space's (no :active, no click on
    // release).
    assert.equal(pressed("Enter", true), true);
    assert.equal(pressed(" ", true), true);
    assert.equal(pressed("Enter", false), false);
  });
});

describe("the Record screen", () => {
  const screen = read("src/components/activity/ActivityRecorderScreen.tsx");

  test("Lock and the hold mark the swap, and the effect hands focus on once it is drawn", () => {
    assert.match(screen, /label="Lock"[^\n]*onClick=\{\(\) => \{ lockPressed\.current = true; setLocked\(true\);[^\n]*buttonRef=\{lockRef\}/);
    assert.match(screen, /<UnlockButton buttonRef=\{unlockRef\} onUnlock=\{\(\) => \{ lockPressed\.current = true; setLocked\(false\);/);
    assert.match(screen, /if \(!lockPressed\.current\) return;\s+lockPressed\.current = false;\s+if \(!focusDropped\(document\)\) return;[\s\S]*?controlFor\(focusAfterSwap\(locked \? "locked" : "unlocked", state\), \{ unlock: unlockRef, lock: lockRef, main: mainControlRef, start: startRef, reason: blocking \? issueRef : elsewhereRef \}\)\?\.focus\(\);\s+\}, \[locked,/);
    assert.match(read("src/components/activity/RecordingExtras.tsx"), /export function UnlockButton\(\{ onUnlock, buttonRef \}[\s\S]*?<button\s+type="button"\s+ref=\{buttonRef\}\s+aria-label="Hold to unlock controls"/);
  });

  test("Allow location: once it goes (focus dropped with it), Start takes focus in its place", () => {
    // The click itself is unchanged (the privacy page's test reads it): the swap is seen when Allow location goes.
    assert.match(screen, /onClick=\{\(\) => recorder\?\.warmUp\(\)\}[^>]*>Allow location<\/button>/);
    assert.match(screen, /const asked = askedForLocation\.current;\s+askedForLocation\.current = needsPermission;\s+if \(!asked \|\| needsPermission \|\| !focusDropped\(document\)\) return;[\s\S]*?const target = focusAfterSwap\("allowed", state\);\s+controlFor\(target, [^\n]*\)\?\.focus\(\{ preventScroll: target === "start" \}\);\s+\}, \[needsPermission,/);
    assert.match(screen, /<button type="button" ref=\{startRef\} disabled=\{blocking \|\| !recorder \|\| snapshot\.elsewhere\}[^\n]*onKeyDown=\{ignoreHeldKey\}/);
    // The notes Start can hand focus to when it can't be pressed.
    assert.match(screen, /<div ref=\{issueRef\} tabIndex=\{-1\} role=\{blocking \? "alert" : "status"\}/);
    assert.match(screen, /<p ref=\{elsewhereRef\} tabIndex=\{-1\} role="status"/);
  });

  test("location blocked while Start has focus: to the banner, never when the screen opens blocked or from elsewhere", () => {
    assert.match(screen, /const before = wasBlocking\.current;\s+wasBlocking\.current = ready \? blocking : null;\s+if \(before !== false \|\| !blocking \|\| !startRef\.current \|\| !mayHandFocus\(document, startRef\.current\)\) return;/);
  });

  test("what location allows is worked out before the early returns, so the hand-offs can read it", () => {
    const returns = screen.indexOf('if (account.status === "loading" || (account.status === "ready" && !snapshot))');
    for (const name of ["blocking", "needsPermission", "startUsable", "reasonShown"]) {
      const at = screen.indexOf(`const ${name} =`);
      assert.ok(at > 0 && at < returns, name);
      assert.equal(screen.split(`const ${name} =`).length, 2, `${name} is worked out once`);
    }
  });

  test("buttons that take focus from a press ignore a key still held from it", () => {
    assert.match(screen, /<button type="button" ref=\{buttonRef\} onClick=\{onClick\} onKeyDown=\{ignoreHeldKey\}/, "Lock, Pause, Resume, Finish, Discard");
    assert.equal((screen.match(/ref=\{focusOnMount\} onClick=\{cancelConfirm\} onKeyDown=\{ignoreHeldKey\}/g) ?? []).length, 3, "Keep going and Keep it");
  });
});

test("a sport page: Try again stays focusable while it reloads, and focus moves to the figures once they load", () => {
  const sport = read("src/components/activity/SportScreen.tsx");
  assert.match(sport, /onClick=\{\(\) => void retryFigures\(\)\} aria-disabled=\{retrying \|\| undefined\}/);
  assert.match(sport, /async function retryFigures\(\) \{\s+if \(!userId \|\| retrying\) return;\s+refocusFigures\.current = true;\s+setRetrying\(true\);/);
  // Round 3d: the same hand-off also serves figures that came back by themselves (tests/activity/reload-focus.test.ts).
  assert.match(sport, /if \(retrying\) return;\s+const pressed = refocusFigures\.current;\s+refocusFigures\.current = false;\s+const wentWithFocus = figuresRetryWent\(\);\s+if \(statsStatus === "ready" && handsFocusOn\(document, \{ pressed, wentWithFocus \}\)\) figuresRef\.current\?\.focus\(\);/);
  assert.match(sport, /<section ref=\{figuresRef\} tabIndex=\{-1\} aria-label=\{`\$\{SPORT_LABEL\[sport\]\} statistics`\}/);
  // The hooks come before the page's early returns.
  assert.ok(sport.indexOf("const [retrying, setRetrying]") < sport.indexOf('if (account.status === "loading")'));
});
