/**
 * Colour palettes (sRGB hex) for the sets. Surface albedos are physical and identical in both
 * themes (night is a lighting change, not a repaint); what changes per theme is skies, emitters,
 * haze and window views. Brand coral: #C44933 (light) / #ED725C (dark).
 */

import type { Theme } from "../types";
import type { SkyParams } from "./util/sky";

export const CORAL = 0xc44933;
export const CORAL_BRIGHT = 0xed725c;

export const TRACK_COLORS = {
  granule: 0xb5553b,
  granuleDark: 0x4a2e26,
  binder: 0x94442f,
  paint: 0xf3f0e8,
  hurdleYellow: 0xe3c23c,
  hurdleBlue: 0x3d77c2,
  kerb: 0xeeece6,
  curb: 0xc9c4b9,
  bitumen: 0x2a2c2e,
  stoneA: 0x6c6d6b,
  stoneB: 0x9a9891,
  bikeEdge: 0xd9573f,
  bikeLine: 0xf0eee8,
  grassDark: 0x2c5a1d,
  grassLight: 0x5f9432,
  grassDry: 0x9a9a52,
  concrete: 0xb8b2a6,
  concreteDark: 0x8f897d,
  standConcrete: 0xa9a399,
  seatCoral: CORAL,
  seatGraphite: 0x3a3f43,
  seatGrey: 0xb9b6ae,
  steel: 0x8e9295,
  steelDark: 0x45494c,
  fence: 0xe6e4de,
  roof: 0x5b6064,
  treeDark: 0x2c3a26,
  treeLight: 0x46592f,
} as const;

export interface TrackThemeColors {
  sky: Omit<SkyParams, "sunDir" | "pollutionDir">;
  /** Distant silhouettes: base colour and the haze they fade into. */
  skyline: { base: number; lit: number; haze: number; hazeNear: number; windows: number; windowAmount: number };
  trees: { dark: number; light: number; rim: number; haze: number; rimAmount: number };
  floodlamp: { color: number; intensity: number; cone: number };
  roofStrip: { color: number; intensity: number };
}

export const TRACK_THEME: Record<Theme, TrackThemeColors> = {
  light: {
    sky: {
      zenith: 0x2c62b4,
      horizon: 0xc4d2e4,
      horizonWarm: 0xffa556,
      ground: 0x5d5446,
      sunColor: 0xffc274,
      sunDisc: 46,
      sunRadius: 0.0105,
      glow: 1.0,
      clouds: 0.32,
      cloudLit: 0xffc8a2,
      cloudShade: 0x8e9ab8,
      stars: 0,
      pollutionColor: 0x000000,
      pollution: 0,
      exposure: 0.95,
    },
    skyline: { base: 0x657084, lit: 0xd9a07a, haze: 0xd3c3b6, hazeNear: 0xb9b3ad, windows: 0xffc98a, windowAmount: 0 },
    trees: { dark: 0x1b2816, light: 0x445f2c, rim: 0xffc27a, haze: 0xc4b6a6, rimAmount: 0.9 },
    floodlamp: { color: 0xe8ecf4, intensity: 0.0, cone: 0 },
    roofStrip: { color: 0xf2f2ee, intensity: 0.0 },
  },
  dark: {
    sky: {
      zenith: 0x040812,
      horizon: 0x18213a,
      horizonWarm: 0x232a44,
      ground: 0x07090c,
      sunColor: 0x9fb4ff,
      sunDisc: 0,
      sunRadius: 0.004,
      glow: 0.0,
      clouds: 0.35,
      cloudLit: 0x2a3148,
      cloudShade: 0x10141f,
      stars: 1,
      pollutionColor: 0x6a4a30,
      pollution: 0.55,
      exposure: 1,
    },
    skyline: { base: 0x0c1019, lit: 0x141a26, haze: 0x1b2236, hazeNear: 0x141a2a, windows: 0xffc07a, windowAmount: 1 },
    trees: { dark: 0x040605, light: 0x0b100d, rim: 0x000000, haze: 0x141a28, rimAmount: 0 },
    floodlamp: { color: 0xeef2ff, intensity: 60, cone: 1 },
    roofStrip: { color: 0xf4f6ff, intensity: 9 },
  },
};

export const GYM_COLORS = {
  brickA: 0x8e4a35,
  brickB: 0x6f3a2b,
  brickBurnt: 0x3f2a24,
  mortar: 0x9c9284,
  concrete: 0x8a8780,
  concreteDark: 0x5e5b55,
  concreteLight: 0xa7a39a,
  rubber: 0x1c1d1e,
  fleckGrey: 0x6b6d70,
  fleckBlue: 0x3f5368,
  fleckCoral: 0xb8533c,
  plywood: 0xc99a62,
  plywoodDark: 0x9d7041,
  plywoodWarm: 0xb07e48,
  steelBlack: 0x1d1f21,
  steelFrame: 0x2b2e30,
  chrome: 0xd8dadc,
  plateCoral: CORAL,
  plateGraphite: 0x34383b,
  iron: 0x242628,
  chalk: 0xf2f0ea,
  wood: 0xa8774a,
  deck: 0x4b4f52,
} as const;

