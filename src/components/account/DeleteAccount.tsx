"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { BRAND } from "@/config/brand";
import { DELETE_CONFIRMATION, DELETE_STARTED_FOR_KEY, RECENT_SIGN_IN_MINUTES, type DeletionStatus } from "@/lib/account/deletion";
import { recordingStore } from "@/lib/activity/local-store";
import { createClient } from "@/lib/supabase/client";

/**
 * "Delete my account": the Settings row, or a quiet link (onboarding, so an account made with the wrong
 * Google account can be removed without finishing setup). The dialog always names the account it will
 * delete. If the signed-in account changes on the way (another Google account at re-sign-in, or a switch in
 * another tab), it says so and deletes nothing; the server refuses too (expectedUserId).
 */

type DeleteStep = "checking" | "unavailable" | "reauth" | "switched" | "confirm" | "deleting" | "deleted" | "error";
type StatusResult = { kind: "ok"; status: DeletionStatus } | { kind: "outage" } | { kind: "error" };
type StartedFor = { id: string | null; email: string | null };

const OUTAGE = "FITX can’t reach its sign-in service right now, so nothing was deleted. Try again in a moment.";

/** Whether this account can be deleted now. A signed-out answer means "sign in again". */
async function fetchDeletionStatus(): Promise<StatusResult> {
  try {
    const response = await fetch("/api/account", { headers: { accept: "application/json" }, cache: "no-store" });
    if (response.status === 401) {
      return { kind: "ok", status: { available: true, recentSignIn: false, signedInAt: null, windowMinutes: RECENT_SIGN_IN_MINUTES, userId: null, email: null } };
    }
    if (response.status === 503) {
      const { error } = ((await response.json().catch(() => ({}))) ?? {}) as { error?: string };
      if (error === "auth_unavailable") return { kind: "outage" };
    }
    if (!response.ok) return { kind: "error" };
    const { deletion } = (await response.json()) as { deletion: DeletionStatus };
    return { kind: "ok", status: deletion };
  } catch {
    return { kind: "error" };
  }
}

