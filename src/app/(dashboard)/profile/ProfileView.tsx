"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { Camera, Download, Pencil, RotateCcw, Settings, Trash2, UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { checkSession, confirmSignedOut, type SessionState } from "@/components/account/session-state";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { CountUp } from "@/components/motion";
import { PHOTO_HEADER_BYTES, PHOTO_LINK_TIMED_OUT, PHOTO_NOT_AN_IMAGE, checkPhotoFile, downloadUnlessStalled, isOwnPhoto, replacePhoto, signedUrlWithin, uploadLimitMs } from "@/components/profile/photo-file";
import { NAME_SAVE, PHOTO_REMOVE, PROFILE_TIME_LIMIT_MS, headerNotice, noticeAfterReload, saveWithin, statusAfterWait, waitWithin } from "@/components/profile/profile-save";
import type { NutritionTargets } from "@/lib/domain/nutrition";
import { NAME_MAX_LENGTH, formatWeight } from "@/lib/domain/profile-options";
import { targetReason } from "@/lib/domain/target-reason";
import { loadUserContext, targetsFor, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import { withAbortSignal } from "@/lib/onboarding/time-limit";
import { createClient } from "@/lib/supabase/client";
import type { SectionNotice } from "./ProfileParts";
import { BodySection, FoodSection, GoalSection, LimitsSection, TrainingSection, type SectionId, type SectionProps } from "./ProfileSections";
import { profileHeadline } from "./profile-answers";
import { focusAfterRetry, type ProfileStatus } from "./profile-focus";

const MEDIA_BUCKET = "fitx-user-media";
/**
 * How long a picture already in the browser (the picked file, or the stored copy once downloaded) may take to open
 * before it counts as one that doesn't. Only local decoding is timed here: the download has its own stall check.
 */
const OPEN_LIMIT_MS = 15_000;

/** Whether the browser can open `src` as a picture (it loads and has a size). */
function imageOpens(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    // window.Image: the bare name is next/image's component in this file.
    const image = new window.Image();
    const finish = (opened: boolean) => {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(opened);
    };
    const timer = window.setTimeout(() => finish(false), OPEN_LIMIT_MS);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = src;
  });
}

/** Whether a picked file opens as a picture in this browser, before anything is uploaded. */
async function fileOpens(file: Blob): Promise<boolean> {
  const url = URL.createObjectURL(file);
  try {
    return await imageOpens(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "goal", label: "Goal" },
  { id: "training", label: "Training" },
  { id: "food", label: "Food" },
  { id: "limits", label: "Injuries" },
];

/**
 * Today's targets as Profile shows them: from the same profile, weight and goal as everywhere, with the member's
 * nutrition goal applied (High protein raises protein).
 */
export function profileTargets(data: UserContextData): NutritionTargets | null {
  return targetsFor(data.profile, data.preferences, data.currentWeightKg);
}

/** True once `waiting` has lasted `ms` without a break, and false again as soon as it ends. */
function useOverdue(waiting: boolean, ms: number): boolean {
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setOverdue(true), ms);
    return () => {
      window.clearTimeout(timer);
      setOverdue(false);
    };
  }, [waiting, ms]);
  return waiting && overdue;
}

/**
 * The shared user context when the dashboard layout provides one, otherwise the page's own copy, so
 * Profile works either way and a save is seen by every screen that reads the context.
 */
