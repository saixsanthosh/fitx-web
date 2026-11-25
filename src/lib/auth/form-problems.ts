import { isEmailAddress } from "./email-code";

/**
 * What the sign-in pages check before anything is sent, and which field each problem belongs to (bug 45). The message
 * says what is wrong ("Enter your email address." only when nothing was typed), it sits under its field, the field is
 * marked invalid and described by it (fieldInvalid), and focus goes to the field (bug 80). Pure, so node:test covers it.
 */

export type AuthField = "email" | "name" | "password" | "confirm";
export type FieldProblem = { field: AuthField; message: string };

export const MIN_PASSWORD_LENGTH = 8;

export const FIELD_MESSAGES = {
  emailMissing: "Enter your email address.",
  emailInvalid: "Enter an email address in the correct format, like name@example.com.",
  nameMissing: "Enter your name.",
  passwordMissing: "Enter your password, or close this and use a code.",
  passwordShort: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
  passwordsDiffer: "Your passwords do not match.",
} as const;

/** The email field: empty, or not an address ("not-an-email", "name@", "name@example"). */
export function emailProblem(value: string): FieldProblem | null {
  const address = value.trim();
  if (!address) return { field: "email", message: FIELD_MESSAGES.emailMissing };
  return isEmailAddress(address) ? null : { field: "email", message: FIELD_MESSAGES.emailInvalid };
}

/** Sign-in: an address for a code, plus a password when "Other sign-in options" is open. */
export function signInFormProblem({ email, password, withPassword }: { email: string; password: string; withPassword: boolean }): FieldProblem | null {
  const problem = emailProblem(email);
  if (problem || !withPassword) return problem;
  return password ? null : { field: "password", message: FIELD_MESSAGES.passwordMissing };
}

/** A new password and its confirmation (sign-up with a password, and the reset form). */
export function newPasswordProblem({ password, confirm }: { password: string; confirm: string }): FieldProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return { field: "password", message: FIELD_MESSAGES.passwordShort };
  if (password !== confirm) return { field: "confirm", message: FIELD_MESSAGES.passwordsDiffer };
  return null;
}

/** Sign-up: an address for a code, plus a name and a new password when "Other sign-up options" is open. In screen order. */
export function signUpFormProblem({ email, name, password, confirm, withPassword }: { email: string; name: string; password: string; confirm: string; withPassword: boolean }): FieldProblem | null {
  const problem = emailProblem(email);
  if (problem || !withPassword) return problem;
  if (!name.trim()) return { field: "name", message: FIELD_MESSAGES.nameMissing };
  return newPasswordProblem({ password, confirm });
}

/** The ids of a form's fields and of their messages, from the form's one useId(). */
export function fieldIds(base: string) {
  return {
    input: (field: AuthField) => `${base}-${field}`,
    problem: (field: AuthField) => `${base}-${field}-problem`,
  };
}

export type FieldIds = ReturnType<typeof fieldIds>;

/** The input's invalid state: marked invalid and described by its message while the problem is about it. */
export function fieldInvalid(problem: FieldProblem | null, field: AuthField, ids: FieldIds): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return problem?.field === field ? { "aria-invalid": true, "aria-describedby": ids.problem(field) } : {};
}
