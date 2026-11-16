"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { BRAND } from "@/config/brand";
import { countRecords, exportAccountData, exportFileName, ExportError } from "@/lib/account/export";
import { DELETE_CONFIRMATION, RECENT_SIGN_IN_MINUTES, type DeletionStatus } from "@/lib/account/deletion";
import { createClient } from "@/lib/supabase/client";

/**
 * Settings → "Your data": download everything FITX stores for the account (read in the browser under
 * row-level security) and delete the account (server route, after a recent sign-in). Mounted by the
 * Settings page; the section id "your-data" is where a re-sign-in for deletion returns to.
 */
export function SettingsData() {
  return (
    <section id="your-data" aria-labelledby="settings-your-data" className="fitx-panel scroll-mt-24 p-5">
      <h2 id="settings-your-data" className="text-base font-semibold text-fitx-text">Your data</h2>
      <p className="mt-1 text-sm leading-6 text-fitx-text-secondary">Take a copy of everything FITX stores for you, or delete your account for good.</p>
      <div className="mt-4 divide-y divide-fitx-divider border-t border-fitx-divider">
        <DownloadData />
        <DeleteAccount />
      </div>
    </section>
  );
}

/** A section label inside a sentence: "Food log" becomes "food log", "AI coach messages" keeps its "AI". */
function inSentence(label: string) {
  return /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

function DownloadData() {
  const [state, setState] = useState<{ kind: "idle" | "working" | "done" | "error"; text: string }>({ kind: "idle", text: "" });

  async function download() {
    const supabase = createClient();
    if (!supabase) return setState({ kind: "error", text: "Downloading isn't available right now because FITX can't reach its database." });
    setState({ kind: "working", text: "Collecting your data…" });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setState({ kind: "error", text: "Your session has ended. Sign in again to download your data." });
    try {
      const data = await exportAccountData(supabase, auth.user, {
        onProgress: ({ done, total, label }) => setState({ kind: "working", text: `Collecting ${inSentence(label)} (${done + 1} of ${total})…` }),
      });
      const name = exportFileName();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const records = countRecords(data);
      setState({ kind: "done", text: `Downloaded ${name}: ${records.toLocaleString("en-IN")} ${records === 1 ? "record" : "records"}${data.files.length ? ` and a list of ${data.files.length} uploaded ${data.files.length === 1 ? "image" : "images"}` : ""}.` });
    } catch (error) {
      const section = error instanceof ExportError ? inSentence(error.section) : "your data";
      setState({ kind: "error", text: `We couldn't read ${section}, so nothing was downloaded. Check your connection and try again.` });
    }
  }

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fitx-text">Download my data</h3>
        <p className="mt-1 max-w-prose text-sm leading-6 text-fitx-text-secondary">A JSON file with your profile, preferences, workouts, activities, food log, weigh-ins, goals, planner, AI coach conversations and help requests, plus the names of images you uploaded.</p>
        {state.text && (
          <p role={state.kind === "error" ? "alert" : "status"} className={`mt-2 text-sm ${state.kind === "error" ? "text-fitx-danger" : state.kind === "done" ? "text-fitx-success" : "text-fitx-text-secondary"}`}>{state.text}</p>
        )}
      </div>
      <button type="button" onClick={() => void download()} disabled={state.kind === "working"} className="fitx-button fitx-button-secondary min-h-11 shrink-0 px-4 text-sm">
        <Download size={16} aria-hidden="true" />{state.kind === "working" ? "Preparing…" : "Download"}
      </button>
    </div>
  );
}

type DeleteStep = "checking" | "unavailable" | "reauth" | "confirm" | "deleting" | "deleted" | "error";

/** Whether this account can be deleted now; null when the check itself failed. A signed-out answer means "sign in again". */
async function fetchDeletionStatus(): Promise<DeletionStatus | null> {
  try {
    const response = await fetch("/api/account", { headers: { accept: "application/json" }, cache: "no-store" });
    if (response.status === 401) return { available: true, recentSignIn: false, signedInAt: null, windowMinutes: RECENT_SIGN_IN_MINUTES };
    if (!response.ok) return null;
    const { deletion } = (await response.json()) as { deletion: DeletionStatus };
    return deletion;
  } catch {
    return null;
  }
}

