"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { Camera, Flame, RotateCcw, Settings, Trash2, UserRound } from "lucide-react";
import { PageHeading } from "@/components/app/PageHeading";
import { useOptionalUserContext } from "@/components/app/UserContextProvider";
import { NAME_MAX_LENGTH, formatWeight } from "@/lib/domain/profile-options";
import { loadUserContext, updateProfileRow, type UserContextData } from "@/lib/domain/user-context";
import { createClient } from "@/lib/supabase/client";
import { targetReason } from "./ProfileParts";
import { BodySection, DietSection, TrainingSection } from "./ProfileSections";

const MEDIA_BUCKET = "fitx-user-media";
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

type Status = "loading" | "ready" | "signed_out" | "unavailable" | "error";
type SectionId = "body" | "diet" | "training";

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
  const [message, setMessage] = useState("");
  const [retrying, setRetrying] = useState(false);

  const onSaved = useCallback(async (text: string) => {
    await reload();
    setMessage(text);
  }, [reload]);

  async function retry() {
    setRetrying(true);
    await reload();
    setRetrying(false);
  }

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-5xl space-y-5" aria-busy="true">
        <PageHeading title="Profile" description="Your details, goal and preferences." />
        <p role="status" className="sr-only">Loading your profile…</p>
        {[0, 1, 2].map((key) => <div key={key} className="fitx-panel h-40 animate-pulse" />)}
      </div>
    );
  }
  if (status !== "ready" || !data) {
    const text = status === "signed_out" ? "Sign in to see your profile."
      : status === "unavailable" ? "Your profile isn't available right now because FITX can't reach its database."
      : "Your profile couldn't be loaded, so editing is paused to keep your details safe.";
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeading title="Profile" description="Your details, goal and preferences." />
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

  const sectionProps = (id: SectionId) => ({
    data,
    editing: editing === id,
    onEdit: () => { setMessage(""); setEditing(id); },
    onClose: () => setEditing((current) => (current === id ? null : current)),
    onSaved,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeading
        title="Profile"
        description="Your details, goal and preferences. FITX uses them for your targets, workouts and food suggestions."
        actions={<Link href="/settings" className="fitx-button fitx-button-secondary min-h-11 px-4 text-sm"><Settings size={16} aria-hidden="true" />Settings</Link>}
      />
      {message && <p role="status" className="fitx-alert fitx-alert-success">{message}</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <IdentityCard data={data} avatarUrl={avatarUrl} onSaved={onSaved} />
        <TargetsCard data={data} onEditBody={() => { setMessage(""); setEditing("body"); document.getElementById("body")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
      </div>
      <BodySection key={`body-${editing === "body"}`} {...sectionProps("body")} />
      <DietSection key={`diet-${editing === "diet"}`} {...sectionProps("diet")} />
      <TrainingSection key={`training-${editing === "training"}`} {...sectionProps("training")} />
      <p className="px-1 text-sm text-fitx-text-secondary">Body measurements and your weight history are on <Link href="/progress" className="font-medium text-fitx-primary-text underline-offset-4 hover:underline">Progress</Link>.</p>
    </div>
  );
}

function IdentityCard({ data, avatarUrl, onSaved }: { data: UserContextData; avatarUrl: string | null; onSaved: (message: string) => Promise<void> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(data.profile?.name ?? "");
  const [busy, setBusy] = useState<"" | "name" | "photo">("");
  const [error, setError] = useState("");
  const memberSince = data.profile?.created_at ? new Date(data.profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;
  const storedAvatar = data.profile?.avatar ?? null;

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
    const saved = await updateProfileRow(supabase, data.userId, { name: value });
    if (saved.error) {
      setBusy("");
      return setError("Your name couldn't be saved. Try again.");
    }
    await onSaved("Name saved.");
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
    setBusy("");
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
    setBusy("");
  }

  return (
    <section aria-labelledby="identity-title" className="fitx-panel p-4 sm:p-6">
      <h2 id="identity-title" className="sr-only">Your account</h2>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative h-20 w-20 shrink-0">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full border border-fitx-border bg-fitx-surface-variant text-fitx-text-secondary">
            {avatarUrl ? <Image src={avatarUrl} alt="Your profile photo" width={80} height={80} unoptimized className="h-full w-full object-cover" /> : <UserRound size={30} aria-hidden="true" />}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <form onSubmit={(event) => void saveName(event)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="profile-name" className="sr-only">Name</label>
              <input id="profile-name" className="fitx-field" value={name} maxLength={NAME_MAX_LENGTH} autoComplete="name" autoFocus onChange={(event) => setName(event.target.value)} />
              <div className="flex gap-2">
                <button type="submit" disabled={busy === "name"} className="fitx-button px-4">{busy === "name" ? "Saving…" : "Save"}</button>
                <button type="button" onClick={() => { setEditingName(false); setName(data.profile?.name ?? ""); setError(""); }} className="fitx-button fitx-button-secondary px-4">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2">
              <p className="truncate text-xl font-semibold tracking-[-.02em] text-fitx-text">{data.profile?.name || "Add your name"}</p>
              <button type="button" onClick={() => { setName(data.profile?.name ?? ""); setEditingName(true); }} className="inline-flex min-h-11 items-center text-sm font-medium text-fitx-primary-text underline-offset-4 hover:underline">Edit name</button>
            </div>
          )}
          {data.email && <p className="mt-1 break-all text-sm text-fitx-text-secondary">{data.email}</p>}
          {memberSince && <p className="mt-0.5 text-xs text-fitx-text-secondary">Member since {memberSince}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void uploadPhoto(event)} />
            <button type="button" onClick={() => fileInput.current?.click()} disabled={busy === "photo"} className="fitx-button fitx-button-secondary min-h-11 px-3.5 text-sm">
              <Camera size={15} aria-hidden="true" />{busy === "photo" ? "Working…" : storedAvatar ? "Change photo" : "Add photo"}
            </button>
            {storedAvatar && (
              <button type="button" onClick={() => void removePhoto()} disabled={busy === "photo"} className="fitx-button fitx-button-quiet min-h-11 px-3.5 text-sm">
                <Trash2 size={15} aria-hidden="true" />Remove
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-fitx-text-secondary">Private to your account · JPEG, PNG or WebP up to 5 MB</p>
        </div>
      </div>
      {error && <p role="alert" className="fitx-alert fitx-alert-danger mt-4">{error}</p>}
    </section>
  );
}

function TargetsCard({ data, onEditBody }: { data: UserContextData; onEditBody: () => void }) {
  const targets = data.targets;
  return (
    <section aria-labelledby="targets-title" className="fitx-panel flex flex-col p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Flame size={17} aria-hidden="true" className="text-fitx-primary" />
        <h2 id="targets-title" className="text-base font-semibold text-fitx-text">Today’s targets</h2>
      </div>
      {targets ? (
        <>
          <p className="mt-4 text-3xl font-semibold tracking-[-.03em] text-fitx-text">{targets.calories.toLocaleString("en-IN")}<span className="ml-1.5 text-sm font-medium tracking-normal text-fitx-text-secondary">kcal</span></p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {([["Protein", targets.protein], ["Carbs", targets.carbs], ["Fat", targets.fat]] as const).map(([label, grams]) => (
              <div key={label} className="rounded-lg bg-fitx-surface-variant px-2 py-2.5">
                <dt className="text-xs text-fitx-text-secondary">{label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-fitx-text">{grams} g</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-5 text-fitx-text-secondary">
            {targetReason(targets)} Based on {formatWeight(data.currentWeightKg, data.preferences.weight_unit)}; an estimate that follows your weigh-ins.
          </p>
          <Link href="/progress" className="mt-auto inline-flex min-h-11 items-center pt-2 text-sm font-medium text-fitx-primary-text underline-offset-4 hover:underline">Log a weigh-in</Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-fitx-text-secondary">Add your age, height and weight to see your daily calorie and protein targets.</p>
          <button type="button" onClick={onEditBody} className="fitx-button fitx-button-secondary mt-4 self-start">Add body details</button>
        </>
      )}
    </section>
  );
}