function useProfileData() {
  const shared = useOptionalUserContext();
  // The shared context says "signed_out" for an ended session and "error" for a check that failed (offline, say); Profile
  // still says "Sign in" only once its own check agrees, and a failed check is a load failure with Try again
  // (session-state.ts confirmSignedOut).
  const sharedSignedOut = shared?.status === "signed_out";
  // Try again (and every reload) checks again; the last answer stays on screen meanwhile, so the focused Try again
  // button isn't swapped for the loading state.
  const [attempt, setAttempt] = useState(0);
  const [own, setOwn] = useState<SessionState | null>(null);
  useEffect(() => {
    if (!sharedSignedOut) return;
    let live = true;
    const supabase = createClient();
    const check: Promise<{ state: SessionState }> = supabase ? checkSession<User>(() => supabase.auth.getUser()) : Promise.resolve({ state: "unknown" });
    void check.then(({ state }) => {
      if (live) setOwn(state);
    });
    return () => {
      live = false;
    };
  }, [sharedSignedOut, attempt]);
  const refreshShared = shared?.refresh;
  const reloadShared = useCallback(async () => {
    setAttempt((count) => count + 1);
    await refreshShared?.();
  }, [refreshShared]);
  const [local, setLocal] = useState<{ status: ProfileStatus; data: UserContextData | null; avatarUrl: string | null }>({ status: "loading", data: null, avatarUrl: null });
  const loadLocal = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return setLocal({ status: "unavailable", data: null, avatarUrl: null });
    // An ended session is "signed out"; a check that failed (offline) is an error with Try again.
    const { state, user } = await checkSession<User>(() => supabase.auth.getUser());
    if (!user) return setLocal({ status: state === "signed_out" ? "signed_out" : "error", data: null, avatarUrl: null });
    const result = await loadUserContext(supabase, { id: user.id, email: user.email ?? null });
    if (result.error) return setLocal({ status: "error", data: null, avatarUrl: null });
    const avatar = result.data.profile?.avatar ?? null;
    let avatarUrl: string | null = null;
    if (avatar && /^https:\/\//.test(avatar)) avatarUrl = avatar;
    else if (avatar) avatarUrl = (await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(avatar, 3600)).data?.signedUrl ?? null;
    setLocal({ status: "ready", data: result.data, avatarUrl });
  }, []);
  useEffect(() => {
    if (shared) return;
    void Promise.resolve().then(loadLocal);
  }, [shared, loadLocal]);
  // Neither load has a time limit of its own (the shared one is the provider's): still loading past Profile's reload
  // limit, the page shows the load as failed, with Try again, until the profile comes (profile-save.ts).
  const loaded = shared ? confirmSignedOut(shared.status, own) : local.status;
  const overdue = useOverdue(loaded === "loading", PROFILE_TIME_LIMIT_MS.reload);
  if (shared) {
    const status = confirmSignedOut(shared.status, own);
    return { status: statusAfterWait(status, overdue), data: shared.data, avatarUrl: shared.avatarUrl, reload: reloadShared };
  }
  return { ...local, status: statusAfterWait(local.status, overdue), reload: loadLocal };
}

