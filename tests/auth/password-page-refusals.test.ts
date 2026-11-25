// The same mistake as bug 43, on the password pages: forgot password said "We couldn't send a reset link. Please try
// again." for every refusal but a rate limit, and the new-password form "We couldn't update your password." for any
// password Auth refused as weak, although no retry could fix either. Each now says what happened and what to do, and a
// problem with a field (a refused address, a weak or reused password) goes under that field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newPasswordRefusal, resetLinkProblem, weakPasswordMessage } from "@/lib/auth/email-code";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("a reset link refused for the address is a problem with the email field; a fresh one still works", () => {
  assert.deepEqual(resetLinkProblem({ status: 400, code: "email_address_invalid", message: "Email address \"a@b\" is invalid" }), { message: "Check the email address and try again.", field: "email" });
  assert.deepEqual(resetLinkProblem({ status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 52 seconds." }), {
    message: "A link was sent a moment ago. Wait a minute, then try again.",
    field: null,
  });
  assert.deepEqual(resetLinkProblem({ status: 429, message: "Email rate limit exceeded" }).field, null);
  assert.deepEqual(resetLinkProblem({ status: 500, message: "boom" }), { message: "We couldn’t send a reset link. Please try again.", field: null });
});

test("a refused new password says why: an expired link, one used before, one too weak", () => {
  assert.deepEqual(newPasswordRefusal({ status: 401, message: "Auth session missing!" }), { message: "This reset link has expired. Ask for a new one.", field: null });
  assert.deepEqual(newPasswordRefusal({ status: 403, code: "session_not_found", message: "Session from session_id claim in JWT does not exist" }).field, null);
  assert.deepEqual(newPasswordRefusal({ status: 422, code: "same_password", message: "New password should be different from the old password." }), {
    message: "Choose a password you haven’t used here before.",
    field: "password",
  });
  assert.deepEqual(newPasswordRefusal({ status: 422, code: "weak_password", message: "Password is known to be weak and easy to guess", reasons: ["pwned"] }), {
    message: "That password has appeared in a data breach elsewhere. Choose a different one.",
    field: "password",
  });
  assert.equal(newPasswordRefusal({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }).message, "Too many tries. Wait a few minutes, then try again.");
  assert.deepEqual(newPasswordRefusal({ status: 500, message: "boom" }), { message: "We couldn’t update your password. Please try again.", field: null });
});

test("Auth's weak-password answers are told apart by their reasons", () => {
  assert.equal(weakPasswordMessage({ code: "weak_password", reasons: ["length"] }), "Choose a longer password.");
  assert.match(weakPasswordMessage({ code: "weak_password", reasons: ["characters"] }) ?? "", /mix of letters, numbers and symbols/);
  assert.match(weakPasswordMessage({ code: "weak_password", reasons: ["length", "pwned"] }) ?? "", /data breach/, "a leaked password is the reason to give first");
  assert.equal(weakPasswordMessage({ message: "Password should be at least 6 characters." }), "Choose a longer password.", "older Auth, no code");
  assert.equal(weakPasswordMessage({ code: "same_password", message: "New password should be different from the old password." }), null);
  assert.equal(weakPasswordMessage(null), null);
});

test("the password pages put a field's problem under the field and focus it, and the rest under the button", () => {
  const forgot = read("src/app/(auth)/forgot-password/page.tsx");
  assert.match(forgot, /const refused = resetLinkProblem\(resetError\);\s*if \(refused\.field\) \{\s*setFieldProblem\(\{ field: refused\.field, message: refused\.message \}\);\s*emailInput\.current\?\.focus\(\{ preventScroll: true \}\);\s*\} else setError\(refused\.message\);/);
  const reset = read("src/app/(auth)/reset-password/page.tsx");
  assert.match(reset, /const refused = newPasswordRefusal\(updateError\);\s*if \(refused\.field\) \{\s*setFieldProblem\(\{ field: refused\.field, message: refused\.message \}\);\s*passwordInput\.current\?\.focus\(\);\s*\} else setError\(refused\.message\);/);
  assert.doesNotMatch(reset, /\/session\|jwt\|not authenticated\/i\.test/, "the mapping lives in one tested place");
});
