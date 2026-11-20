"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { Camera, Download, Pencil, RotateCcw, Settings, Trash2, UserRound } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { CountUp } from "@/components/motion";
import type { NutritionTargets } from "@/lib/domain/nutrition";
import { EXPERIENCE_OPTIONS, GOAL_OPTIONS, NAME_MAX_LENGTH, formatWeight, optionLabel } from "@/lib/domain/profile-options";
import { targetReason } from "@/lib/domain/target-reason";
import { loadUserContext, targetsFor, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import { createClient } from "@/lib/supabase/client";
import type { SectionNotice } from "./ProfileParts";
import { BodySection, FoodSection, GoalSection, LimitsSection, TrainingSection, type SectionId, type SectionProps } from "./ProfileSections";

const MEDIA_BUCKET = "fitx-user-media";
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

type Status = "loading" | "ready" | "signed_out" | "unavailable" | "error";

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

/**
 * The shared user context when the dashboard layout provides one, otherwise the page's own copy, so
 * Profile works either way and a save is seen by every screen that reads the context.
 */
function useProfileData() {
  const shared = useOptionalUserContext();
  const [local, setLocal] = useState<{ status: Status; data: UserContextData | null; avatarUrl: string | null }>({ status: "loading", data: null, avatarUrl: null });
  const loadLocal = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return setLocal({ status: "unavailable", data: null, avatarUrl: null });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setLocal({ status: "signed_out", data: null, avatarUrl: null });
    const result = await loadUserContext(supabase, { id: auth.user.id, email: auth.user.email ?? null });
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
  if (shared) return { status: shared.status, data: shared.data, avatarUrl: shared.avatarUrl, reload: shared.refresh };
  return { ...local, reload: loadLocal };
}

export function ProfileView() {
  const { status, data, avatarUrl, reload } = useProfileData();
  const [editing, setEditing] = useState<SectionId | null>(null);
  const [notices, setNotices] = useState<Partial<Record<SectionId, SectionNotice>>>({});
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await reload();
    setRetrying(false);
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
        <div role="alert" className="fitx-alert fitx-alert-danger flex flex-wrap items-center gap-x-2">
          <span>{text}</span>
          {status === "error" && (
            <button type="button" onClick={() => void retry()} disabled={retrying} className="fitx-alert-action inline-flex min-h-11 items-center gap-1">
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
      await reload();
      setNotices((current) => ({ ...current, [id]: notice }));
    },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <ProfileHeader data={data} avatarUrl={avatarUrl} onSaved={async () => { await reload(); }} />
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

function ProfileHeader({ data, avatarUrl, onSaved }: { data: UserContextData; avatarUrl: string | null; onSaved: (message: string) => Promise<void> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(data.profile?.name ?? "");
  const [busy, setBusy] = useState<"" | "name" | "photo">("");
  const [error, setError] = useState("");
  const memberSince = data.profile?.created_at ? new Date(data.profile.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : null;
  const [notice, setNotice] = useState("");
  const goal = optionLabel(GOAL_OPTIONS, data.preferences.primary_goal);
  const experience = optionLabel(EXPERIENCE_OPTIONS, data.preferences.fitness_level);
  const storedAvatar = data.profile?.avatar ?? null;
  // A photo that fails to load (an external Google picture, an expired link) shows the placeholder instead.
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  // A photo uploaded to FITX (not the Google picture, which is only a link) can be downloaded.
  const uploadedPhoto = Boolean(storedAvatar && storedAvatar.startsWith(`${data.userId}/`));

  async function saveName(event: FormEvent) {
    event.preventDefault();
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
    const saved = await updateProfileRow(supabase, data.userId, { name: value });
    if (saved.error) {
      setBusy("");
      return setError("Your name couldn't be saved. Try again.");
    }
    await onSaved("Name saved.");
    setNotice("Name saved");
    setBusy("");
    setEditingName(false);
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = PHOTO_TYPES[file.type];
    if (!extension) return setError("Choose a JPEG, PNG or WebP image.");
    if (file.size > PHOTO_MAX_BYTES) return setError("Choose an image under 5 MB.");
    const supabase = createClient();
    if (!supabase) return setError("Your photo couldn't be uploaded right now.");
    setBusy("photo");
    setError("");
    // A new name each time, so no cached copy of the old photo is ever shown.
    const path = `${data.userId}/avatar-${Date.now()}.${extension}`;
    const uploaded = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) {
      setBusy("");
      return setError("Your photo couldn't be uploaded. Try again.");
    }
    const saved = await updateProfileRow(supabase, data.userId, { avatar: path });
    if (saved.error) {
      await supabase.storage.from(MEDIA_BUCKET).remove([path]);
      setBusy("");
      return setError("Your photo couldn't be saved. Try again.");
    }
    if (storedAvatar && storedAvatar.startsWith(`${data.userId}/`)) await supabase.storage.from(MEDIA_BUCKET).remove([storedAvatar]);
    await onSaved("Photo updated.");
    setNotice("Photo updated");
    setBusy("");
  }

  /** A one-minute link that downloads the uploaded photo as a file. */
  async function downloadPhoto() {
    if (!storedAvatar) return;
    const supabase = createClient();
    if (!supabase) return setError("Your photo couldn't be downloaded right now.");
    setBusy("photo");
    setError("");
    const fileName = storedAvatar.split("/").pop() || "fitx-photo";
    const signed = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(storedAvatar, 60, { download: fileName });
    setBusy("");
    if (signed.error || !signed.data?.signedUrl) return setError("Your photo couldn't be downloaded. Try again.");
    window.location.assign(signed.data.signedUrl);
  }

  async function removePhoto() {
    const supabase = createClient();
    if (!supabase) return;
    setBusy("photo");
    setError("");
    const saved = await updateProfileRow(supabase, data.userId, { avatar: null });
    if (saved.error) {
      setBusy("");
      return setError("Your photo couldn't be removed. Try again.");
    }
    if (storedAvatar && storedAvatar.startsWith(`${data.userId}/`)) await supabase.storage.from(MEDIA_BUCKET).remove([storedAvatar]);
    await onSaved("Photo removed.");
    setNotice("Photo removed");
    setBusy("");
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
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy === "photo"} aria-label={storedAvatar ? "Change photo" : "Add photo"}
            className="absolute -bottom-1 -right-1 grid h-11 w-11 place-items-center rounded-full border-4 border-fitx-bg bg-fitx-strong text-fitx-on-strong transition-transform motion-safe:hover:scale-105 disabled:opacity-60">
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
                <button type="submit" disabled={busy === "name"} className="fitx-button px-4">{busy === "name" ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => { setEditingName(false); setName(data.profile?.name ?? ""); setError(""); }} className="fitx-button fitx-button-secondary px-4">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex items-start gap-1">
              <h1 id="profile-name-title" className="min-w-0 break-words font-heading text-[30px] font-bold leading-[1.05] tracking-[-.035em] text-fitx-text sm:text-[40px]">
                {data.profile?.name || "Add your name"}
              </h1>
              <button type="button" onClick={() => { setName(data.profile?.name ?? ""); setEditingName(true); setNotice(""); }} aria-label="Edit name"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-fitx-text-secondary hover:bg-fitx-hover hover:text-fitx-text">
                <Pencil size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <p className="mt-2 text-[15px] font-medium text-fitx-text">{[goal, experience].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-sm text-fitx-text-secondary">
            {data.email && <span className="break-all">{data.email}</span>}
            {data.email && memberSince && <span aria-hidden="true"> · </span>}
            {memberSince && <span className="whitespace-nowrap">Since {memberSince}</span>}
          </p>
          {(uploadedPhoto || storedAvatar) && (
            <div className="mt-2 flex flex-wrap gap-x-1">
              {uploadedPhoto && (
                <button type="button" onClick={() => void downloadPhoto()} disabled={busy === "photo"} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-fitx-text-secondary hover:text-fitx-text">
                  <Download size={14} aria-hidden="true" />Download photo
                </button>
              )}
              {storedAvatar && (
                <button type="button" onClick={() => void removePhoto()} disabled={busy === "photo"} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-fitx-text-secondary hover:text-fitx-text">
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
