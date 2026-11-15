import Link from "next/link";
import { Barcode, ChartNoAxesColumnIncreasing, Dumbbell, Droplets, Utensils } from "lucide-react";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({ title: "Features", description: "Explore workout planning, exercise instructions, nutrition and calorie logging, water tracking, and progress history in FITX.", path: "/features" });
const items = [
  { icon: Dumbbell, title: "Workout planning", text: "Create and schedule plans, choose movements, and record working sets in an active session." },
  { icon: Barcode, title: "Exercise library", text: "Search movements by name or muscle group and review equipment, instructions, and suggested sets." },
  { icon: Utensils, title: "Nutrition logging", text: "Search food data, choose a portion, and save meals with calories and macronutrients." },
  { icon: Barcode, title: "Barcode lookup", text: "Look up packaged food products through Open Food Facts when a barcode is available." },
  { icon: Droplets, title: "Water tracking", text: "Log water in simple increments and compare it with your personal daily goal." },
  { icon: ChartNoAxesColumnIncreasing, title: "Progress history", text: "Review the workouts and body measurements you have recorded over time." },
];
export default function FeaturesPage() {
  return <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-14 sm:px-6 lg:px-8 lg:py-20"><p className="text-xs font-semibold uppercase tracking-[.2em] text-fitx-primary">FITX features</p><h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Useful tools for the parts of fitness you want to track.</h1><p className="mt-5 max-w-2xl text-sm leading-6 text-fitx-text-secondary">FITX keeps your plans and logs together. You decide what to record, and your progress views use your saved entries.</p><div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(({icon:Icon,title,text})=><article key={title} className="fitx-panel p-5 sm:p-6"><span className="grid h-11 w-11 place-items-center rounded-lg border border-fitx-primary/20 bg-fitx-primary/10 text-fitx-primary"><Icon size={20}/></span><h2 className="mt-5 text-base font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-fitx-text-secondary">{text}</p></article>)}</div><div className="mt-10 flex flex-wrap gap-3"><Link href="/signup" className="fitx-button min-h-11 px-4">Create account</Link><Link href="/signin" className="fitx-button fitx-button-secondary min-h-11 px-4">Sign in</Link></div></main>;
}
