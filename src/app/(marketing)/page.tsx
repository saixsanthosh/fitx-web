import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Barcode, ChartNoAxesColumnIncreasing, Dumbbell, Search, Utensils } from "lucide-react";

export const metadata: Metadata = {
  title: "FITX - Fitness tracking for your real routine",
  description: "Plan workouts, search food and barcode data, log water, and review your personal progress with FITX.",
};

const features = [
  { icon: Dumbbell, title: "Plan a workout", description: "Browse an exercise library and build a plan around your equipment and schedule." },
  { icon: Search, title: "Find food data", description: "Search Open Food Facts and look up packaged foods by barcode." },
  { icon: Utensils, title: "Keep a meal log", description: "Save portions, calories, and macros to your own daily nutrition log." },
  { icon: ChartNoAxesColumnIncreasing, title: "Review your progress", description: "See the workout, nutrition, water, and body measurements you choose to record." },
];

export default function HomePage() {
  return <main>
    <section className="relative isolate overflow-hidden border-b border-fitx-divider"><div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 -z-10 h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,rgba(121,223,131,.12),transparent_68%)]"/>
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.08fr_.92fr] lg:px-8 lg:py-28">
        <div><p className="text-xs font-semibold uppercase tracking-[.24em] text-fitx-primary">Your personal fitness workspace</p><h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-.04em] text-fitx-text sm:text-5xl lg:text-6xl">Plan training. Log meals. See your progress.</h1><p className="mt-6 max-w-xl text-base leading-7 text-fitx-text-secondary">FITX brings workout planning, food search, meal and water logs, and progress history into one place you control.</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/signup" className="fitx-button min-h-12 px-5">Create your free account<ArrowRight size={17}/></Link><Link href="/signin" className="fitx-button fitx-button-secondary min-h-12 px-5">Sign in</Link></div><p className="mt-4 text-xs text-fitx-text-disabled">Your dashboard reflects the entries you make.</p></div>
        <div aria-label="FITX feature preview" className="grid gap-3 sm:grid-cols-2">
          <div className="fitx-panel min-h-48 p-5 sm:translate-y-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg border border-fitx-primary/20 bg-fitx-primary/10 text-fitx-primary"><Dumbbell size={19}/></span><h2 className="font-medium">Workout plans</h2></div><div className="mt-7 space-y-2"><div className="h-2 w-4/5 rounded bg-white/10"/><div className="h-2 w-3/5 rounded bg-white/10"/><div className="mt-4 inline-flex items-center gap-2 text-xs text-fitx-text-secondary"><span className="h-1.5 w-1.5 rounded-full bg-fitx-primary"/>Exercises, sets, and sessions</div></div></div>
          <div className="fitx-panel min-h-48 p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg border border-fitx-primary/20 bg-fitx-primary/10 text-fitx-primary"><Utensils size={19}/></span><h2 className="font-medium">Food and water</h2></div><div className="mt-7 flex gap-2"><span className="grid h-10 flex-1 place-items-center rounded-lg border border-fitx-border bg-black/20 text-fitx-text-secondary"><Search size={17}/></span><span className="grid h-10 w-12 place-items-center rounded-lg border border-fitx-border bg-black/20 text-fitx-text-secondary"><Barcode size={17}/></span></div><p className="mt-4 text-xs text-fitx-text-secondary">Search foods or scan a barcode</p></div>
          <div className="fitx-panel min-h-48 p-5 sm:translate-y-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg border border-fitx-primary/20 bg-fitx-primary/10 text-fitx-primary"><ChartNoAxesColumnIncreasing size={19}/></span><h2 className="font-medium">Progress history</h2></div><div className="mt-7 flex h-12 items-end gap-2" aria-hidden="true">{[36,55,44,70,53,82,64].map((height,index)=><span key={index} className="flex-1 rounded-t bg-fitx-primary/70" style={{height:`${height}%`}}/>)}</div><p className="mt-3 text-xs text-fitx-text-secondary">A view built from your own logs</p></div>
          <div className="fitx-panel min-h-48 p-5"><p className="text-[11px] font-semibold uppercase tracking-[.18em] text-fitx-text-disabled">Built for your routine</p><p className="mt-4 text-lg font-medium leading-7">Choose what to record. Keep the plan practical.</p><Link href="/features" className="mt-4 inline-flex items-center gap-2 text-xs text-fitx-primary hover:underline">Explore FITX features<ArrowRight size={14}/></Link></div>
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20"><div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[.2em] text-fitx-primary">A clear daily workflow</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">The tools you need, without the noise.</h2><p className="mt-4 text-sm leading-6 text-fitx-text-secondary">Start with the parts that fit your goals. Each page uses your own account data and gives you a clear place to continue.</p></div><div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{features.map(({icon:Icon,title,description})=><article key={title} className="fitx-panel p-5"><Icon size={20} className="text-fitx-primary"/><h3 className="mt-4 font-medium">{title}</h3><p className="mt-2 text-xs leading-5 text-fitx-text-secondary">{description}</p></article>)}</div></section>
    <section className="border-y border-fitx-divider bg-[#0c1112]"><div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8"><div><h2 className="text-2xl font-semibold">Make your next session easier to plan.</h2><p className="mt-2 text-sm text-fitx-text-secondary">Create an account to save workouts, meals, and personal progress.</p></div><Link href="/signup" className="fitx-button min-h-11 shrink-0 px-4">Get started<ArrowRight size={16}/></Link></div></section>
  </main>;
}
