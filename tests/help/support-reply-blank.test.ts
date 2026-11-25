// Bug 47 (coach-help-4): a Help reply of only spaces did nothing when Send reply was pressed: the browser's required
// check passed and the form returned silently. The form now says the server's own rule, next to the box, marks the box
// and keeps focus in it; an empty box gets the same words. Sending keeps focus on the button (aria-disabled).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { replyTextProblem, validateSupportReply } from "@/components/support/support-rules";

const read = (file: string) => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
const REQUEST = "9f1c2b3a-1111-4222-8333-444455556666";

describe("a reply of only spaces", () => {
  test("gets the server's own rule, as an empty one does", () => {
    for (const blank of ["", "   ", "\n\t \n", "\u0000 "]) assert.equal(replyTextProblem(blank), "Write 1 to 4,000 characters.", JSON.stringify(blank));
    assert.equal(replyTextProblem("Only when the screen locks."), null);
    assert.equal(replyTextProblem("x".repeat(4001)), "Write 1 to 4,000 characters.");
    assert.equal(replyTextProblem("😀".repeat(4000)), null, "characters, not UTF-16 units");
  });

  test("the route's check is the same rule", () => {
    assert.deepEqual(validateSupportReply({ requestId: REQUEST, body: "   " }), { ok: false, error: "Write 1 to 4,000 characters." });
    assert.deepEqual(validateSupportReply({ requestId: REQUEST, body: "  Yes, it still stops.  " }), { ok: true, value: { requestId: REQUEST, body: "Yes, it still stops." } });
  });

  test("the reply form says so next to the box, marks it and keeps focus there", () => {
    const threads = read("components/support/SupportThreads.tsx");
    assert.doesNotMatch(threads, /if \(!body\) return;/, "no silent return");
    assert.match(threads, /const problem = replyTextProblem\(typed\);\n\s+if \(problem\) \{\n\s+setError\(problem\);\n\s+setInvalid\(true\);\n\s+box\.current\?\.focus\(\);/);
    assert.match(threads, /<form onSubmit=\{submit\} noValidate/, "the empty box gets the same words, not the browser's bubble");
    assert.match(threads, /aria-invalid=\{invalid \|\| undefined\}/);
    assert.match(threads, /aria-describedby=\{error \? errorId : undefined\}/);
    assert.match(threads, /<p id=\{errorId\} role="alert"/);
  });

  test("Send reply and Send message keep focus while sending", () => {
    for (const file of ["components/support/SupportThreads.tsx", "components/support/SupportForm.tsx"]) {
      const form = read(file);
      assert.match(form, /aria-disabled=\{pending \|\| undefined\}/, file);
      assert.match(form, /if \(pending\) return;/, file);
      assert.doesNotMatch(form, /disabled=\{pending\}/, file);
    }
    assert.match(read("components/support/SupportThreads.tsx"), /fitx-button fitx-button-secondary min-h-11/, "a 44 px target");
  });
});