export function ProfileView() {
  const { status, data, avatarUrl, reload } = useProfileData();
  const [editing, setEditing] = useState<SectionId | null>(null);
  const [notices, setNotices] = useState<Partial<Record<SectionId, SectionNotice>>>({});
  const [retrying, setRetrying] = useState(false);
  const alertBox = useRef<HTMLDivElement>(null);
  // Set by Try again; cleared once focus has been handed on, or is found outside the alert (where the member put it).
  const retryFocus = useRef(false);

  // Back or Forward can bring Profile back from the browser's back/forward cache as it was when it was left, after
  // a Log out say: check the session and load again, so an ended session never shows the profile as signed in.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [reload]);

  // Try again keeps focus while it works and when it fails (it stays, aria-disabled). When the alert it sat in gives way,
  // to the profile or to Sign in, focus goes there instead of falling to the page (D5, profile-focus.ts).
  useEffect(() => {
    if (!retryFocus.current || retrying) return;
    const target = focusAfterRetry(status);
    if (target === "wait") return;
    const active = document.activeElement;
    if (active && active !== document.body) {
      // Still on Try again (the retry failed): keep watching, for the alert may still give way. Anywhere else, the
      // member moved it: leave it there.
      if (!alertBox.current?.contains(active)) retryFocus.current = false;
      return;
    }
    retryFocus.current = false;
    const element = target === "heading" ? document.getElementById("profile-name-title")
      : target === "action" ? alertBox.current?.querySelector<HTMLElement>("a, button")
      : null;
    element?.focus();
  }, [status, retrying]);

  async function retry() {
    if (retrying) return;
    retryFocus.current = true;
    setRetrying(true);
    try {
      // Within the reload's limit, so "Trying again…" never stays up for good; a later answer still shows (profile-save.ts).
      await waitWithin(reload);
    } finally {
      setRetrying(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-5xl" aria-busy="true">
        <PageHeader title="Profile" />
        <p role="status" className="sr-only">Loading your profile…</p>
        <div className="space-y-4">{[0, 1, 2].map((key) => <div key={key} className="h-40 animate-pulse rounded-2xl bg-fitx-surface-variant motion-reduce:animate-none" />)}</div>
      </div>
    );
  }
  if (status !== "ready" || !data) {
    const text = status === "signed_out" ? "Sign in to see your profile."
      : status === "unavailable" ? "Your profile isn't available right now."
      : "Your profile couldn't be loaded, so editing is paused.";
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Profile" />
        <div ref={alertBox} role="alert" className="fitx-alert fitx-alert-danger flex flex-wrap items-center gap-x-2">
          <span>{text}</span>
          {status === "error" && (
            <button type="button" onClick={() => void retry()} aria-disabled={retrying || undefined} className="fitx-alert-action inline-flex min-h-11 items-center gap-1 aria-disabled:cursor-progress aria-disabled:opacity-60">
              <RotateCcw size={14} aria-hidden="true" />{retrying ? "Trying again…" : "Try again"}
            </button>
          )}
          {status === "signed_out" && <Link href="/signin?next=/profile" className="fitx-alert-action inline-flex min-h-11 items-center">Sign in</Link>}
        </div>
      </div>
    );
  }

  const targets = profileTargets(data);
  const open = (id: SectionId) => {
    setNotices((current) => ({ ...current, [id]: undefined }));
    setEditing(id);
  };
  const sectionProps = (id: SectionId): SectionProps => ({
    data,
    editing: editing === id,
    notice: notices[id] ?? null,
    onEdit: () => open(id),
    onClose: () => setEditing((current) => (current === id ? null : current)),
    onSaved: async (notice) => {
      // The card shows the change once the profile has reloaded. Past the reload's limit the save still counts: the
      // section says it is saved and how to see it (profile-save.ts).
      const reloaded = await waitWithin(reload);
      setNotices((current) => ({ ...current, [id]: noticeAfterReload(notice, reloaded) }));
    },
    onNotice: (notice) => setNotices((current) => ({ ...current, [id]: notice })),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <ProfileHeader data={data} avatarUrl={avatarUrl} onSaved={() => waitWithin(reload)} />
      <TargetsStrip data={data} targets={targets} onEditBody={() => { open("body"); document.getElementById("body")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Profile sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="m-0 flex list-none gap-2 p-0 lg:sticky lg:top-24 lg:flex-col lg:gap-1">
            {SECTIONS.map((section) => (
              <li key={section.id} className="shrink-0">
                <a href={`#${section.id}`} className="inline-flex min-h-11 items-center rounded-full border border-fitx-border bg-fitx-surface px-4 text-sm font-medium text-fitx-text-secondary transition-colors hover:text-fitx-text motion-reduce:transition-none lg:w-full lg:rounded-lg lg:border-transparent lg:bg-transparent lg:px-3 lg:hover:bg-fitx-hover">
                  {section.label}
                </a>
              </li>
            ))}
            <li className="shrink-0 lg:mt-4 lg:border-t lg:border-fitx-divider lg:pt-4">
              <Link href="/settings" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-fitx-border bg-fitx-surface px-4 text-sm font-medium text-fitx-text-secondary hover:text-fitx-text lg:w-full lg:rounded-lg lg:border-transparent lg:bg-transparent lg:px-3 lg:hover:bg-fitx-hover">
                <Settings size={15} aria-hidden="true" />Settings
              </Link>
            </li>
          </ul>
        </nav>
        <div className="min-w-0 space-y-4">
          <BodySection {...sectionProps("body")} />
          <GoalSection {...sectionProps("goal")} />
          <TrainingSection {...sectionProps("training")} />
          <FoodSection {...sectionProps("food")} />
          <LimitsSection {...sectionProps("limits")} />
          <p className="px-1 pt-2 text-sm text-fitx-text-secondary">Weight history is on <Link href="/progress" className="font-medium text-fitx-primary-text underline-offset-4 hover:underline">Progress</Link>.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * `onSaved` reloads the profile after a name or photo save, within the reload's limit: true when it came back in time,
 * so the header already shows the change.
 */
function ProfileHeader({ data, avatarUrl, onSaved }: { data: UserContextData; avatarUrl: string | null; onSaved: () => Promise<boolean> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraButton = useRef<HTMLButtonElement>(null);
  const editNameButton = useRef<HTMLButtonElement>(null);
  const [editingName, setEditingName] = useState(false);
  const nameEditorWasOpen = useRef(editingName);
  const [name, setName] = useState(data.profile?.name ?? "");
  const [busy, setBusy] = useState<"" | "name" | "photo">("");
  const [error, setError] = useState("");
  const memberSince = data.profile?.created_at ? new Date(data.profile.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : null;
  const [notice, setNotice] = useState("");
  // The goal, and the experience only once the Workouts setup has asked it (never the "Beginner" default).
  const headline = profileHeadline(data);
  const storedAvatar = data.profile?.avatar ?? null;
  // A photo that fails to load (an external Google picture, an expired link) shows the placeholder instead.
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  // A photo uploaded to FITX (not the Google picture, which is only a link) can be downloaded.
  const uploadedPhoto = isOwnPhoto(storedAvatar, data.userId);
  // The photo buttons stay focusable while a photo is being worked on (aria-disabled, not disabled), so keyboard
  // focus isn't dropped to the page; a second press meanwhile does nothing. So do the name editor's Save and Cancel
  // while the name saves, so a failed save's message is read with focus still on Save.
  const photoBusy = busy === "photo";
  const nameBusy = busy === "name";

  // Saved, unchanged or cancelled, the name editor gives way to the name: focus goes back to Edit name, as a section's
  // Edit does (ProfileParts SectionCard), instead of falling to the page (D5).
  useEffect(() => {
    if (nameEditorWasOpen.current && !editingName) editNameButton.current?.focus();
    nameEditorWasOpen.current = editingName;
  }, [editingName]);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (nameBusy) return;
    const value = name.replace(/\s+/g, " ").trim();
    if (!value) return setError("Add your name.");
    if (value.length > NAME_MAX_LENGTH) return setError(`Keep your name to ${NAME_MAX_LENGTH} characters.`);
    if (value === (data.profile?.name ?? "")) {
      setEditingName(false);
      return;
    }
    const supabase = createClient();
    if (!supabase) return setError("Your name couldn't be saved right now.");
    setBusy("name");
    setError("");
    setNotice("");
    // Within Profile's time limit, its request built with the save's signal (profile-save.ts). Past it, "Saving…" ends
    // with a message, the name stays as typed and focus stays on Save.
    const problem = await saveWithin(async (signal) => {
      const saved = await updateProfileRow(withAbortSignal(supabase, signal), data.userId, { name: value });
      return saved.error ? NAME_SAVE.failed : null;
    }, NAME_SAVE);
    if (problem) {
      setBusy("");
      return setError(problem);
    }
    const reloaded = await onSaved();
    setNotice(headerNotice("name", reloaded));
    setBusy("");
    setEditingName(false);
  }

  /**
   * The picked file's content decides: its first bytes must be a JPEG, PNG or WebP and the browser must open it as
   * a picture, whatever its name says. It is stored with that real type, and the old photo goes only once the new one
   * is stored, opens from storage and is on the profile (photo-file.ts replacePhoto).
   */
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || photoBusy) return;
    setBusy("photo");
    setError("");
    setNotice("");
    const stop = (message: string) => {
      setBusy("");
      setError(message);
    };
    let header: Uint8Array;
    try {
      header = new Uint8Array(await file.slice(0, PHOTO_HEADER_BYTES).arrayBuffer());
    } catch {
      return stop(PHOTO_NOT_AN_IMAGE);
    }
    const check = checkPhotoFile(file, header);
    if (!check.ok) return stop(check.message);
    if (!(await fileOpens(file))) return stop(PHOTO_NOT_AN_IMAGE);
    const supabase = createClient();
    if (!supabase) return stop("Your photo couldn't be uploaded right now.");
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    // Each step waits only so long (photo-file.ts): the upload as long as this file needs on a slow connection, the
    // link to the stored copy and the profile's save (cancelled at its limit) Profile's 20 seconds.
    const outcome = await replacePhoto({
      // A Blob of the real type: storage takes the stored type from the Blob, not from the contentType option.
      upload: (path, type) => bucket.upload(path, file.slice(0, file.size, type), { contentType: type, upsert: false }),
      // The stored copy comes back in full however slow the connection (only a stalled download gives up), must be
      // exactly the picked file's size, and must open as a picture here.
      opens: async (path) => {
        const url = await signedUrlWithin(bucket.createSignedUrl(path, 120));
        if (!url || url === "timed_out") return false;
        const stored = await downloadUnlessStalled((signal) => fetch(url, { signal, cache: "no-store" }));
        return stored !== null && stored.size === file.size && fileOpens(stored);
      },
      save: (path, signal) => updateProfileRow(withAbortSignal(supabase, signal), data.userId, { avatar: path }),
      remove: (paths) => bucket.remove(paths),
    }, { userId: data.userId, type: check.type, previous: storedAvatar, now: Date.now(), limits: { upload: uploadLimitMs(file.size) } });
    if (!outcome.ok) return stop(outcome.message);
    const reloaded = await onSaved();
    setNotice(headerNotice("photo", reloaded));
    setBusy("");
  }

  /** A one-minute link that downloads the uploaded photo as a file. */
  async function downloadPhoto() {
    if (!storedAvatar || photoBusy) return;
    const supabase = createClient();
    if (!supabase) return setError("Your photo couldn't be downloaded right now.");
    setBusy("photo");
    setError("");
    const fileName = storedAvatar.split("/").pop() || "fitx-photo";
    // Within Profile's time limit; a link that comes later is never followed.
    const url = await signedUrlWithin(supabase.storage.from(MEDIA_BUCKET).createSignedUrl(storedAvatar, 60, { download: fileName }));
    setBusy("");
    if (url === "timed_out") return setError(PHOTO_LINK_TIMED_OUT);
    if (!url) return setError("Your photo couldn't be downloaded. Try again.");
    window.location.assign(url);
  }

  async function removePhoto() {
    if (photoBusy) return;
    const supabase = createClient();
    if (!supabase) return;
    setBusy("photo");
    setError("");
    // Within Profile's time limit, its request built with the save's signal (profile-save.ts).
    const problem = await saveWithin(async (signal) => {
      const saved = await updateProfileRow(withAbortSignal(supabase, signal), data.userId, { avatar: null });
      return saved.error ? PHOTO_REMOVE.failed : null;
    }, PHOTO_REMOVE);
    if (problem) {
      setBusy("");
      return setError(problem);
    }
    // The stored file goes once the profile no longer points at it. A removal that doesn't answer in time is left to
    // finish on its own: a leftover in the member's own folder is harmless.
    if (isOwnPhoto(storedAvatar, data.userId)) await waitWithin(() => supabase.storage.from(MEDIA_BUCKET).remove([storedAvatar]));
    const reloaded = await onSaved();
    setNotice(headerNotice("removed", reloaded));
    setBusy("");
    // Remove photo and Download photo are gone now: keep the keyboard on the photo control, now "Add photo".
    cameraButton.current?.focus();
  }

  return (
    <header aria-labelledby="profile-name-title" className="mb-6 sm:mb-8">
      <p className="mb-4 text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-primary-text">Profile</p>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        <div className="relative h-24 w-24 shrink-0 sm:h-28 sm:w-28">
          <div className="grid h-full w-full place-items-center overflow-hidden rounded-full border border-fitx-border bg-fitx-surface-variant text-fitx-text-secondary">
            {avatarUrl && avatarUrl !== failedAvatar ? <Image src={avatarUrl} alt="Your profile photo" width={112} height={112} unoptimized onError={() => setFailedAvatar(avatarUrl)} className="h-full w-full object-cover" /> : <UserRound size={36} aria-hidden="true" />}
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void uploadPhoto(event)} />
          <button ref={cameraButton} type="button" onClick={() => { if (!photoBusy) fileInput.current?.click(); }} aria-disabled={photoBusy || undefined} aria-label={storedAvatar ? "Change photo" : "Add photo"}
            className="absolute -bottom-1 -right-1 grid h-11 w-11 place-items-center rounded-full border-4 border-fitx-bg bg-fitx-strong text-fitx-on-strong transition-transform motion-safe:hover:scale-105 aria-disabled:opacity-60">
            <Camera size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <form onSubmit={(event) => void saveName(event)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <h1 id="profile-name-title" className="sr-only">Profile</h1>
              <label htmlFor="profile-name" className="sr-only">Name</label>
              <input id="profile-name" className="fitx-field max-w-md" value={name} maxLength={NAME_MAX_LENGTH} autoComplete="name" autoFocus onChange={(event) => setName(event.target.value)} />
              <div className="flex gap-2">
                <button type="submit" aria-disabled={nameBusy || undefined} className="fitx-button px-4 aria-disabled:opacity-60">{nameBusy ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => { if (nameBusy) return; setEditingName(false); setName(data.profile?.name ?? ""); setError(""); }} aria-disabled={nameBusy || undefined} className="fitx-button fitx-button-secondary px-4 aria-disabled:opacity-60">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex items-start gap-1">
              {/* tabIndex -1: Try again hands focus here when it brings the profile back (profile-focus.ts). */}
              <h1 id="profile-name-title" tabIndex={-1} className="min-w-0 break-words font-heading text-[30px] font-bold leading-[1.05] tracking-[-.035em] text-fitx-text sm:text-[40px]">
                {data.profile?.name || "Add your name"}
              </h1>
              <button ref={editNameButton} type="button" onClick={() => { setName(data.profile?.name ?? ""); setEditingName(true); setNotice(""); }} aria-label="Edit name"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
                <Pencil size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          {headline && <p className="mt-2 text-[15px] font-medium text-fitx-text">{headline}</p>}
          <p className="mt-1 text-sm text-fitx-text-secondary">
            {data.email && <span className="break-all">{data.email}</span>}
            {data.email && memberSince && <span aria-hidden="true"> · </span>}
            {memberSince && <span className="whitespace-nowrap">Since {memberSince}</span>}
          </p>
          {(uploadedPhoto || storedAvatar) && (
            <div className="mt-2 flex flex-wrap gap-x-1">
              {uploadedPhoto && (
                <button type="button" onClick={() => void downloadPhoto()} aria-disabled={photoBusy || undefined} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-fitx-text-secondary hover:text-fitx-text aria-disabled:opacity-60">
                  <Download size={14} aria-hidden="true" />Download photo
                </button>
              )}
              {storedAvatar && (
                <button type="button" onClick={() => void removePhoto()} aria-disabled={photoBusy || undefined} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-fitx-text-secondary hover:text-fitx-text aria-disabled:opacity-60">
                  <Trash2 size={14} aria-hidden="true" />Remove photo
                </button>
              )}
            </div>
          )}
          <p role="status" aria-live="polite" className="m-0 min-h-5 text-xs font-medium text-fitx-success">{busy === "photo" ? <span className="text-fitx-text-secondary">Working…</span> : notice}</p>
        </div>
      </div>
      {error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4">{error}</p>}
    </header>
  );
}

function TargetsStrip({ data, targets, onEditBody }: { data: UserContextData; targets: NutritionTargets | null; onEditBody: () => void }) {
  if (!targets) {
    return (
      <section aria-labelledby="targets-title" className="flex flex-col gap-3 rounded-2xl border border-dashed border-fitx-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <h2 id="targets-title" className="text-sm font-semibold text-fitx-text">Daily targets need your date of birth, height and weight</h2>
        <button type="button" onClick={onEditBody} className="fitx-button fitx-button-secondary self-start sm:self-auto">Add body details</button>
      </section>
    );
  }
  const macros = [
    { label: "Protein", grams: targets.protein, high: targets.proteinFocus === "high" },
    { label: "Carbs", grams: targets.carbs, high: false },
    { label: "Fat", grams: targets.fat, high: false },
  ];
  return (
    <section aria-labelledby="targets-title" className="overflow-hidden rounded-2xl border border-fitx-border bg-fitx-stage text-fitx-on-stage">
      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-end sm:p-7">
        <div>
          <h2 id="targets-title" className="text-[11px] font-semibold uppercase tracking-[.16em] text-fitx-on-stage-secondary">Daily target · estimate</h2>
          <p className="mt-2 font-heading text-[44px] font-bold leading-none tracking-[-.04em] tabular-nums sm:text-[56px]">
            <CountUp value={targets.calories} format={(n) => Math.round(n).toLocaleString("en-IN")} />
            <span className="ml-2 text-base font-medium tracking-normal text-fitx-on-stage-secondary">kcal</span>
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {macros.map(({ label, grams, high }) => (
            <div key={label} className="rounded-xl border border-fitx-inverse-divider px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-xs text-fitx-on-stage-secondary">{label}{high && <span className="rounded-full bg-fitx-primary px-1.5 text-[10px] font-semibold text-fitx-on-primary">High</span>}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{grams} g</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="border-t border-fitx-inverse-divider px-5 py-3 text-xs leading-5 text-fitx-on-stage-secondary sm:px-7">
        {targetReason(targets)} From {formatWeight(data.currentWeightKg, data.preferences.weight_unit)}.
      </p>
    </section>
  );
}
