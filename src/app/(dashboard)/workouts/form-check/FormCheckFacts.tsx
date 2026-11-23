import { Info, ScanLine, ShieldCheck } from "lucide-react";

const FACTS = [
  { icon: ShieldCheck, title: "Stays on your device", body: "The video is never uploaded or recorded. Only counts are kept." },
  { icon: ScanLine, title: "One 2D camera view", body: "Counts are a helper: light, clothing and angle matter." },
  { icon: Info, title: "Not medical advice", body: "General technique cues. Stop if anything hurts." },
] as const;

/** The three promises, kept short. */
export function FormCheckFacts() {
  return (
    <section aria-label="How Home workout works" className="grid gap-px overflow-hidden rounded-2xl border border-fitx-border bg-fitx-divider sm:grid-cols-3">
      {FACTS.map(({ icon: Icon, title, body }) => (
        <div key={title} className="flex gap-3 bg-fitx-surface px-4 py-3.5">
          <Icon size={17} className="mt-0.5 shrink-0 text-fitx-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-fitx-text">{title}</p>
            <p className="mt-0.5 text-xs leading-5 text-fitx-text-secondary">{body}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
