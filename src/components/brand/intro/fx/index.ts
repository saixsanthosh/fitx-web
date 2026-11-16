/**
 * FX module barrel: quality tiers, post chain + grades, particle bursts, sun flare.
 * Main thread only (imports three).
 */

export { detectQuality, downgradeQuality, qualityForTier, type QualitySettings, type QualityViewport } from "./quality";
export { createPost, FILM_TONE_MAPPING, GRADES, mixGrades, NEUTRAL_GRADE, type GradeName, type GradeParams, type GradeRGB, type IntroPost, type PostOptions } from "./post";
export {
  createChalkBurst,
  createDustBurst,
  createGritBurst,
  type BurstLightOptions,
  type ChalkBurstOptions,
  type DustBurstOptions,
  type GritBurstOptions,
  type LitBurst,
  type ParticleBurst,
} from "./particles";
export { createSunFlare, type SunFlare, type SunFlareOptions } from "./flare";
export { disposeFxTextures } from "./textures";
