"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Camera, Save, Settings2, UserRound } from "lucide-react";
import Image from "next/image";
import { LogoutButton } from "@/components/app/LogoutButton";
import { PageHeading } from "@/components/app/PageHeading";
import { createClient } from "@/lib/supabase/client";
import { localDateKey } from "@/lib/domain/dates";

type ProfileForm = { name: string; age: string; gender: string; height: string; weight: string; target_weight: string };
type PreferenceForm = { workout_location: string; equipment: string; fitness_level: string; primary_goal: string; workouts_per_week: string; session_duration_minutes: string; workout_split: string; activity_level: string; daily_water_goal_ml: string };
const defaultProfile: ProfileForm = { name: "", age: "", gender: "", height: "", weight: "", target_weight: "" };
const defaultPrefs: PreferenceForm = { workout_location: "gym", equipment: "bodyweight,dumbbell", fitness_level: "beginner", primary_goal: "general_fitness", workouts_per_week: "3", session_duration_minutes: "45", workout_split: "full_body", activity_level: "moderate", daily_water_goal_ml: "2500" };

export default function ProfilePage() {
  const [profile, setProfile] = useState(defaultProfile);
  const [prefs, setPrefs] = useState(defaultPrefs);
  const [userId, setUserId] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      if (!supabase) { setError("Profile is not connected to Supabase."); setLoading(false); return; }
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) { setError("Sign in to manage your profile."); setLoading(false); return; }
      const [profileResult, prefsResult] = await Promise.all([
        supabase.from("profiles").select("name,age,gender,height,weight,target_weight,avatar").eq("id", user.id).maybeSingle(),
        supabase.from("user_preferences").select("workout_location,equipment,fitness_level,primary_goal,workouts_per_week,session_duration_minutes,workout_split,activity_level,daily_water_goal_ml").eq("user_id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      setUserId(user.id);
      const row = profileResult.data;
      setProfile({ name: row?.name || user.user_metadata?.name || "", age: row?.age == null ? "" : String(row.age), gender: row?.gender || "", height: row?.height == null ? "" : String(row.height), weight: row?.weight == null ? "" : String(row.weight), target_weight: row?.target_weight == null ? "" : String(row.target_weight) });
      const pref = prefsResult.data;
      if (pref) setPrefs({ workout_location: pref.workout_location, equipment: (pref.equipment || []).join(","), fitness_level: pref.fitness_level, primary_goal: pref.primary_goal, workouts_per_week: String(pref.workouts_per_week), session_duration_minutes: String(pref.session_duration_minutes), workout_split: pref.workout_split, activity_level: pref.activity_level, daily_water_goal_ml: String(pref.daily_water_goal_ml || 2500) });
      if (row?.avatar) {
        if (String(row.avatar).startsWith("http")) setAvatarUrl(row.avatar);
        else { const signed = await supabase.storage.from("fitx-user-media").createSignedUrl(row.avatar, 3600); if (active && signed.data?.signedUrl) setAvatarUrl(signed.data.signedUrl); }
      }
      if (profileResult.error || prefsResult.error) setError("Some profile settings could not be loaded.");
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const supabase = createClient();
    if (!supabase || !userId) { setSaving(false); return setError("Sign in to save your profile."); }
    const optionalNumber = (value: string) => value.trim() ? Number(value) : null;
    const profileValues = { name: profile.name.trim() || null, age: optionalNumber(profile.age), gender: profile.gender || null, height: optionalNumber(profile.height), weight: optionalNumber(profile.weight), target_weight: optionalNumber(profile.target_weight), updated_at: new Date().toISOString() };
    if (profileValues.age != null && (profileValues.age < 13 || profileValues.age > 100) || profileValues.height != null && (profileValues.height < 90 || profileValues.height > 250) || profileValues.weight != null && (profileValues.weight < 30 || profileValues.weight > 500)) { setSaving(false); return setError("Check age, height, and weight values and try again."); }
    const profileResult = await supabase.from("profiles").update(profileValues).eq("id", userId);
    const prefResult = await supabase.from("user_preferences").upsert({
      user_id: userId, workout_location: prefs.workout_location, equipment: prefs.equipment.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
      fitness_level: prefs.fitness_level, primary_goal: prefs.primary_goal, workouts_per_week: Number(prefs.workouts_per_week), session_duration_minutes: Number(prefs.session_duration_minutes),
      workout_split: prefs.workout_split, activity_level: prefs.activity_level, daily_water_goal_ml: Number(prefs.daily_water_goal_ml),
    });
    if (profileResult.error || prefResult.error) { setSaving(false); return setError("Your settings could not be saved. Check the values and try again."); }
    if (profileValues.weight) {
      const metric = await supabase.from("body_metrics").insert({ user_id: userId, date: localDateKey(), weight: profileValues.weight, note: "Profile update" });
      if (metric.error) { setSaving(false); return setError("Profile saved, but your weight update could not be added to progress."); }
    }
    setSaving(false); setMessage("Your profile and training preferences are saved.");
  }

  async function uploadAvatar(file?: File) {
    if (!file || !userId) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { setError("Choose an image under 5 MB."); return; }
    const supabase = createClient(); if (!supabase) return;
    setSaving(true); setError("");
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${userId}/avatar.${ext}`;
    const uploaded = await supabase.storage.from("fitx-user-media").upload(path, file, { upsert: true, contentType: file.type });
    if (uploaded.error) { setSaving(false); return setError("The image could not be uploaded."); }
    const saved = await supabase.from("profiles").update({ avatar: path }).eq("id", userId);
    const signed = await supabase.storage.from("fitx-user-media").createSignedUrl(path, 3600);
    setSaving(false);
    if (saved.error || !signed.data?.signedUrl) setError("The image was uploaded, but the profile image could not be refreshed.");
    else { setAvatarUrl(signed.data.signedUrl); setMessage("Profile image updated."); }
  }

  function updateProfile(key: keyof ProfileForm, value: string) { setProfile((old) => ({ ...old, [key]: value })); }
  function updatePrefs(key: keyof PreferenceForm, value: string) { setPrefs((old) => ({ ...old, [key]: value })); }

  if (loading) return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading profile…</div>;
  return <div className="mx-auto max-w-4xl space-y-5"><PageHeading title="Profile" description="Your account details, training preferences, and starting measurements." actions={<LogoutButton/>}/>
    {error && <p role="alert" className="rounded-lg border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</p>}{message && <p role="status" className="rounded-lg border border-fitx-primary/25 bg-fitx-primary/5 px-4 py-3 text-sm text-fitx-primary">{message}</p>}
    <form onSubmit={save} className="space-y-5"><section className="fitx-panel p-4 sm:p-6"><div className="mb-5 flex items-center gap-4"><div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full border border-fitx-border bg-fitx-surface-variant text-fitx-text-secondary">{avatarUrl ? <Image src={avatarUrl} alt="Profile" width={64} height={64} unoptimized className="h-full w-full object-cover"/> : <UserRound size={24}/>}</div><div><h2 className="font-medium">Account information</h2><label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-fitx-primary"><Camera size={14}/>Change profile image<input type="file" accept="image/*" className="sr-only" onChange={(event) => void uploadAvatar(event.target.files?.[0])}/></label><p className="mt-1 text-[11px] text-fitx-text-disabled">Private image · up to 5 MB</p></div></div><div className="grid gap-3 sm:grid-cols-2">{([["name", "Name"], ["age", "Age"], ["height", "Height (cm)"], ["weight", "Current weight (kg)"], ["target_weight", "Target weight (kg)"]] as const).map(([key, label]) => <label key={key} className="text-xs text-fitx-text-secondary">{label}<input className="fitx-field mt-1.5" type={key === "name" ? "text" : "number"} min={key === "age" ? "13" : key === "height" ? "90" : "30"} max={key === "age" ? "100" : key === "height" ? "250" : "500"} step={key === "name" ? undefined : "any"} value={profile[key]} onChange={(event) => updateProfile(key, event.target.value)}/></label>)}<label className="text-xs text-fitx-text-secondary">Gender for nutrition estimate<select className="fitx-field mt-1.5" value={profile.gender} onChange={(event) => updateProfile("gender", event.target.value)}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label></div></section>
    <section className="fitx-panel p-4 sm:p-6"><h2 className="mb-4 flex items-center gap-2 font-medium"><Settings2 size={17} className="text-fitx-primary"/>Training and nutrition preferences</h2><div className="grid gap-3 sm:grid-cols-2">{([["workout_location", "Training location", [["gym", "Gym"], ["home", "Home"], ["both", "Both"], ["outdoor", "Outdoor"]]], ["fitness_level", "Experience", [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]]], ["primary_goal", "Primary goal", [["general_fitness", "General fitness"], ["muscle_gain", "Muscle gain"], ["fat_loss", "Fat loss"], ["strength", "Strength"], ["endurance", "Endurance"]]], ["workout_split", "Workout split", [["full_body", "Full body"], ["upper_lower", "Upper / lower"], ["push_pull_legs", "Push / pull / legs"], ["custom", "Custom"]]], ["activity_level", "Daily activity", [["sedentary", "Mostly sitting"], ["light", "Light"], ["moderate", "Moderate"], ["active", "Active"], ["very_active", "Very active"]]]] as const).map(([key, label, options]) => <label key={key} className="text-xs text-fitx-text-secondary">{label}<select className="fitx-field mt-1.5" value={prefs[key as keyof PreferenceForm]} onChange={(event) => updatePrefs(key as keyof PreferenceForm, event.target.value)}>{options.map(([value, option]) => <option key={value} value={value}>{option}</option>)}</select></label>)}<label className="text-xs text-fitx-text-secondary">Equipment (comma-separated)<input className="fitx-field mt-1.5" value={prefs.equipment} onChange={(event) => updatePrefs("equipment", event.target.value)} placeholder="dumbbell, bands, bodyweight"/></label><label className="text-xs text-fitx-text-secondary">Sessions each week<input className="fitx-field mt-1.5" type="number" min="1" max="7" value={prefs.workouts_per_week} onChange={(event) => updatePrefs("workouts_per_week", event.target.value)}/></label><label className="text-xs text-fitx-text-secondary">Session length (minutes)<input className="fitx-field mt-1.5" type="number" min="15" max="180" step="5" value={prefs.session_duration_minutes} onChange={(event) => updatePrefs("session_duration_minutes", event.target.value)}/></label><label className="text-xs text-fitx-text-secondary">Daily water target (ml)<input className="fitx-field mt-1.5" type="number" min="250" max="10000" step="250" value={prefs.daily_water_goal_ml} onChange={(event) => updatePrefs("daily_water_goal_ml", event.target.value)}/></label></div><p className="mt-4 text-xs text-fitx-text-disabled">Nutrition targets are estimates from the Mifflin-St Jeor equation and your selected activity and goal.</p></section>
    <div className="flex justify-end"><button disabled={saving} className="fitx-button">{saving ? "Saving…" : "Save profile"}<Save size={15}/></button></div></form>
  </div>;
}