function DeleteAccount() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [step, setStep] = useState<DeleteStep>("checking");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const support = BRAND.supportEmail;

  useEffect(() => {
    let live = true;
    void fetchDeletionStatus().then((result) => {
      if (!live) return;
      setStatus(result);
      setStatusError(result === null);
    });
    return () => {
      live = false;
    };
  }, []);

  // Move focus to what the dialog now asks for: the confirmation box, or its next button.
  useEffect(() => {
    if (!dialog.current?.open) return;
    const target = step === "confirm" ? document.getElementById("delete-confirm") : dialog.current.querySelector<HTMLElement>("[data-autofocus]");
    target?.focus();
  }, [step]);

  async function open() {
    setTyped("");
    setError("");
    setStep("checking");
    dialog.current?.showModal();
    const latest = await fetchDeletionStatus();
    setStatus(latest);
    setStatusError(latest === null);
    if (!latest) {
      setStep("error");
      setError("We couldn't check whether your account can be deleted. Check your connection and try again.");
    } else setStep(!latest.available ? "unavailable" : latest.recentSignIn ? "confirm" : "reauth");
  }

  function close() {
    if (step === "deleting") return;
    dialog.current?.close();
  }

  async function signInAgain() {
    const supabase = createClient();
    await supabase?.auth.signOut({ scope: "local" });
    window.location.assign(`/signin?next=${encodeURIComponent("/settings#your-data")}`);
  }

  async function remove() {
    if (typed !== DELETE_CONFIRMATION) return;
    setStep("deleting");
    setError("");
    let response: Response;
    try {
      response = await fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: DELETE_CONFIRMATION }) });
    } catch {
      setStep("confirm");
      return setError("We couldn't reach FITX. Nothing was deleted. Check your connection and try again.");
    }
    if (response.ok) {
      setStep("deleted");
      // The server already ended the session; this clears what the browser still holds.
      await createClient()?.auth.signOut({ scope: "local" }).catch(() => undefined);
      return;
    }
    const { error: code } = ((await response.json().catch(() => ({}))) ?? {}) as { error?: string };
    if (code === "reauth_required" || code === "signed_out") return setStep("reauth");
    if (code === "not_configured") return setStep("unavailable");
    setStep("confirm");
    setError(code === "delete_failed"
      ? "Your uploaded images were removed, but the account itself couldn't be deleted. Please try again in a moment."
      : "Nothing was deleted. Please try again in a moment.");
  }

  const unavailable = status !== null && !status.available;
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fitx-text">Delete my account</h3>
        <p className="mt-1 max-w-prose text-sm leading-6 text-fitx-text-secondary">
          Permanently deletes your login, profile, every log and plan, and your uploaded images. It can’t be undone.
        </p>
        {unavailable && (
          <p className="mt-2 max-w-prose text-sm leading-6 text-fitx-text-secondary">
            Deleting from the app isn’t switched on yet.{support ? <> Email <a className="font-medium text-fitx-primary-text underline underline-offset-2" href={`mailto:${support}?subject=${encodeURIComponent("Delete my FITX account")}`}>{support}</a> from your account’s email address and FITX will delete it for you.</> : " Contact FITX support to have it deleted."}
          </p>
        )}
        {statusError && <p role="alert" className="mt-2 text-sm text-fitx-danger">We couldn’t check whether deletion is available. Reload the page to try again.</p>}
      </div>
      {!unavailable && (
        <button type="button" onClick={() => void open()} className="fitx-button fitx-button-danger min-h-11 shrink-0 px-4 text-sm">
          <Trash2 size={16} aria-hidden="true" />Delete account
        </button>
      )}

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

              {step === "unavailable" && (
                <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">
                  Deleting from the app isn’t switched on yet.{support ? <> Email <a className="font-medium text-fitx-primary-text underline underline-offset-2" href={`mailto:${support}?subject=${encodeURIComponent("Delete my FITX account")}`}>{support}</a> and FITX will delete it for you.</> : " Contact FITX support to have it deleted."}
                </p>
              )}

              {step === "reauth" && (
                <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">
                  For your security, deleting needs a sign-in from the last {RECENT_SIGN_IN_MINUTES} minutes. Sign in again and you’ll come back here to finish.
                </p>
              )}

              {(step === "confirm" || step === "deleting") && (
                <form id="delete-account-form" onSubmit={(event) => { event.preventDefault(); void remove(); }} className="mt-2">
                  <p className="text-sm leading-6 text-fitx-text-secondary">This permanently deletes:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm leading-6 text-fitx-text-secondary">
                    <li>your login and profile</li>
                    <li>every workout, food log, weigh-in, goal and plan</li>
                    <li>your uploaded images</li>
                  </ul>
                  <p className="mt-2 text-sm leading-6 text-fitx-text-secondary">It can’t be undone. Download your data first if you want a copy.</p>
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
                <button type="button" onClick={close} disabled={step === "deleting"} className="fitx-button fitx-button-secondary">Cancel</button>
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
    </div>
  );
}
