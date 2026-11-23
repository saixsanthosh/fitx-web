/**
 * Home's moving backgrounds: each scene is a Nano Banana still (src/data/home-scenes-media.ts) brought to life
 * in code as a cinemagraph, with movement that belongs to the picture (dust in a beam of light, rain on a
 * track, mist on water, a sun rising). Every quote names its scene (src/data/quotes.ts), chosen for its mood.
 *
 * `focus` is the object-position that keeps the subject in frame when the wide still is cropped to a tall
 * phone screen; `motion` picks the layer drawn over it; `drift` the slow camera move.
 */
import { HOMESCENES_MEDIA, type HomescenesMediaId } from "@/data/home-scenes-media";

export type SceneMotion = "dust" | "rain" | "mist" | "rays" | "glow";
export type SceneDrift = "push" | "rise" | "pan";
export type Scene = { id: HomescenesMediaId; focus: string; motion: SceneMotion; drift: SceneDrift };

export const SCENES: Readonly<Record<HomescenesMediaId, Scene>> = {
  "dawn-road": { id: "dawn-road", focus: "50% 55%", motion: "glow", drift: "push" },
  "chalk-bar": { id: "chalk-bar", focus: "48% 50%", motion: "dust", drift: "push" },
  "stadium-steps": { id: "stadium-steps", focus: "50% 45%", motion: "rays", drift: "rise" },
  "rain-track": { id: "rain-track", focus: "50% 60%", motion: "rain", drift: "push" },
  "iron-room": { id: "iron-room", focus: "50% 55%", motion: "dust", drift: "pan" },
  "heavy-bag": { id: "heavy-bag", focus: "62% 45%", motion: "dust", drift: "pan" },
  "lake-dawn": { id: "lake-dawn", focus: "50% 55%", motion: "mist", drift: "push" },
  "pine-light": { id: "pine-light", focus: "45% 55%", motion: "rays", drift: "rise" },
  "ridge-sunrise": { id: "ridge-sunrise", focus: "48% 55%", motion: "glow", drift: "rise" },
  "window-corner": { id: "window-corner", focus: "58% 60%", motion: "rays", drift: "pan" },
  "rest-bench": { id: "rest-bench", focus: "58% 55%", motion: "dust", drift: "pan" },
  "pebble-shore": { id: "pebble-shore", focus: "60% 60%", motion: "mist", drift: "push" },
};

export const DEFAULT_SCENE: HomescenesMediaId = "dawn-road";

/** The scene for a quote's `scene` key; an unknown key falls back to the dawn road. */
export function sceneFor(key: string | null | undefined): Scene {
  return key && key in SCENES ? SCENES[key as HomescenesMediaId] : SCENES[DEFAULT_SCENE];
}

export function sceneImage(scene: Scene) {
  return HOMESCENES_MEDIA[scene.id];
}
