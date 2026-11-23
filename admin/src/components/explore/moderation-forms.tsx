import { ConfirmSubmit } from "@/components/content/confirm-submit";
import { PendingButton } from "@/components/pending-button";
import {
  ACTION_LABELS,
  IRREVERSIBLE,
  REASON_LABELS,
  REPORT_REASONS,
  SANCTION_KINDS,
  SANCTION_LABELS,
  SUSPENSION_LABELS,
  SUSPENSION_LENGTHS,
  type ModerationAction,
  type ReportReason,
  type SanctionKind,
} from "@/lib/explore-rules";
import { moderate } from "@/app/(control)/explore/actions";
import styles from "./explore.module.css";

type Target = { reportId?: string; userId?: string };

function Hidden({ target }: { target: Target }) {
  return (
    <>
      {target.reportId && <input type="hidden" name="reportId" value={target.reportId} />}
      {target.userId && <input type="hidden" name="userId" value={target.userId} />}
    </>
  );
}

function ReasonField({ defaultReason, label = "Reason (the member and the audit log see only its name)" }: { defaultReason?: ReportReason; label?: string }) {
  return (
    <label>
      {label}
      <select name="reason" defaultValue={defaultReason ?? "other"}>
        {REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{REASON_LABELS[reason]}</option>)}
      </select>
    </label>
  );
}

/**
 * The actions on a report or an account: reversible ones in one form (each its own submit button), the ones that
 * cannot be undone each in a form whose button asks twice, and the suspension with its kind and length.
 */
export function ModerationForms({ target, actions, defaultReason, allowSuspend, activeSanctions, allowDismiss, allowClaim }: {
  target: Target;
  actions: readonly ModerationAction[];
  defaultReason?: ReportReason;
  allowSuspend: boolean;
  activeSanctions: readonly SanctionKind[];
  allowDismiss: boolean;
  allowClaim: boolean;
}) {
  const soft = actions.filter((action) => !IRREVERSIBLE.includes(action));
  const hard = actions.filter((action) => IRREVERSIBLE.includes(action));
  return (
    <div className={styles.stack}>
      {(soft.length > 0 || allowDismiss || allowClaim) && (
        <form action={moderate} className={`stack-form ${styles.compact}`}>
          <Hidden target={target} />
          {soft.some((action) => action !== "unhide") && <ReasonField defaultReason={defaultReason} />}
          <label>Note for moderators (optional, never shown to the member)<textarea name="note" maxLength={1000} rows={2} /></label>
          <div className={styles.buttons}>
            {soft.map((action) => (
              <button key={action} type="submit" name="action" value={action} className={action === "hide" ? "primary-button" : "quiet-button"}>{ACTION_LABELS[action]}</button>
            ))}
            {allowClaim && <button type="submit" name="action" value="claim" className="quiet-button">{ACTION_LABELS.claim}</button>}
            {allowDismiss && <button type="submit" name="action" value="dismiss" className="quiet-button">{ACTION_LABELS.dismiss}</button>}
          </div>
        </form>
      )}
      {hard.length > 0 && (
        <div className={styles.buttons}>
          {hard.map((action) => (
            <form key={action} action={moderate}>
              <Hidden target={target} />
              <input type="hidden" name="action" value={action} />
              <input type="hidden" name="reason" value={defaultReason ?? "other"} />
              <ConfirmSubmit label={ACTION_LABELS[action]} confirmLabel={`${ACTION_LABELS[action]}: cannot be undone`} />
            </form>
          ))}
        </div>
      )}
      {allowSuspend && (
        <form action={moderate} className="stack-form">
          <Hidden target={target} />
          <input type="hidden" name="action" value="suspend" />
          <div className="form-row">
            <label>Suspend<select name="sanction" defaultValue="explore">{SANCTION_KINDS.map((kind) => <option key={kind} value={kind}>{SANCTION_LABELS[kind]}</option>)}</select></label>
            <label>For<select name="length" defaultValue="7d">{SUSPENSION_LENGTHS.map((length) => <option key={length} value={length}>{SUSPENSION_LABELS[length]}</option>)}</select></label>
          </div>
          <ReasonField defaultReason={defaultReason} label="Reason for the suspension" />
          <PendingButton className="danger-button" pendingLabel="Suspending…">Suspend from Explore</PendingButton>
        </form>
      )}
      {activeSanctions.map((kind) => (
        <form key={kind} action={moderate} className={`stack-form ${styles.inline}`}>
          <Hidden target={target} />
          <input type="hidden" name="action" value="lift" />
          <input type="hidden" name="sanction" value={kind} />
          <PendingButton className="quiet-button" pendingLabel="Lifting…">{kind === "explore" ? "Lift suspension" : `Lift suspension (${SANCTION_LABELS[kind]})`}</PendingButton>
        </form>
      ))}
    </div>
  );
}
