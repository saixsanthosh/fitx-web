import Link from "next/link";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({ title: "About", description: "FITX keeps your training, food and activity in one account, built on the entries you choose to log.", path: "/about" });

const points = [
  { title: "Your entries", text: "Summaries use only what you log." },
  { title: "Clear sources", text: "Food and exercise data name their source and licence." },
  { title: "Your choices", text: "Change goals and preferences any time in your profile." },
];

export default function AboutPage() {
  return (
    <main id="main-content" className="fitx-container flex-1 py-16 lg:py-24">
      <p className="text-xs font-semibold uppercase tracking-[.2em] text-fitx-primary-text">About</p>
      <h1 className="mt-4 max-w-3xl font-heading text-4xl font-extrabold tracking-[-0.05em] sm:text-6xl">Train, eat and move with a plan.</h1>
      <ul className="mt-10 grid border-t border-fitx-divider sm:grid-cols-3 sm:gap-x-10">
        {points.map(({ title, text }) => (
          <li key={title} className="border-b border-fitx-divider py-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-fitx-text-secondary">{text}</p>
          </li>
        ))}
      </ul>
      <Link href="/features" className="fitx-button mt-9 min-h-11 px-4">See features</Link>
    </main>
  );
}
