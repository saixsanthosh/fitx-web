// Bug 45 (cross-cutting-5): "not-an-email", "name@" and "name@example" got "Enter your email address.", as if nothing had
// been typed; the field was not marked invalid nor linked to the message, and on /signin and /signup the message sat
// 134 to 385 px below the field, after the buttons and the options panel. Now each check says what is wrong, its message
// sits right under its field, the field is marked invalid and described by it, and focus goes there (bug 80's part for
// the field at fault). The last request's failure sits under the button that sent it, Google's under Google's button.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  emailProblem,
  FIELD_MESSAGES,
  fieldIds,
  fieldInvalid,
  newPasswordProblem,
  signInFormProblem,
  signUpFormProblem,
  type AuthField,
} from "@/lib/auth/form-problems";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

const FORMS: Record<string, AuthField[]> = {
  "src/app/(auth)/signin/SignInForm.tsx": ["email", "password"],
  "src/app/(auth)/signup/SignUpForm.tsx": ["email", "name", "password", "confirm"],
  "src/app/(auth)/forgot-password/page.tsx": ["email"],
  "src/app/(auth)/reset-password/page.tsx": ["password", "confirm"],
};

test("an empty address and a mistyped one get different messages", () => {
  assert.deepEqual(emailProblem(""), { field: "email", message: FIELD_MESSAGES.emailMissing });
  assert.deepEqual(emailProblem("   "), { field: "email", message: FIELD_MESSAGES.emailMissing });
  assert.equal(FIELD_MESSAGES.emailMissing, "Enter your email address.");
  for (const typed of ["not-an-email", "name@", "name@example", "@example.com", "a b@example.com", "name@@example.com"]) {
    assert.deepEqual(emailProblem(typed), { field: "email", message: FIELD_MESSAGES.emailInvalid }, typed);
  }
  assert.match(FIELD_MESSAGES.emailInvalid, /correct format, like name@example\.com\.$/, "says what an address looks like");
  assert.equal(emailProblem("asha@fitx.test"), null);
  assert.equal(emailProblem("  asha@fitx.test "), null, "spaces around it are trimmed, as when it is sent");
});

test("sign-in checks the address, then the password only when the options panel is open", () => {
  assert.equal(signInFormProblem({ email: "nope", password: "", withPassword: false })?.message, FIELD_MESSAGES.emailInvalid);
  assert.equal(signInFormProblem({ email: "asha@fitx.test", password: "", withPassword: false }), null, "a code needs no password");
  assert.deepEqual(signInFormProblem({ email: "asha@fitx.test", password: "", withPassword: true }), { field: "password", message: FIELD_MESSAGES.passwordMissing });
  assert.equal(signInFormProblem({ email: "nope", password: "", withPassword: true })?.field, "email", "in screen order: the address first");
  assert.equal(signInFormProblem({ email: "asha@fitx.test", password: "x", withPassword: true }), null);
});

test("sign-up checks its fields in screen order, each problem on its own field", () => {
  const ok = { email: "asha@fitx.test", name: "Asha", password: "long enough", confirm: "long enough", withPassword: true };
  assert.equal(signUpFormProblem(ok), null);
  assert.equal(signUpFormProblem({ ...ok, email: "asha@" })?.field, "email");
  assert.deepEqual(signUpFormProblem({ ...ok, name: "  " }), { field: "name", message: "Enter your name." });
  assert.deepEqual(signUpFormProblem({ ...ok, password: "short", confirm: "short" }), { field: "password", message: "Use at least 8 characters for your password." });
  assert.deepEqual(signUpFormProblem({ ...ok, confirm: "long enougH" }), { field: "confirm", message: "Your passwords do not match." });
  assert.equal(signUpFormProblem({ ...ok, name: "", password: "", confirm: "x", withPassword: false }), null, "a code needs only the address");
  assert.deepEqual(newPasswordProblem({ password: "1234567", confirm: "1234567" })?.field, "password", "7 characters are too few");
  assert.equal(newPasswordProblem({ password: "12345678", confirm: "12345678" }), null, "8 are enough");
});

test("a field with a problem is marked invalid and described by its message's id", () => {
  const ids = fieldIds("«r1»");
  assert.equal(ids.input("email"), "«r1»-email");
  assert.equal(ids.problem("email"), "«r1»-email-problem");
  assert.deepEqual(fieldInvalid({ field: "email", message: "x" }, "email", ids), { "aria-invalid": true, "aria-describedby": "«r1»-email-problem" });
  assert.deepEqual(fieldInvalid({ field: "email", message: "x" }, "password", ids), {}, "the other fields are untouched");
  assert.deepEqual(fieldInvalid(null, "email", ids), {});
});

