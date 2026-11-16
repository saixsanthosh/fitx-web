/**
 * The film's shot list, in `SHOTS` order (timeline.ts). The director indexes this array with the
 * same index as `SHOTS`, so the two must stay aligned (checked below in development).
 */

import { SHOTS } from "../../timeline";
import type { Shot } from "../shot-types";
import { ACT1_SHOTS } from "./act1-track";
import { ACT2_SHOTS } from "./act2-gym";
import { ACT3_SHOTS } from "./act3-finale";

export const SHOT_LIST: readonly Shot[] = [...ACT1_SHOTS, ...ACT2_SHOTS, ...ACT3_SHOTS];

if (process.env.NODE_ENV !== "production") {
  const mismatch = SHOTS.findIndex((shot, index) => SHOT_LIST[index]?.id !== shot.id);
  if (mismatch !== -1 || SHOT_LIST.length !== SHOTS.length) {
    console.error("[FITX intro] SHOT_LIST does not match timeline SHOTS at index", mismatch);
  }
}
