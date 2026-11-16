import type { LucideIcon } from "lucide-react";
import { ModuleState } from "@/components/module-state";

export function UnavailableModule({ title, eyebrow, description, icon: Icon }: { title: string; eyebrow: string; description: string; icon: LucideIcon }) {
  return (
    <div className="page-stack">
      <div className="page-heading-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-lede">{description}</p></div><span className="page-heading-icon"><Icon aria-hidden="true" size={20} /></span></div>
      <section className="report-note module-explanation"><p className="eyebrow">SOURCE CHECK</p><h2>No verified data source is connected.</h2><p>This panel stays empty until FITX has a real provider or database record for this workflow. It does not invent example records, amounts, requests, or statuses.</p></section>
    </div>
  );
}

export { ModuleState };
