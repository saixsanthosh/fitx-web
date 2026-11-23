import type { FocusArea } from "@/lib/training/focus";

/**
 * How each area's tile crops the body map (MuscleRail): `scale` is the figure's width as a multiple of the tile's,
 * `top` how far down the figure (per cent of its height) the tile starts. The figure is 188 × 416 drawing units, so
 * a square tile shows 1 / (2.21 × scale) of its height.
 */
export const AREA_CROPS: Readonly<Record<FocusArea, { scale: number; top: number }>> = {
  full_body: { scale: 0.46, top: 0 },
  chest: { scale: 1.6, top: 13 },
  back: { scale: 1.2, top: 12 },
  shoulders: { scale: 1.6, top: 11 },
  arms: { scale: 1.08, top: 13 },
  abs: { scale: 1.5, top: 22 },
  legs: { scale: 0.88, top: 47 },
  glutes: { scale: 1.6, top: 40 },
};
