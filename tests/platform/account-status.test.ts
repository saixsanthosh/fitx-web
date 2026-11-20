import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAND } from "@/config/brand";
import { isSuspendedError, SUSPENDED_MESSAGE } from "@/lib/platform/account-status";

test("Supabase's user_banned is recognised in every shape sign-in meets it", () => {
  assert.equal(isSuspendedError({ name: "AuthApiError", code: "user_banned", status: 400, message: "User is banned" }), true);
  assert.equal(isSuspendedError({ error_code: "user_banned" }), true);
  assert.equal(isSuspendedError("user_banned"), true);
  assert.equal(isSuspendedError("?error=access_denied&error_code=user_banned&error_description=User+is+banned"), true);
  assert.equal(isSuspendedError(new URLSearchParams("error_code=user_banned")), true);
  for (const other of [null, undefined, "", "otp_expired", { code: "invalid_credentials" }, "error_code=otp_expired", new URLSearchParams("x=1"), 42]) {
    assert.equal(isSuspendedError(other), false, String(other));
  }
});

test("the message names the support email from the brand", () => {
  assert.equal(SUSPENDED_MESSAGE, `This account is suspended. Email ${BRAND.supportEmail} if you think this is a mistake.`);
});
