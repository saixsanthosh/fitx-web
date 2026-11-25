// Bug 43 (public-4): password sign-up with an address that already had an account said only "We couldn't create your
// account. Check your details and try again." (Supabase had answered 422 user_already_exists, so no retry could work),
// with no link to sign in or to reset the password. Every refusal now says what happened and what to do next; an
// existing account gets "Sign in instead, or reset your password" with links. Where Supabase sends confirmation emails it
// answers an existing address with no error and sends nothing, so the "Check your email" view says what to do then, to
// everyone, revealing no more than Supabase's own answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signUpProblem } from "@/lib/auth/email-code";
import { SUSPENDED_MESSAGE } from "@/lib/platform/account-status";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("an address that already has an account is told so, with its ways on", () => {
  const exists = signUpProblem({ status: 422, code: "user_already_exists", message: "User already registered" });
  assert.deepEqual(exists, { message: "That email may already have a FITX account.", field: null, existingAccount: true });
  assert.equal(signUpProblem({ status: 422, message: "User already registered" }).existingAccount, true, "older Auth, no code");
  assert.equal(signUpProblem({ status: 422, code: "email_exists", message: "A user with this email address has already been registered" }).existingAccount, true);
});

test("a password Auth refuses is a problem with the password field", () => {
  assert.deepEqual(signUpProblem({ status: 422, code: "weak_password", message: "Password is known to be weak", reasons: ["pwned"] }), {
    message: "That password has appeared in a data breach elsewhere. Choose a different one.",
    field: "password",
    existingAccount: false,
  });
  assert.match(signUpProblem({ status: 422, code: "weak_password", message: "Password should contain…", reasons: ["characters"] }).message, /mix of letters, numbers and symbols/);
  assert.deepEqual(signUpProblem({ status: 422, code: "weak_password", message: "Password should be at least 10 characters.", reasons: ["length"] }), {
    message: "Choose a longer password.",
    field: "password",
    existingAccount: false,
  });
  assert.equal(signUpProblem({ status: 422, message: "Password should be at least 6 characters." }).field, "password", "older Auth, no code");
});

test("every other refusal says what to do, and none says to check details a retry can't fix", () => {
  const cases: Array<[error: Parameters<typeof signUpProblem>[0], message: RegExp, field: "email" | "password" | null]> = [
    [{ status: 429, code: "over_email_send_rate_limit", message: "Email rate limit exceeded" }, /^Too many sign-up attempts\. Wait a few minutes, then try again\.$/, null],
    [{ status: 400, code: "email_address_invalid", message: "Email address \"x@y.z\" is invalid" }, /^Check the email address and try again\.$/, "email"],
    [{ status: 422, code: "signup_disabled", message: "Signups not allowed for this instance" }, /^New accounts can’t be created right now\./, null],
    [{ status: 400, code: "email_provider_disabled", message: "Email signups are disabled" }, /Use Google\.$/, null],
    [{ status: 400, code: "user_banned", message: "User is banned" }, new RegExp(`^${SUSPENDED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), null],
    [{ status: 500, message: "boom" }, /^We couldn’t create your account\. Please try again\.$/, null],
    [null, /^We couldn’t create your account\. Please try again\.$/, null],
  ];
  for (const [error, message, field] of cases) {
    const problem = signUpProblem(error);
    assert.match(problem.message, message, JSON.stringify(error));
    assert.equal(problem.field, field, JSON.stringify(error));
    assert.equal(problem.existingAccount, false, JSON.stringify(error));
    assert.doesNotMatch(problem.message, /check your details/i);
  }
});

test("the sign-up page shows the refusal where it belongs, with sign-in and a reset beside an existing account", () => {
  const form = read("src/app/(auth)/signup/SignUpForm.tsx");
  assert.match(form, /const refused = signUpProblem\(authError\);\s*if \(refused\.field\) showProblem\(\{ field: refused\.field, message: refused\.message \}\);\s*else setFailure\(\{ message: refused\.message, existingAccount: refused\.existingAccount \}\);\s*setPending\(null\);/);
  assert.match(form, /\{failure\?\.existingAccount && \(\s*<>\s*\{" "\}<Link href="\/signin" className=\{s\.inlineLink\}>Sign in<\/Link> instead, or\{" "\}\s*<Link href="\/forgot-password" className=\{s\.inlineLink\}>reset your password<\/Link>\./);
  // The confirmation view tells everyone what to do if the address already had an account (it was sent nothing).
  assert.match(form, /If <strong>\{email\.trim\(\)\}<\/strong> is new to FITX, a link to finish is on its way\. If it already has a FITX account, sign in\s*instead, or <Link href="\/forgot-password" className=\{s\.inlineLink\}>reset your password<\/Link>\./);
  for (const file of ["src/app/(auth)/signup/SignUpForm.tsx", "src/app/(auth)/signin/SignInForm.tsx", "src/lib/auth/email-code.ts"]) {
    assert.doesNotMatch(read(file), /Check your details/, file);
  }
});
