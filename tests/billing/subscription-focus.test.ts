// Bug 86's mistake on the Subscription page (review round of the coach stream, which owns the page): a pressed control
// went, or turned disabled, and keyboard focus fell to the page. "Keep subscription" removed the question with the
// button in it, "Yes, cancel renewal" and "Subscribe" were disabled while they worked, and after the cancellation the
// cancel controls went. Focus now stays or moves to the control that takes their place (BRIEF-3 D5). Source checks:
// the test runner has no DOM.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../../src/app/(dashboard)/subscription/SubscriptionPanel.tsx", import.meta.url), "utf8");

describe("Subscription page focus", () => {
  test("Keep subscription gives focus back to Cancel subscription", () => {
    assert.match(panel, /onKeep=\{\(\) => \{\n\s+if \(cancelling\) return;\n\s+\/\/ [^\n]*\n\s+flushSync\(\(\) => setConfirmingCancel\(false\)\);\n\s+askCancelRef\.current\?\.focus\(\);/);
    assert.match(panel, /<button ref=\{askRef\} type="button" className="fitx-button fitx-button-quiet min-h-11" onClick=\{onAskCancel\}>\n\s+Cancel subscription/);
    // Opening the question still puts focus on Keep subscription, the choice that changes nothing.
    assert.match(panel, /if \(confirmingCancel\) keepSubscriptionRef\.current\?\.focus\(\);/);
  });

  test("the cancel buttons and Subscribe stay focusable while they work, and a second press does nothing", () => {
    assert.doesNotMatch(panel, /disabled=\{cancelling\}|disabled=\{busy\}/);
    assert.match(panel, /onClick=\{onCancel\} aria-disabled=\{cancelling \|\| undefined\}/);
    assert.match(panel, /onClick=\{onKeep\} aria-disabled=\{cancelling \|\| undefined\}/);
    assert.match(panel, /async function cancel\(\) \{\n\s+\/\/ [^\n]*\n\s+if \(cancelling\) return;/);
    assert.match(panel, /onClick=\{\(\) => void subscribe\(plan\)\}\n\s+aria-disabled=\{busy \|\| undefined\}/);
    assert.match(panel, /async function subscribe\(plan: PlanView\) \{\n(\s+\/\/ [^\n]*\n)+\s+if \(busy\) return;/);
    // busy is worked out before the handlers that read it.
    assert.ok(panel.indexOf("const busy = ") < panel.indexOf("async function subscribe("));
  });

  test("once the cancellation went through (or there was nothing to cancel), focus moves to the subscription's heading", () => {
    assert.match(panel, /subscriptionHeading\.current\?\.focus\(\);\n\s+setConfirmingCancel\(false\);\n\s+\/\/ [^\n]*\n\s+setPhase\(\{ kind: "idle" \}\);/);
    assert.match(panel, /"nothing_to_cancel"\) \{\n\s+subscriptionHeading\.current\?\.focus\(\);\n\s+setConfirmingCancel\(false\);/);
    assert.match(panel, /<h2 ref=\{headingRef\} tabIndex=\{-1\} id="current-subscription"/);
    // The result is read from the status region under the subscription.
    assert.match(panel, /<div aria-live="polite" role="status">/);
  });
});
