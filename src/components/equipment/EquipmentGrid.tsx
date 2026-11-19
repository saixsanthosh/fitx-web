"use client";

import { Check } from "lucide-react";
import { EQUIPMENT, type TrainingContext } from "@/lib/training/taxonomy";
import { EquipmentIcon } from "./EquipmentIcon";

/** Home: the kit people keep at home. Gym: machines first, then free weights, stations, accessories and
 * specialist kit (household items such as a chair are left out there). */
const HOME_ITEMS = EQUIPMENT.filter((item) => item.homeFriendly);
const GYM_ITEMS = (["machine", "free_weight", "station", "accessory", "specialty"] as const).flatMap((kind) => EQUIPMENT.filter((item) => item.kind === kind));

/** The keys the grid offers for a context, in display order. */
export function equipmentGridKeys(context: TrainingContext): string[] {
  return (context === "home" ? HOME_ITEMS : GYM_ITEMS).map((item) => item.key);
}

/** The drawings at a large size: 52 px on phones, 64 px from 640 px (CSS sizes the SVG, which draws at 64). */
const ICON = "h-[52px] w-[52px] sm:h-16 sm:w-16";

const tile =
  "group relative flex min-h-[7.5rem] sm:min-h-[8.75rem] flex-col items-center justify-center gap-2 rounded-2xl border px-2 pb-3 pt-4 text-center " +
  "transition-[border-color,background-color,transform] duration-200 motion-safe:active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fitx-primary";
const on = "border-fitx-primary bg-fitx-primary/[.08] text-fitx-text";
const off = "border-fitx-border bg-fitx-surface text-fitx-text-secondary hover:border-fitx-text-disabled hover:text-fitx-text";

function Tick({ shown }: { shown: boolean }) {
  return (
    <span aria-hidden="true" className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full transition-[opacity,transform] duration-200 ${shown ? "scale-100 bg-fitx-primary text-fitx-on-primary opacity-100" : "scale-75 opacity-0"}`}>
      <Check size={14} strokeWidth={3} />
    </span>
  );
}

/**
 * Equipment as a grid of FITX's drawings with their names: tap everything you can use. Each tile is a toggle
 * button (aria-pressed). At home the first tile is "No equipment": it is on while nothing else is, and
 * choosing it clears the list (an empty list means body weight only, as everywhere in FITX). The gym grid
 * has Select all and Clear.
 */
export function EquipmentGrid({ context, value, onChange, label }: { context: TrainingContext; value: readonly string[]; onChange: (keys: string[]) => void; label: string }) {
  const keys = equipmentGridKeys(context);
  const items = context === "home" ? HOME_ITEMS : GYM_ITEMS;
  const selected = new Set(value);
  const order = (next: Set<string>) => EQUIPMENT.map((item) => item.key).filter((key) => next.has(key));
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(order(next));
  };
  const allOn = keys.every((key) => selected.has(key));
  // Items saved earlier that this grid doesn't show (gym machines on a home list) stay as they are.
  const hidden = value.filter((key) => !keys.includes(key));
  return (
    <div role="group" aria-label={label}>
      {context === "gym" && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-fitx-text-secondary" aria-live="polite">{keys.filter((key) => selected.has(key)).length} of {keys.length} selected</p>
          <button type="button" onClick={() => onChange(allOn ? hidden : order(new Set([...value, ...keys])))} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-fitx-primary-text hover:bg-fitx-primary/[.08]">
            {allOn ? "Clear all" : "Select all"}
          </button>
        </div>
      )}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
        {context === "home" && (
          <li>
            <button type="button" aria-pressed={selected.size === 0} onClick={() => onChange([])} className={`${tile} w-full ${selected.size === 0 ? on : off}`}>
              <Tick shown={selected.size === 0} />
              <EquipmentIcon name="none" size={64} className={`${ICON} ${selected.size === 0 ? "text-fitx-primary" : "text-fitx-text"}`} />
              <span className="text-[.8125rem] font-semibold leading-tight">No equipment{" "}<span className="mt-0.5 block text-[.6875rem] font-normal text-fitx-text-secondary">Bodyweight only</span></span>
            </button>
          </li>
        )}
        {items.map((item) => {
          const active = selected.has(item.key);
          return (
            <li key={item.key}>
              <button type="button" aria-pressed={active} onClick={() => toggle(item.key)} className={`${tile} w-full ${active ? on : off}`}>
                <Tick shown={active} />
                <EquipmentIcon name={item.key} size={64} className={`${ICON} transition-transform duration-300 motion-safe:group-hover:-translate-y-0.5 ${active ? "text-fitx-primary" : "text-fitx-text"}`} />
                <span className="text-[.8125rem] font-semibold leading-tight">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
