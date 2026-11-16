/**
 * Sets & props for the FITX intro (main thread, three.js). See `types.ts` for the contracts.
 *
 * Sets: one environment each, authored around its own origin; the director shows one at a time,
 * applies `set.lighting(variant)` to the fixed rig (`lighting.ts`) and assigns `set.environment`
 * to `scene.environment`. Props: the road bike, the barbell and the smoothie glasses that the
 * motion system locks hands/feet to (`dimensions.ts`).
 */

export type { IntroSet, SetName, SetOptions, BikeProp, BarbellProp, BarbellPlate, SmoothieProp } from "./types";
export { createTrackSet } from "./track";
export { createGymSet } from "./gym";
export { createKitchenSet } from "./kitchen";
export { createStudioSet } from "./studio";
export { createBike, bikePedalLocal } from "./props/bike";
export { createBarbell } from "./props/barbell";
export { createSmoothie } from "./props/smoothie";
export {
  KEY_DIRS,
  TRACK_KEY_MAST,
  TRACK_VARIANTS,
  GYM_VARIANTS,
  KITCHEN_VARIANTS,
  STUDIO_VARIANTS,
  STUDIO_BAR,
  trackPreset,
  gymPreset,
  kitchenPreset,
  studioPreset,
  shiftPreset,
} from "./presets";
export { ENV_SIZE } from "./util/env";
