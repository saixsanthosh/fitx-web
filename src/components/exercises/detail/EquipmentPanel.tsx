import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EquipmentIcon } from "@/components/equipment/EquipmentIcon";
import { equipmentFor } from "@/lib/training/data";
import { equipmentLabel, expandOwnedEquipment, missingEquipment } from "@/lib/training/equipment";
import type { EquipmentState } from "@/lib/training/exercise-detail";
import type { TrainingContext } from "@/lib/training/taxonomy";

const CONTEXT_NAMES: Record<TrainingContext, string> = { home: "Home", gym: "Gym" };

type EquipmentPanelProps = {
  required: readonly string[];
  /** The member's Home and Gym lists; null while they load (or when signed out). */
  equipment: EquipmentState | null;
  signedIn: boolean;
  /** Opens the alternatives (on the Muscles tab). */
  onShowAlternatives: () => void;
};

/** What the exercise needs, drawn, and what is missing from the member's Home and Gym lists. */
export function EquipmentPanel({ required, equipment, signedIn, onShowAlternatives }: EquipmentPanelProps) {
  const lists = equipment ? (["home", "gym"] as const).map((context) => {
    const list = equipmentFor(equipment.profiles, context, equipment.legacyWords);
    return { context, saved: list.saved, missing: missingEquipment(required, expandOwnedEquipment(list.keys)) };
  }) : null;
  const missingSomewhere = lists?.some((list) => list.missing.length > 0) ?? false;
  return (
    <section aria-labelledby="exercise-equipment-heading" className="fitx-panel p-4">
      <h2 id="exercise-equipment-heading" className="text-sm font-semibold text-fitx-text">Equipment</h2>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {required.length ? required.map((key) => (
          <li key={key} className="flex items-center gap-3 text-sm text-fitx-text">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-fitx-surface-variant text-fitx-text"><EquipmentIcon name={key} size={26} /></span>
            {equipmentLabel(key)}
          </li>
        )) : (
          <li className="flex items-center gap-3 text-sm text-fitx-text">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-fitx-surface-variant text-fitx-text"><EquipmentIcon name="none" size={26} /></span>
            No equipment: body weight, the floor and a wall.
          </li>
        )}
      </ul>
      {lists && (
        <ul className="m-0 mt-3 list-none space-y-1.5 border-t border-fitx-divider p-0 pt-3 text-sm">
          {lists.map(({ context, missing }) => (
            <li key={context} className="flex items-start gap-2">
              <span className="mt-px w-12 shrink-0 text-[11px] font-semibold uppercase tracking-[.08em] text-fitx-text-secondary">{CONTEXT_NAMES[context]}</span>
              <span className={missing.length ? "text-fitx-text" : "text-fitx-text-secondary"}>
                {missing.length ? `Missing at ${context === "home" ? "home" : "your gym"}: ${missing.map(equipmentLabel).join(", ")}` : `You have what this needs ${context === "home" ? "at home" : "at your gym"}.`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {lists && equipment && (
        <p className="mt-2 text-xs leading-5 text-fitx-text-secondary">
          {listSourceNote(lists, equipment)}{" "}
          {equipment.profiles.available
            ? <Link href="/workouts" className="font-medium"><span className="text-fitx-primary-text underline underline-offset-2">Edit lists</span></Link>
            : "Saving your own lists becomes available with the next FITX update."}
        </p>
      )}
      {!lists && signedIn && <p className="mt-3 text-xs text-fitx-text-secondary" role="status">Checking your Home and Gym equipment…</p>}
      <button type="button" onClick={onShowAlternatives} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-fitx-primary-text hover:underline">
        {missingSomewhere ? "Alternatives you can do" : "Other equipment and alternatives"}<ArrowRight size={15} aria-hidden="true" />
      </button>
    </section>
  );
}

function listSourceNote(lists: Array<{ context: TrainingContext; saved: boolean }>, equipment: EquipmentState) {
  if (equipment.failed) return "Your lists could not be loaded; starting lists used.";
  const [home, gym] = lists;
  if (home.saved && gym.saved) return "Checked against your saved lists.";
  if (!home.saved && !gym.saved) return "Checked against starting lists (a full gym).";
  return home.saved ? "Gym: a starting list (a full gym)." : "Home: a starting list from your profile.";
}
