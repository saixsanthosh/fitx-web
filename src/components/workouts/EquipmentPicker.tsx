"use client";

import { Check } from "lucide-react";
import { EQUIPMENT, type EquipmentKind, type TrainingContext } from "@/lib/training/taxonomy";

const GROUPS: Array<{ kinds: EquipmentKind[]; title: string }> = [
  { kinds: ["free_weight"], title: "Free weights" },
  { kinds: ["station", "household"], title: "Benches, bars and stations" },
  { kinds: ["accessory"], title: "Accessories" },
  { kinds: ["machine"], title: "Machines" },
  { kinds: ["specialty"], title: "Specialist" },
];

/**
 * A multi-select of equipment keys (src/lib/training/taxonomy.ts), grouped by kind. An empty
 * selection means "no equipment". Shared with Profile so both edit the same keys.
 */
export function EquipmentPicker({ value, onChange, context, disabled = false }: { value: readonly string[]; onChange: (keys: string[]) => void; context: TrainingContext; disabled?: boolean }) {
  const selected = new Set(value);
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(EQUIPMENT.map((item) => item.key).filter((item) => next.has(item)));
  };
  // At home the machines and specialist kit are rare; they stay available but come last.
  const groups = context === "home" ? [...GROUPS.filter((group) => !group.kinds.includes("machine") && !group.kinds.includes("specialty")), ...GROUPS.filter((group) => group.kinds.includes("machine") || group.kinds.includes("specialty"))] : GROUPS;
  return (
    <div className="space-y-4">
      <button type="button" disabled={disabled} onClick={() => onChange([])} aria-pressed={selected.size === 0}
        className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors ${selected.size === 0 ? "border-fitx-primary bg-fitx-primary/[.08]" : "border-fitx-border hover:border-fitx-primary/40"}`}>
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${selected.size === 0 ? "border-fitx-primary bg-fitx-primary text-fitx-on-primary" : "border-fitx-border"}`}>{selected.size === 0 && <Check size={13} aria-hidden="true" />}</span>
        <span><span className="font-medium">No equipment</span><span className="block text-xs text-fitx-text-secondary">Body weight, the floor and a wall</span></span>
      </button>
      {groups.map((group) => {
        const items = EQUIPMENT.filter((item) => group.kinds.includes(item.kind));
        return (
          <fieldset key={group.title}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-fitx-text-secondary">{group.title}</legend>
            <div className="flex flex-wrap gap-2">
              {items.map((item) => {
                const on = selected.has(item.key);
                return (
                  <button key={item.key} type="button" disabled={disabled} aria-pressed={on} onClick={() => toggle(item.key)}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${on ? "border-fitx-primary bg-fitx-primary/[.08] text-fitx-text" : "border-fitx-border text-fitx-text-secondary hover:border-fitx-primary/40"}`}>
                    {on && <Check size={14} aria-hidden="true" className="text-fitx-primary-text" />}{item.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
