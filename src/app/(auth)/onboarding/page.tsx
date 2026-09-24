"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";

const equipmentOptions = [
  ["dumbbell", "Dumbbells"], ["barbell", "Barbell"], ["bench", "Bench"], ["cable", "Cable machine"],
  ["bands", "Resistance bands"], ["pull_up_bar", "Pull-up bar"], ["machine", "Machines"],
  ["kettlebell", "Kettlebell"], ["bodyweight", "Bodyweight"],
];
const goals = [["muscle_gain", "Muscle gain"], ["fat_loss", "Fat loss"], ["strength", "Strength"], ["general_fitness", "General fitness"], ["endurance", "Endurance"]];
const diets = ["No preference", "Vegetarian", "Vegan", "Pescatarian", "Halal", "Low carb"];
const allergyOptions = ["Dairy", "Eggs", "Peanuts", "Tree nuts", "Wheat", "Soy", "Fish", "Shellfish"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("gym");
  const [equipment, setEquipment] = useState<string[]>(["bodyweight", "dumbbell"]);
  const [level, setLevel] = useState("beginner");
  const [goal, setGoal] = useState("general_fitness");
  const [days, setDays] = useState(3);
  const [duration, setDuration] = useState(45);
  const [split, setSplit] = useState("full_body");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState("moderate");
  const [diet, setDiet] = useState("");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [mealsPerDay, setMealsPerDay] = useState(3);

  useEffect(() => {
    let live = true;
    async function load() {
      const supabase = createClient();
      if (!supabase) { setError("FITX is not connected to Supabase."); setLoading(false); return; }
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { router.replace("/signin"); return; }
      const [{ data: profile }, { data: prefs }] = await Promise.all([
        supabase.from("profiles").select("name, age, gender, height, weight, onboarded").eq("id", auth.user.id).maybeSingle(),
        supabase.from("user_preferences").select("workout_location, equipment, fitness_level, primary_goal, workouts_per_week, session_duration_minutes, workout_split, activity_level, dietary_preferences, allergies, meals_per_day").eq("user_id", auth.user.id).maybeSingle(),
      ]);
      if (!live) return;
      if (profile?.onboarded) { router.replace("/dashboard"); return; }
      setUserId(auth.user.id);
      setName(profile?.name || auth.user.user_metadata?.name || "");
      setAge(profile?.age ? String(profile.age) : "");
      setGender(profile?.gender || "");
      setHeight(profile?.height ? String(profile.height) : "");
      setWeight(profile?.weight ? String(profile.weight) : "");
      if (prefs) {
        setLocation(prefs.workout_location || "gym");
        setEquipment(prefs.equipment || ["bodyweight"]);
        setLevel(prefs.fitness_level || "beginner");
        setGoal(prefs.primary_goal || "general_fitness");
        setDays(prefs.workouts_per_week || 3);
        setDuration(prefs.session_duration_minutes || 45);
        setSplit(prefs.workout_split || "full_body");
        setActivity(prefs.activity_level || "moderate");
        setDiet(prefs.dietary_preferences?.[0] || "");
        setAllergies(prefs.allergies || []);
        setMealsPerDay(prefs.meals_per_day || 3);
      }
      setLoading(false);
    }
    void load();
    return () => { live = false; };
  }, [router]);

  function toggle(values: string[], setValues: (value: string[]) => void, value: string) {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!name.trim()) return setError("Add your name to continue.");
    if (!age || Number(age) < 13 || Number(age) > 100 || !height || Number(height) < 90 || !weight || Number(weight) < 30) {
      return setError("Enter a valid age, height, and weight so FITX can personalize your starting targets.");
    }
    const supabase = createClient();
    if (!supabase || !userId) return setError("Your account session could not be found. Sign in and try again.");
    setSaving(true);
    const { error: profileError } = await supabase.from("profiles").update({
      name: name.trim(), age: Number(age), gender, height: Number(height), weight: Number(weight),
      experience: level[0].toUpperCase() + level.slice(1), workout_mode: location[0].toUpperCase() + location.slice(1),
      goals: [goal], onboarded: true,
    }).eq("id", userId);
    if (profileError) { setSaving(false); return setError("Your profile could not be saved. Please try again."); }
    const { error: prefError } = await supabase.from("user_preferences").upsert({
      user_id: userId,
      workout_location: location,
      equipment: equipment.length ? equipment : ["bodyweight"],
      fitness_level: level,
      primary_goal: goal,
      workouts_per_week: days,
      session_duration_minutes: duration,
      workout_split: split,
      activity_level: activity,
      dietary_preferences: diet && diet !== "No preference" ? [diet] : [],
      allergies,
      meals_per_day: mealsPerDay,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    if (prefError) {
      await supabase.from("profiles").update({ onboarded: false }).eq("id", userId);
      setSaving(false);
      return setError("Your preferences could not be saved. Please try again.");
    }
    const { data: priorWeight } = await supabase.from("body_metrics").select("id").eq("user_id", userId).not("weight", "is", null).limit(1).maybeSingle();
    if (!priorWeight) await supabase.from("body_metrics").insert({ user_id: userId, date: new Date().toISOString().slice(0, 10), weight: Number(weight), note: "Starting weight" });
    setSaving(false);
    router.replace("/dashboard");
  }

  if (loading) return <div className="py-14 text-center text-sm text-fitx-text-secondary">Loading your profile…</div>;

  return (
    <div className="mx-auto w-full max-w-[610px]">
      <div className="mb-6 text-center"><Logo size={52} className="mx-auto mb-3"/><p className="text-xs font-medium uppercase tracking-[.16em] text-fitx-primary">Set up FITX</p><h1 className="mt-2 text-2xl font-semibold">A plan that fits your life</h1><p className="mt-1 text-sm text-fitx-text-secondary">Step {step} of 3</p></div>
      <div className="mb-5 grid grid-cols-3 gap-2" aria-label="Onboarding progress">{[1,2,3].map((item) => <div key={item} className={`h-1.5 rounded-full ${item <= step ? "bg-fitx-primary" : "bg-fitx-surface-variant"}`} />)}</div>
      <form onSubmit={step === 3 ? save : (event) => { event.preventDefault(); setError(""); setStep(step + 1); }} className="rounded-2xl border border-fitx-border bg-[#0b1012] p-5 sm:p-7">
        {step === 1 && <div className="space-y-6">
          <div><h2 className="text-lg font-semibold">Where do you work out?</h2><div className="mt-3 grid grid-cols-2 gap-2">{[["gym","Gym"],["home","Home"],["both","Both"],["outdoor","Outdoors"]].map(([key,label]) => <Choice key={key} selected={location === key} onClick={() => setLocation(key)}>{label}</Choice>)}</div></div>
          <div><h2 className="text-lg font-semibold">What equipment can you use?</h2><p className="mt-1 text-sm text-fitx-text-secondary">Choose everything you have available.</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{equipmentOptions.map(([key,label]) => <Choice key={key} selected={equipment.includes(key)} onClick={() => toggle(equipment,setEquipment,key)}>{label}</Choice>)}</div></div>
          <div><h2 className="text-lg font-semibold">Your experience</h2><div className="mt-3 grid grid-cols-3 gap-2">{[["beginner","Beginner"],["intermediate","Intermediate"],["advanced","Advanced"]].map(([key,label]) => <Choice key={key} selected={level === key} onClick={() => setLevel(key)}>{label}</Choice>)}</div></div>
        </div>}
        {step === 2 && <div className="space-y-6">
          <div><h2 className="text-lg font-semibold">What are you working toward?</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{goals.map(([key,label]) => <Choice key={key} selected={goal === key} onClick={() => setGoal(key)}>{label}</Choice>)}</div></div>
          <div><h2 className="text-lg font-semibold">How often can you train?</h2><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{[2,3,4,5,6,7].map((value) => <Choice key={value} selected={days === value} onClick={() => setDays(value)}>{value} days</Choice>)}</div></div>
          <div><h2 className="text-lg font-semibold">Typical session length</h2><div className="mt-3 grid grid-cols-2 gap-2">{[[30,"20–30 min"],[45,"30–45 min"],[60,"45–60 min"],[75,"60+ min"]].map(([value,label]) => <Choice key={value} selected={duration === value} onClick={() => setDuration(Number(value))}>{label}</Choice>)}</div></div>
          <div><h2 className="text-lg font-semibold">Preferred training split</h2><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{[["full_body","Full body"],["upper_lower","Upper / lower"],["push_pull_legs","Push / pull / legs"]].map(([key,label]) => <Choice key={key} selected={split === key} onClick={() => setSplit(key)}>{label}</Choice>)}</div></div>
        </div>}
        {step === 3 && <div className="space-y-5">
          <div><h2 className="text-lg font-semibold">A few details for your targets</h2><p className="mt-1 text-sm leading-6 text-fitx-text-secondary">FITX uses these details to estimate nutrition targets. You can update them later.</p></div>
          <label className="block text-sm text-fitx-text-secondary">Name<input className="fitx-field mt-1.5" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-fitx-text-secondary">Age<input className="fitx-field mt-1.5" type="number" min="13" max="100" required value={age} onChange={(e) => setAge(e.target.value)} placeholder="Years" /></label>
            <label className="block text-sm text-fitx-text-secondary">Sex for calorie estimate<select className="fitx-field mt-1.5" required value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Prefer not to say</option></select></label>
            <label className="block text-sm text-fitx-text-secondary">Height<input className="fitx-field mt-1.5" type="number" min="90" max="250" step="0.1" required value={height} onChange={(e) => setHeight(e.target.value)} placeholder="cm" /></label>
            <label className="block text-sm text-fitx-text-secondary">Weight<input className="fitx-field mt-1.5" type="number" min="30" max="400" step="0.1" required value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="kg" /></label>
          </div>
          <label className="block text-sm text-fitx-text-secondary">Daily activity<select className="fitx-field mt-1.5" value={activity} onChange={(e) => setActivity(e.target.value)}><option value="sedentary">Mostly sitting</option><option value="light">Light activity</option><option value="moderate">Moderately active</option><option value="active">Very active</option><option value="very_active">Highly active</option></select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-fitx-text-secondary">Diet preference<select className="fitx-field mt-1.5" value={diet} onChange={(e) => setDiet(e.target.value)}><option value="">No preference</option>{diets.filter((value) => value !== "No preference").map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="block text-sm text-fitx-text-secondary">Meals per day<select className="fitx-field mt-1.5" value={mealsPerDay} onChange={(e) => setMealsPerDay(Number(e.target.value))}>{[2,3,4,5,6].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
          <fieldset><legend className="text-sm text-fitx-text-secondary">Allergies or intolerances</legend><div className="mt-2 flex flex-wrap gap-2">{allergyOptions.map((value) => <Choice key={value} selected={allergies.includes(value)} onClick={() => toggle(allergies,setAllergies,value)}>{value}</Choice>)}</div></fieldset>
        </div>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-red-300/20 bg-red-300/5 px-3 py-2 text-sm text-red-200">{error}</p>}
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-fitx-divider pt-5">
          {step > 1 ? <button type="button" onClick={() => {setStep(step-1);setError("");}} className="fitx-button fitx-button-secondary"><ArrowLeft size={16}/>Back</button> : <span/>}
          <button type="submit" disabled={saving} className="fitx-button">{step === 3 ? (saving ? "Saving…" : "Finish setup") : "Continue"}{step === 3 ? <Check size={16}/> : <ArrowRight size={16}/>}</button>
        </div>
      </form>
    </div>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-sm transition-colors ${selected ? "border-fitx-primary/50 bg-fitx-primary/10 text-fitx-primary" : "border-fitx-border bg-fitx-surface text-fitx-text-secondary hover:border-fitx-primary/30 hover:text-fitx-text"}`}>{children}</button>;
}
