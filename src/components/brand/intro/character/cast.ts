/**
 * The three FITX athletes. Worker-safe data only.
 *
 * Art direction: believable, athletic, stylised-real adults (think premium sports-brand
 * film, not toys). Coral (#C44933 family) is the shared accent that ties every outfit to
 * the brand. Generators may tune values here when a render review shows a better result.
 */

import { defaultProportions } from "../rig/skeleton";
import type { CharacterId, CharacterSpec } from "./types";

const CORAL = 0xd9573f;

export const MAYA: CharacterSpec = {
  id: "maya",
  seed: 1931,
  proportions: { ...defaultProportions("female", 1.68), shoulderHalfWidth: 0.098, soleHeight: 0.028 },
  build: { muscle: 0.55, bodyFat: 0.24, shoulderMass: 0.25, chestDepth: 0.95, waist: 0.9, glutes: 1.05, thighs: 1, calves: 1, bust: 0.35 },
  // Medium brown (CIELAB L 47, C 27, h 58): flush and shade stay close in hue so warm light
  // and the subsurface term do not push her toward terracotta.
  skin: { base: 0x92664a, flush: 0x985f47, shade: 0x6e4732, response: { wrap: [0.44, 0.2, 0.15], roughness: 0.47, specular: 0.6, sheen: 0.12, sheenColor: 0xe8c4ac } },
  face: { jaw: 0.25, chin: 0.45, cheekbones: 0.65, noseWidth: 0.45, noseLength: 0.45, noseBridge: 0.5, lipFullness: 0.6, browRidge: 0.2, eyeSize: 1.05, irisColor: 0x3b2416 },
  hair: { style: "ponytail", color: 0x2b1d16, highlight: 0x5a3b2a },
  outfit: {
    top: { style: "crop-tank", color: CORAL, accent: 0xf4f1ea },
    bottom: { style: "run-shorts", color: 0x1e2124, accent: CORAL },
    shoes: { style: "runner", upper: 0xedebe6, sole: 0xf4f2ee, accent: 0xe0533b, laces: 0xf2efe9 },
    extras: ["hairTie", "watch"],
  },
};

export const LEO: CharacterSpec = {
  id: "leo",
  seed: 4127,
  proportions: { ...defaultProportions("male", 1.8), shoulderHalfWidth: 0.106, soleHeight: 0.012 },
  build: { muscle: 0.5, bodyFat: 0.16, shoulderMass: 0.2, chestDepth: 0.95, waist: 0.92, glutes: 0.95, thighs: 1.12, calves: 1.05, bust: 0 },
  // Light, warm, outdoors (L 69, C 22, h 58): lighter than this went white and waxy under the
  // studio key; the flush is a warm rose, not pink.
  skin: { base: 0xc9a087, flush: 0xc68e78, shade: 0xa67a62, response: { wrap: [0.42, 0.18, 0.13], roughness: 0.48, specular: 0.6, sheen: 0.12, sheenColor: 0xf0d6c6 } },
  face: { jaw: 0.6, chin: 0.55, cheekbones: 0.5, noseWidth: 0.4, noseLength: 0.55, noseBridge: 0.7, lipFullness: 0.35, browRidge: 0.5, eyeSize: 1, irisColor: 0x56707f },
  hair: { style: "crop", color: 0x6b4e33, highlight: 0x9a7650 },
  facialHair: { style: "stubble", color: 0x6b4e33 },
  outfit: {
    top: { style: "jersey", color: 0x2e3336, accent: CORAL },
    bottom: { style: "bib-shorts", color: 0x16181a, accent: CORAL },
    shoes: { style: "cycling", upper: 0xf1f1ef, sole: 0x1b1c1d, accent: CORAL, laces: 0xf1f1ef },
    extras: ["helmet", "sunglasses"],
  },
};

export const DRE: CharacterSpec = {
  id: "dre",
  seed: 7349,
  proportions: { ...defaultProportions("male", 1.85), shoulderHalfWidth: 0.118, hipHalfWidth: 0.052, neckLength: 0.85, soleHeight: 0.022 },
  build: { muscle: 0.95, bodyFat: 0.3, shoulderMass: 0.95, chestDepth: 1.15, waist: 1.08, glutes: 1.15, thighs: 1.2, calves: 1.1, bust: 0 },
  // Deep brown with warm undertones (L 27, C 19, h 56): a tighter, shinier specular carries the
  // form; little sheen, and a warm one (a pale sheen reads ashy on deep skin).
  skin: { base: 0x563928, flush: 0x5c3728, shade: 0x3a251a, response: { wrap: [0.34, 0.16, 0.12], scatter: [0.9, 0.85, 0.85], roughness: 0.42, specular: 0.72, sheen: 0.06, sheenColor: 0xb08a72 } },
  face: { jaw: 0.85, chin: 0.5, cheekbones: 0.55, noseWidth: 0.75, noseLength: 0.5, noseBridge: 0.35, lipFullness: 0.75, browRidge: 0.65, eyeSize: 0.95, irisColor: 0x2a1a12 },
  hair: { style: "fade", color: 0x141210, highlight: 0x2c2620 },
  facialHair: { style: "beard", color: 0x17130f },
  outfit: {
    top: { style: "tank", color: 0x26292a, accent: CORAL },
    bottom: { style: "training-shorts", color: 0x3a3e3b, accent: CORAL },
    shoes: { style: "lifter", upper: 0x1d1f20, sole: 0xb98a5e, accent: CORAL, laces: 0x2a2c2d },
    extras: ["belt", "wristWraps"],
  },
};

export const CAST: Record<CharacterId, CharacterSpec> = { maya: MAYA, leo: LEO, dre: DRE };

/** Generation order: the first character is needed for the opening shot. */
export const CAST_ORDER: CharacterId[] = ["maya", "leo", "dre"];
