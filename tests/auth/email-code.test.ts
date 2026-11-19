import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_LENGTH,
  RESEND_SECONDS,
  formatCountdown,
  isCompleteCode,
  isEmailAddress,
  normaliseCode,
  retryAfterSeconds,
  sendCodeProblem,
  verifyCodeProblem,
} from "@/lib/auth/email-code";

test("codes are six digits and wait a minute between sends", () => {
  assert.equal(CODE_LENGTH, 6);
  assert.equal(RESEND_SECONDS, 60);
});

test("pasted codes keep their digits only, at most six", () => {
  assert.equal(normaliseCode("123456"), "123456");
  assert.equal(normaliseCode("123 456"), "123456");
  assert.equal(normaliseCode("123-456"), "123456");
  assert.equal(normaliseCode(" Your FITX code is 042917. "), "042917");
  assert.equal(normaliseCode("1234567890"), "123456");
  assert.equal(normaliseCode("12a3"), "123");
  assert.equal(normaliseCode("abc"), "");
  assert.equal(normaliseCode("１２３"), "", "full-width digits are not ASCII digits and are dropped, never guessed");
});

test("a code is complete only with exactly six digits", () => {
  assert.equal(isCompleteCode("042917"), true);
  assert.equal(isCompleteCode("04291"), false);
  assert.equal(isCompleteCode("0429171"), false);
  assert.equal(isCompleteCode("04291a"), false);
});

test("email addresses need a name, an @ and a domain", () => {
  assert.equal(isEmailAddress("asha@fitx.test"), true);
  assert.equal(isEmailAddress("  asha@fitx.test "), true);
  for (const value of ["", "asha", "asha@", "asha@fitx", "a b@fitx.test"]) assert.equal(isEmailAddress(value), false, value);
});

test("reads Supabase's wait from its rate-limit message", () => {
  assert.equal(retryAfterSeconds("For security purposes, you can only request this after 37 seconds."), 37);
  assert.equal(retryAfterSeconds("For security purposes, you can only request this after 1 second."), 1);
  assert.equal(retryAfterSeconds("Email rate limit exceeded"), null);
  assert.equal(retryAfterSeconds(undefined), null);
  assert.equal(retryAfterSeconds("after 99999 seconds"), null, "five digits is not a wait Supabase sends");
});

test("countdowns read as minutes and seconds", () => {
  assert.equal(formatCountdown(60), "1:00");
  assert.equal(formatCountdown(42), "0:42");
  assert.equal(formatCountdown(5.2), "0:06");
  assert.equal(formatCountdown(-3), "0:00");
});

test("explains each way sending a code can fail", () => {
  const wait = sendCodeProblem({ status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 41 seconds." });
  assert.equal(wait.retryAfter, 41);
  assert.match(wait.message, /sent a moment ago/);
  const capped = sendCodeProblem({ status: 429, code: "over_email_send_rate_limit", message: "Email rate limit exceeded" });
  assert.equal(capped.retryAfter, null);
  assert.match(capped.message, /Too many codes/);
  assert.match(sendCodeProblem({ status: 400, code: "validation_failed", message: "Unable to validate email address: invalid format" }).message, /Check the email address/);
  assert.match(sendCodeProblem({ status: 422, code: "otp_disabled", message: "Signups not allowed for otp" }).message, /Use Google or your password/);
  assert.match(sendCodeProblem({ status: 400, code: "email_provider_disabled", message: "Email logins are disabled" }).message, /turned off/);
  assert.equal(sendCodeProblem({ status: 500, message: "boom" }).message, "We couldn’t send a code. Please try again.");
  assert.equal(sendCodeProblem(null).retryAfter, null);
});

test("explains a wrong, expired or rate-limited code without saying which", () => {
  assert.match(verifyCodeProblem({ status: 403, code: "otp_expired", message: "Token has expired or is invalid" }), /wrong or has expired/);
  assert.match(verifyCodeProblem({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" }), /Too many tries/);
  assert.equal(verifyCodeProblem({ status: 500, message: "boom" }), "We couldn’t check that code. Please try again.");
});