test("every field is labelled by its own label, marked when at fault, and has its message right under it", () => {
  for (const [file, fields] of Object.entries(FORMS)) {
    const text = read(file);
    for (const field of fields) {
      const label = text.indexOf(`<label htmlFor={ids.input("${field}")}>`);
      const input = text.indexOf(`id={ids.input("${field}")}`);
      const marked = text.indexOf(`{...fieldInvalid(fieldProblem, "${field}", ids)}`);
      const message = text.indexOf(`<FieldProblemText problem={fieldProblem} field="${field}" ids={ids} />`);
      assert.ok(label > 0 && input > label, `${file}: ${field} has a label for its input`);
      assert.ok(marked > input, `${file}: ${field}'s input is marked invalid while at fault`);
      assert.ok(message > marked, `${file}: ${field}'s message follows its input`);
      // Nothing comes between the field and its message but the field's own Show password button: no other control.
      const between = text.slice(marked, message).replace(/<button type="button" className=\{s\.reveal\}[\s\S]*?<\/button>/, "");
      assert.doesNotMatch(between, /<button\b|<input\b|<details\b/, `${file}: ${field}'s message sits right under the field`);
    }
    assert.match(text, /const baseId = useId\(\);\s*const ids = fieldIds\(baseId\);/, file);
  }
});

test("the field at fault takes focus, so keyboard and screen-reader users land on what to fix", () => {
  for (const file of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx"]) {
    const text = read(file);
    assert.match(text, /if \(found\) return showProblem\(found\);/, file);
    assert.match(text, /function showProblem\(found: FieldProblem\) \{\s*setFieldProblem\(found\);[\s\S]*?field\[found\.field\]\?\.focus\(/, file);
  }
  assert.match(read("src/app/(auth)/signup/SignUpForm.tsx"), /email: emailInput\.current,\s*name: nameInput\.current,\s*password: passwordInput\.current,\s*confirm: confirmInput\.current,/);
  assert.match(read("src/app/(auth)/forgot-password/page.tsx"), /if \(found\) \{\s*setFieldProblem\(found\);\s*emailInput\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(read("src/app/(auth)/reset-password/page.tsx"), /setFieldProblem\(found\);\s*\(found\.field === "confirm" \? confirmInput : passwordInput\)\.current\?\.focus\(\);/);
});

test("a request's failure sits under the button that sent it, and Google's under Google's button", () => {
  for (const file of ["src/app/(auth)/signin/SignInForm.tsx", "src/app/(auth)/signup/SignUpForm.tsx"]) {
    const text = read(file);
    assert.match(text, /\{codeFlow\.sending \? "Sending code…" : "Email me a code"\}\s*<\/button>\s*\{error && <p role="alert" className=\{s\.error\}>\{error\}<\/p>\}/, `${file}: under Email me a code`);
    assert.match(text, /(Sign in with email|Create account with email)"\}\s*<\/button>\s*\{error && <p role="alert" className=\{s\.error\}>\{error\}<\/p>\}/, `${file}: under the panel's own button`);
    assert.match(text, /onError=\{setProviderError\}/, `${file}: Google's own failures`);
    assert.doesNotMatch(text, /<\/details>\s*\{(error|visibleError) &&/, `${file}: no message left at the bottom of the form`);
  }
  for (const file of ["src/app/(auth)/forgot-password/page.tsx", "src/app/(auth)/reset-password/page.tsx"]) {
    assert.match(read(file), /<\/button>\s*\{error && <p role="alert" className=\{s\.error\}>\{error\}<\/p>\}/, `${file}: under its button`);
  }
});

test("the field's message is styled as a problem, and so is the field", () => {
  const css = read("src/components/auth/auth.module.css");
  assert.match(css, /\.fieldError \{[^}]*color: var\(--fitx-danger\);/);
  assert.match(css, /\.inputWrap :global\(\.fitx-field\)\[aria-invalid="true"\] \{ border-color: var\(--fitx-danger\); \}/, "a red border that isn't only the focus ring");
  const component = read("src/components/auth/FieldProblem.tsx");
  assert.match(component, /<p id=\{ids\.problem\(field\)\} role="alert" className=\{s\.fieldError\}>\{problem\.message\}<\/p>/);
});