export interface GymThemeColors {
  window: { color: number; intensity: number };
  shaft: { color: number; intensity: number };
  dust: { color: number; intensity: number };
  lamp: { color: number; intensity: number };
  envWall: number;
}

export const GYM_THEME: Record<Theme, GymThemeColors> = {
  light: {
    window: { color: 0xfff0dc, intensity: 3.2 },
    shaft: { color: 0xffd8a8, intensity: 0.34 },
    dust: { color: 0xffe2bc, intensity: 1.0 },
    lamp: { color: 0xffd6a0, intensity: 1.5 },
    envWall: 0x6a5446,
  },
  dark: {
    window: { color: 0x7f97d8, intensity: 1.6 },
    shaft: { color: 0x9fb5ff, intensity: 0.34 },
    dust: { color: 0xc8d6ff, intensity: 0.6 },
    lamp: { color: 0xffa54d, intensity: 24 },
    envWall: 0x2a221c,
  },
};

export const KITCHEN_COLORS = {
  oakLight: 0xc99e6e,
  oakDark: 0x8f6339,
  oakWarm: 0xb4844f,
  walnutLight: 0x8a5d3b,
  walnutDark: 0x4f3220,
  plaster: 0xe9e2d6,
  plasterShade: 0xd6ccbc,
  ceramic: 0xefe9de,
  ceramicSpeck: 0x5a4c40,
  ceramicPool: 0xd8cfc0,
  ceramicDark: 0x2f3233,
  salmonA: 0xf3743f,
  salmonB: 0xe2542d,
  salmonFat: 0xfbe2cf,
  avocadoIn: 0xd8d98a,
  avocadoMid: 0x9ebc4c,
  avocadoSkin: 0x2f4a1f,
  greenDark: 0x1f4a1c,
  greenLight: 0x3f7a2c,
  greenVein: 0x7fae55,
  quinoaCream: 0xe7d6b3,
  quinoaRed: 0x9c4a32,
  quinoaBlack: 0x2a2420,
  tomato: 0xd52f1f,
  tomatoGel: 0xf06a3a,
  tomatoSeed: 0xf1d27a,
  edamame: 0x7fae3e,
  sesame: 0xf2e7cf,
  sauce: 0xf0904e,
  smoothieBerry: 0xc0405a,
  smoothieGreen: 0x8bb34a,
  straw: 0xf4f1ea,
  strawStripe: CORAL,
  linen: 0xe6e0d3,
  steel: 0xc8cacc,
  leaf: 0x2f5a2a,
  leafLight: 0x5d8c3c,
  pot: 0xd9cfc2,
  potDark: 0x3a3d3d,
  jarLid: 0x2b2b2b,
  shelf: 0x8a5d3b,
  counter: 0xe7e2da,
} as const;

export interface KitchenThemeColors {
  window: { color: number; intensity: number };
  pendant: { color: number; intensity: number };
  outside: Omit<SkyParams, "sunDir" | "pollutionDir">;
  envWarm: number;
}

export const KITCHEN_THEME: Record<Theme, KitchenThemeColors> = {
  light: {
    window: { color: 0xfff2e0, intensity: 1.0 },
    pendant: { color: 0xffd2a0, intensity: 0.4 },
    outside: {
      zenith: 0x6f9ad2, horizon: 0xe6e0d6, horizonWarm: 0xffc08a, ground: 0x8a8a70, sunColor: 0xffd7a0, sunDisc: 22, sunRadius: 0.012, glow: 1.2,
      clouds: 0.25, cloudLit: 0xffe0c0, cloudShade: 0xb8b0b8, stars: 0, pollutionColor: 0, pollution: 0, exposure: 1.35,
    },
    envWarm: 0xd8c2a8,
  },
  dark: {
    window: { color: 0x5a6fa8, intensity: 0.5 },
    pendant: { color: 0xffb36b, intensity: 22 },
    outside: {
      zenith: 0x050915, horizon: 0x1a2440, horizonWarm: 0x262a40, ground: 0x0a0b0e, sunColor: 0x000000, sunDisc: 0, sunRadius: 0.01, glow: 0,
      clouds: 0.2, cloudLit: 0x252c44, cloudShade: 0x0c1018, stars: 0.8, pollutionColor: 0x6a4a30, pollution: 0.7, exposure: 1.2,
    },
    envWarm: 0x4a3522,
  },
};

export interface StudioThemeColors {
  cyc: number;
  floor: number;
  bar: { color: number; intensity: number };
  haze: { color: number; intensity: number };
  envCyc: number;
}

export const STUDIO_THEME: Record<Theme, StudioThemeColors> = {
  light: { cyc: 0xd8d1c7, floor: 0xd3ccc2, bar: { color: 0xff5a38, intensity: 9 }, haze: { color: 0xffd9cc, intensity: 0.05 }, envCyc: 0xd8d0c6 },
  dark: { cyc: 0x2b2d2f, floor: 0x1e1f21, bar: { color: 0xff5a3c, intensity: 11 }, haze: { color: 0xff8a6a, intensity: 0.05 }, envCyc: 0x1c1d1f },
};
