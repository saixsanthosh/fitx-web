import type { AuthField, FieldIds, FieldProblem } from "@/lib/auth/form-problems";
import s from "./auth.module.css";

/**
 * A problem with one field, shown right under it (bug 45). The field points at it with aria-describedby
 * (fieldInvalid in src/lib/auth/form-problems.ts), so a screen reader hears it again whenever it comes back to the
 * field; role="alert" says it once as it appears, also when focus was already in the field.
 */
export function FieldProblemText({ problem, field, ids }: { problem: FieldProblem | null; field: AuthField; ids: FieldIds }) {
  if (problem?.field !== field) return null;
  return <p id={ids.problem(field)} role="alert" className={s.fieldError}>{problem.message}</p>;
}