function readStarted(): StartedFor | null {
  try {
    const raw = sessionStorage.getItem(DELETE_STARTED_FOR_KEY);
    const value = raw ? (JSON.parse(raw) as StartedFor) : null;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeStarted(value: StartedFor | null) {
  try {
    if (value) sessionStorage.setItem(DELETE_STARTED_FOR_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(DELETE_STARTED_FOR_KEY);
  } catch {
    // Private mode can refuse storage: the server's expectedUserId check still protects the delete.
  }
}

/** The signed-in account's id from this browser's session (no network), or null. */
async function sessionUserId() {
  try {
    const { data } = (await createClient()?.auth.getSession()) ?? { data: { session: null } };
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Removes the account's activity recordings kept on this device (unfinished ones, or finished ones not
 * yet uploaded). The account is already deleted: if IndexedDB is unavailable or slow, this gives up
 * after a few seconds rather than hold up the confirmation.
 */
async function forgetDeviceRecordings(userId: string) {
  try {
    await Promise.race([
      recordingStore().then((store) => store.deleteAll(userId)),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // Nothing more to do here: the recordings belong to an account that no longer exists and can't upload.
  }
}

export function DeleteAccount({
  variant = "row",
  returnTo = "/settings#your-data",
  linkLabel = "Delete this account instead",
}: {
  variant?: "row" | "link";
  /** Where "Sign in again" brings the user back to. */
  returnTo?: string;
  linkLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [step, setStep] = useState<DeleteStep>("checking");
  const [switchedFrom, setSwitchedFrom] = useState<StartedFor | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const support = BRAND.supportEmail;

  // The Settings row checks up front, so it can say when deletion isn't switched on. The link only checks when opened.
  useEffect(() => {
    if (variant !== "row") return;
    let live = true;
    void fetchDeletionStatus().then((result) => {
      if (!live) return;
      setStatus(result.kind === "ok" ? result.status : null);
      setStatusError(result.kind !== "ok");
    });
    return () => {
      live = false;
    };
  }, [variant]);

  // Move focus to what the dialog now asks for: the confirmation box, or its next button.
  useEffect(() => {
    if (!dialog.current?.open) return;
    const target = step === "confirm" ? document.getElementById("delete-confirm") : dialog.current.querySelector<HTMLElement>("[data-autofocus]");
    target?.focus();
  }, [step]);

  async function open() {
    setTyped("");
    setError("");
    setSwitchedFrom(null);
    setStep("checking");
    if (!dialog.current?.open) dialog.current?.showModal();
    const result = await fetchDeletionStatus();
    if (result.kind !== "ok") {
      setStep("error");
      setError(result.kind === "outage" ? OUTAGE : "We couldn’t check whether your account can be deleted. Check your connection and try again.");
      return null;
    }
    const latest = result.status;
    setStatus(latest);
    setStatusError(false);
    const started = readStarted();
    if (started && latest.userId) {
      writeStarted(null);
      if (started.id && started.id !== latest.userId) {
        setSwitchedFrom(started);
        setStep("switched");
        return latest;
      }
    }
    setStep(!latest.available ? "unavailable" : latest.recentSignIn ? "confirm" : "reauth");
    return latest;
  }

  function close() {
    if (step === "deleting" || step === "deleted") return;
    dialog.current?.close();
  }

  async function signInAgain() {
    // Remember who the deletion was for, so a different account after sign-in is caught.
    writeStarted({ id: status?.userId ?? null, email: status?.email ?? null });
    const supabase = createClient();
    await supabase?.auth.signOut({ scope: "local" });
    window.location.assign(`/signin?next=${encodeURIComponent(returnTo)}`);
  }

  async function remove() {
    if (typed !== DELETE_CONFIRMATION || !status?.userId) return;
    setStep("deleting");
    setError("");
    // Read before the request: whose activity recordings on this device to clear once the account is gone.
    const userId = await sessionUserId();
    let response: Response;
    try {
      response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: DELETE_CONFIRMATION, expectedUserId: status.userId }),
      });
    } catch {
      setStep("confirm");
      return setError("We couldn’t reach FITX. Nothing was deleted. Check your connection and try again.");
    }
    if (response.ok) {
      writeStarted(null);
      if (userId) await forgetDeviceRecordings(userId);
      setStep("deleted");
      // The server already ended the session; this clears what the browser still holds.
      await createClient()?.auth.signOut({ scope: "local" }).catch(() => undefined);
      return;
    }
    const { error: code } = ((await response.json().catch(() => ({}))) ?? {}) as { error?: string };
    if (code === "account_changed") {
      // Show who is signed in now, and make them confirm again.
      const latest = await open();
      if (latest) setError("You’re now signed in to a different account, so nothing was deleted. Check the account named above before you continue.");
      return;
    }
    if (code === "reauth_required" || code === "signed_out") return setStep("reauth");
    if (code === "not_configured") return setStep("unavailable");
    setStep("confirm");
    setError(code === "auth_unavailable"
      ? OUTAGE
      : code === "delete_failed"
        ? "Your uploaded images were removed, but the account itself couldn’t be deleted. Please try again in a moment."
        : code === "billing_not_stopped"
          ? "Your FITX Premium renewals couldn’t be stopped with Razorpay, so nothing was deleted. Please try again in a moment."
          : "Nothing was deleted. Please try again in a moment.");
  }

  const unavailable = status !== null && !status.available;
  const email = status?.email ?? null;
  const supportLink = support
    ? <> Email <a className="font-medium text-fitx-primary-text underline underline-offset-2" href={`mailto:${support}?subject=${encodeURIComponent("Delete my FITX account")}`}>{support}</a> from your account’s email address and FITX will delete it for you.</>
    : " Contact FITX support to have it deleted.";

  const dialogElement = (
    <dialog
      ref={dialog}
      aria-labelledby="delete-account-title"
      onCancel={(event) => { if (step === "deleting" || step === "deleted") event.preventDefault(); }}
      className="m-auto w-[min(calc(100vw-2rem),30rem)] rounded-2xl border border-fitx-border bg-fitx-elevated p-0 text-fitx-text shadow-xl backdrop:bg-fitx-scrim/60"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fitx-danger-bg text-fitx-danger">
            {step === "deleted" ? <ShieldCheck size={19} /> : <TriangleAlert size={19} />}
          </span>
          <div className="min-w-0">
            <h2 id="delete-account-title" className="text-lg font-semibold text-fitx-text">{step === "deleted" ? "Your account is deleted" : "Delete your FITX account?"}</h2>
            {step === "checking" && <p role="status" className="mt-2 text-sm text-fitx-text-secondary">Checking your account…</p>}

            {step === "unavailable" && <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">Deleting from the app isn’t switched on yet.{supportLink}</p>}

            {step === "reauth" && (
              <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">
                {email ? <>You’re signed in as <strong className="break-all text-fitx-text">{email}</strong>. </> : null}
                For your security, deleting needs a sign-in from the last {RECENT_SIGN_IN_MINUTES} minutes. Sign in again{email ? " with this same account" : ""} and you’ll come back here to finish.
              </p>
            )}

            {step === "switched" && (
              <p role="alert" className="mt-2 text-sm leading-6 text-fitx-text-secondary">
                You started deleting {switchedFrom?.email ? <strong className="break-all text-fitx-text">{switchedFrom.email}</strong> : "another account"}, but you’re now signed in as{" "}
                {email ? <strong className="break-all text-fitx-text">{email}</strong> : "a different account"}. Nothing has been deleted. To delete this account instead, close this and choose delete again.
              </p>
            )}

            {(step === "confirm" || step === "deleting") && (
              <form id="delete-account-form" onSubmit={(event) => { event.preventDefault(); void remove(); }} className="mt-2">
                <p className="text-sm leading-6 text-fitx-text-secondary">
                  This permanently deletes the FITX account{email ? <> for <strong className="break-all text-fitx-text">{email}</strong></> : null}:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm leading-6 text-fitx-text-secondary">
                  <li>its login and profile</li>
                  <li>every workout, activity, food log, weigh-in, goal and plan</li>
                  <li>its AI coach conversations and help requests</li>
                  <li>its uploaded images, and activity recordings kept on this device</li>
                </ul>
                {/* Download lives in Settings, which an account still in setup can't open, so only the Settings row offers it. */}
                <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">{variant === "row" ? "It can’t be undone. Download your data first if you want a copy." : "It can’t be undone."}</p>
                <label htmlFor="delete-confirm" className="mt-4 block text-sm font-medium text-fitx-text">Type {DELETE_CONFIRMATION} to confirm</label>
                <input
                  id="delete-confirm"
                  className="fitx-field mt-1.5"
                  value={typed}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={step === "deleting"}
                  onChange={(event) => setTyped(event.target.value.trim())}
                />
              </form>
            )}

            {step === "deleted" && (
              <p role="status" className="mt-2 text-sm leading-6 text-fitx-text-secondary">Your login, data and images have been removed from FITX. Thank you for training with us.</p>
            )}

            {error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4">{error}</p>}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {step === "deleted" ? (
            <button type="button" data-autofocus onClick={() => window.location.replace("/")} className="fitx-button">Go to the FITX home page</button>
          ) : (
            <>
              <button type="button" data-autofocus={step === "switched" || step === "error" || step === "unavailable" ? true : undefined} onClick={close} disabled={step === "deleting"} className="fitx-button fitx-button-secondary">
                {step === "switched" ? "Close" : "Cancel"}
              </button>
              {step === "reauth" && <button type="button" data-autofocus onClick={() => void signInAgain()} className="fitx-button">Sign in again</button>}
              {(step === "confirm" || step === "deleting") && (
                <button type="submit" form="delete-account-form" disabled={typed !== DELETE_CONFIRMATION || step === "deleting"} className="fitx-button fitx-button-danger">
                  <Trash2 size={16} aria-hidden="true" />{step === "deleting" ? "Deleting…" : "Delete permanently"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  );

  if (variant === "link") {
    return (
      <>
        <button type="button" onClick={() => void open()} className="inline-flex min-h-11 items-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text">
          <Trash2 size={16} aria-hidden="true" />{linkLabel}
        </button>
        {dialogElement}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fitx-text">Delete my account</h3>
        <p className="mt-1 max-w-prose text-sm leading-6 text-fitx-text-secondary">
          Permanently deletes your login, profile, every log and plan, and your uploaded images. It can’t be undone.
        </p>
        {unavailable && <p className="mt-2 max-w-prose text-sm leading-6 text-fitx-text-secondary">Deleting from the app isn’t switched on yet.{supportLink}</p>}
        {statusError && <p role="alert" className="mt-2 text-sm text-fitx-danger">We couldn’t check whether deletion is available. Reload the page to try again.</p>}
      </div>
      {!unavailable && (
        <button type="button" onClick={() => void open()} className="fitx-button fitx-button-danger min-h-11 shrink-0 px-4 text-sm">
          <Trash2 size={16} aria-hidden="true" />Delete account
        </button>
      )}
      {dialogElement}
    </div>
  );
}
