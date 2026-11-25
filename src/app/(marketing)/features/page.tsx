import Link from "next/link";
import { Barcode, BookOpen, ChartNoAxesColumnIncreasing, Droplets, Dumbbell, Footprints, Utensils } from "lucide-react";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({ title: "Features", description: "Gym plans, the exercise library, food logging, barcode lookup, activity tracking, water and progress in FITX.", path: "/features" });

const items = [
  { icon: Dumbbell, title: "Gym plans", text: "Plan sessions and log every set." },
  { icon: BookOpen, title: "Exercise library", text: "Find a movement by name or muscle." },
  { icon: Utensils, title: "Food log", text: "Log meals in grams or pieces." },
  { icon: Barcode, title: "Barcode lookup", text: "Scan packaged food (Open Food Facts)." },
  { icon: Footprints, title: "Activity", text: "Walk, run and ride with a live GPS route." },
  { icon: Droplets, title: "Water", text: "Tap to log, against your daily goal." },
  { icon: ChartNoAxesColumnIncreasing, title: "Progress", text: "Sessions, records and measurements over time." },
];

export default function FeaturesPage() {
  return (
    <main id="main-content" className="fitx-container flex-1 py-14 lg:py-20">
      <p className="text-xs font-semibold uppercase tracking-[.2em] text-fitx-primary-text">FITX</p>
      <h1 className="mt-3 font-heading text-4xl font-extrabold tracking-[-0.05em] sm:text-6xl">Features</h1>
      <ul className="mt-10 grid border-t border-fitx-divider sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-3">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-4 border-b border-fitx-divider py-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fitx-surface-variant text-fitx-primary-text"><Icon size={20} aria-hidden="true" /></span>
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-fitx-text-secondary">{text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-10 flex flex-wrap gap-3">
        {/* Like every sign-up and sign-in link on the public pages, not prefetched: that would load the sign-in
            pages' styles here for nothing on most visits (bug 95). */}
        <Link href="/signup" prefetch={false} className="fitx-button min-h-11 px-4 fitx-when-signed-out">Create account</Link>
        <Link href="/signin" prefetch={false} className="fitx-button fitx-button-secondary min-h-11 px-4 fitx-when-signed-out">Sign in</Link>
        <Link href="/dashboard" className="fitx-button min-h-11 px-4 fitx-when-signed-in">Open dashboard</Link>
      </div>
    </main>
  );
}
