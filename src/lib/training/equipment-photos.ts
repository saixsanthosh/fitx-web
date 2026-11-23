/**
 * Photos of equipment for the Workouts setup and equipment lists: studio stills generated for FITX (Nano Banana,
 * checked by eye; scripts/media/{equipment,workout-modes}.prompts.json). Each shows the item itself, plain and
 * unbranded, never a person. Items without a photo (sled, strongman implements, other specialist kit, foam
 * roller) show their line icon instead.
 */
import { EQUIPMENT_MEDIA } from "@/data/equipment-media";
import { WORKOUTMODES_MEDIA } from "@/data/workout-modes-media";

export type EquipmentPhoto = { src: string; width: number; height: number; alt: string; blurDataURL: string };

export const EQUIPMENT_PHOTOS: Readonly<Partial<Record<string, EquipmentPhoto>>> = {
  dumbbell: EQUIPMENT_MEDIA.dumbbell,
  kettlebell: EQUIPMENT_MEDIA.kettlebell,
  barbell: EQUIPMENT_MEDIA.barbell,
  resistance_band: EQUIPMENT_MEDIA["resistance-band"],
  pull_up_bar: EQUIPMENT_MEDIA["pull-up-bar"],
  bench: EQUIPMENT_MEDIA.bench,
  box: EQUIPMENT_MEDIA.box,
  squat_rack: EQUIPMENT_MEDIA["squat-rack"],
  cable_machine: EQUIPMENT_MEDIA["cable-machine"],
  machine: EQUIPMENT_MEDIA.machine,
  smith_machine: EQUIPMENT_MEDIA["smith-machine"],
  cardio_machine: EQUIPMENT_MEDIA["cardio-machine"],
  ez_bar: WORKOUTMODES_MEDIA["ez-bar"],
  dip_station: WORKOUTMODES_MEDIA["dip-station"],
  medicine_ball: WORKOUTMODES_MEDIA["medicine-ball"],
  stability_ball: WORKOUTMODES_MEDIA["stability-ball"],
  jump_rope: WORKOUTMODES_MEDIA["jump-rope"],
  suspension_trainer: WORKOUTMODES_MEDIA["suspension-trainer"],
  chair: WORKOUTMODES_MEDIA.chair,
};

export function equipmentPhoto(key: string): EquipmentPhoto | null {
  return EQUIPMENT_PHOTOS[key] ?? null;
}
