/**
 * Lighting presets for every set, theme and shot variant, authored against the fixed rig in
 * `lighting.ts` (sun = only shadow caster, sky = hemisphere, fill = directional, rim = spot,
 * two point practicals). Positions are in set space. Each call returns a fresh object, so callers
 * may mutate it (e.g. `shiftPreset` to follow a moving subject).
 *
 * Light direction constants live here so the sets (sky disc, window shafts, env bakes) and the
 * presets always agree.
 */

import * as THREE from "three";
import type { LightingPreset, PointPreset } from "../lighting";
import type { Theme, Vec3Tuple } from "../types";

const dir = (azimuthDeg: number, elevationDeg: number): Vec3Tuple => {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
};

/** Unit vectors towards the key light. Azimuth 0° = +Z, 90° = +X. */
export const KEY_DIRS = {
  /** Low sunrise sun over the infield, behind the start line (backlights the +X camera side). */
  trackLight: dir(-143, 8.5),
  /** Night: the corner floodlight mast behind the start, infield side. */
  trackDark: dir(-160.7, 37),
  /** Gym: sun through the back-wall factory windows (from -Z, slightly -X). */
  gymLight: dir(-155, 31),
  /** Gym night: moonlight through the same windows (same direction, so shafts match shadows). */
  gymDark: dir(-155, 31),
  /** Kitchen: low morning sun through the back window, from behind-left. */
  kitchenLight: dir(-150, 22),
  /** Kitchen night: the pendant pair acts as the key from above. */
  kitchenDark: dir(-120, 74),
  /** Studio: large soft key from front-left above (the squad's left; camera right), fairly frontal so faces model. */
  studioLight: dir(28, 40),
  studioDark: dir(30, 38),
} as const;

/** Night floodlight mast head that the track's dark key comes from (lens-flare source). */
export const TRACK_KEY_MAST: Vec3Tuple = [-14, 31.5, -40];

const OFF: PointPreset = { color: 0xffffff, intensity: 0, position: [0, -50, 0], distance: 1, decay: 2 };

const add = (a: Vec3Tuple, b: Vec3Tuple, s = 1): Vec3Tuple => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

interface SunSpec {
  color: number;
  intensity: number;
  dir: Vec3Tuple;
  target: Vec3Tuple;
  extent: number;
  distance?: number;
  radius?: number;
  bias?: number;
  normalBias?: number;
}

function sun(s: SunSpec): LightingPreset["sun"] {
  return {
    color: s.color,
    intensity: s.intensity,
    position: add(s.target, s.dir, s.distance ?? 30),
    target: s.target,
    shadowExtent: s.extent,
    shadowRadius: s.radius ?? 3,
    shadowBias: s.bias ?? -0.0002,
    shadowNormalBias: s.normalBias ?? 0.02,
  };
}

const rimOff = (): LightingPreset["rim"] => ({ color: 0xffffff, intensity: 0, position: [0, 10, 0], target: [0, 0, 0], angle: 0.5, penumbra: 0.6, distance: 30 });

// ---------------------------------------------------------------- track

export const TRACK_VARIANTS = ["base", "macro", "side", "front", "bike", "wheel", "wide"] as const;

/**
 * Night macro key: a distant floodlight low over the infield trees behind the start (a cheat on
 * the high masts so the ground-level shoe macro gets the same low backlight + flare as sunrise),
 * a touch off the sun's bearing so it sits in the same gap over the lace row in both themes.
 * The 0-set shot parks the flare at this direction.
 */
export const TRACK_NIGHT_MACRO_KEY = dir(-144, 9);

export function trackPreset(theme: Theme, variant: string): LightingPreset {
  const v = (TRACK_VARIANTS as readonly string[]).includes(variant) ? variant : "base";
  const targets: Record<string, { target: Vec3Tuple; extent: number; radius: number }> = {
    base: { target: [0.5, 0, 4], extent: 9, radius: 3 },
    macro: { target: [0, 0, -0.2], extent: 1.6, radius: 2 },
    side: { target: [0, 0, 5], extent: 7, radius: 3 },
    front: { target: [1.5, 0, 9], extent: 9, radius: 3 },
    bike: { target: [6.4, 0, 18], extent: 6, radius: 2.5 },
    wheel: { target: [6.4, 0, 24], extent: 6, radius: 2.5 },
    wide: { target: [2, 0, 14], extent: 26, radius: 3 },
  };
  const t = targets[v];
  const macro = v === "macro";
  const side = v === "side";
  if (theme === "light") {
    // The camera-side bounce (fill) for each set-up: the macro's is the warm-white card under the
    // lens that keeps the backlit white shoe white (and lights the kicked grit); 1a's is a neutral
    // bounce so the backlit skin keeps its own colour instead of the tartan's red.
    const fill: LightingPreset["fill"] = macro
      ? { color: 0xffe9d8, intensity: 1.35, position: [4, 3, 7] }
      : side
        ? { color: 0xd9d6dc, intensity: 0.6, position: [6, 4, 10] }
        : { color: 0xaec2e6, intensity: 0.42, position: [6, 4, 10] };
    // 1a: the sun is at the frame edge, too far round behind her to rim the profile on its own;
    // a warm rim from the sun side (behind, right, above) draws her back, shoulders and ponytail.
    const rim: LightingPreset["rim"] = side
      ? { color: 0xffc89a, intensity: 95, position: add(t.target, [-4.5, 2.4, -3.2]), target: add(t.target, [0, 1.15, 0]), angle: 0.24, penumbra: 0.8, distance: 20 }
      : v === "front" || v === "wheel"
        ? { color: 0xffd2a0, intensity: 0, position: add(t.target, [-4, 3, -6]), target: add(t.target, [0, 1, 0]), angle: 0.45, penumbra: 0.8, distance: 30 }
        : rimOff();
    return {
      sun: sun({ color: 0xffc082, intensity: macro ? 6.5 : 7.5, dir: KEY_DIRS.trackLight, target: t.target, extent: t.extent, radius: t.radius, distance: 34, normalBias: macro ? 0.004 : 0.02 }),
      // 1a: less red ground bounce, so brown skin in the shade stays brown rather than brick.
      sky: { color: 0x8fb0de, groundColor: side ? 0x7a5c4c : 0x8c5038, intensity: 0.6 },
      fill,
      rim,
      practicals: [OFF, OFF],
      environmentIntensity: macro ? 0.48 : 0.55,
      exposure: macro ? 1.0 : 0.98,
      fog: { color: 0xd2b79c, density: 0.0024 },
    };
  }
  // Night: a hard neutral-white top-back key from the start-end mast (the macro: a low distant
  // flood), a dim blue ambience, a soft cool rim from the far-end masts on whatever faces the far
  // end (faces in the head-on shots, Maya's leading edge in 1a) and haze that swallows the distance.
  const rimNight = v === "side" ? 240 : v === "front" || v === "wheel" ? 110 : v === "bike" ? 90 : 0;
  return {
    // The macro's low flood is a warm halogen: the shoe's rim and laces read warm-white and the
    // tartan keeps its orange (1a's floodlit tartan is orange too, so the cut holds).
    sun: sun({ color: macro ? 0xffe4c4 : 0xf4efe4, intensity: macro ? 5.4 : 5.6, dir: macro ? TRACK_NIGHT_MACRO_KEY : KEY_DIRS.trackDark, target: t.target, extent: t.extent, radius: t.radius, distance: 34, normalBias: macro ? 0.004 : 0.02 }),
    sky: { color: 0x22335a, groundColor: 0x141210, intensity: 0.28 },
    // Cool bounce from the lit stands on the camera side: just enough to keep faces readable. The
    // macro's is a near-neutral card instead (blue stays in the sky and the environment): a cool
    // fill on the camera side turns the white product periwinkle.
    fill: macro ? { color: 0xe4e6ee, intensity: 1.5, position: [4, 3, 7] } : { color: 0x8aa2e6, intensity: 0.45, position: [10, 9, 14] },
    rim: { color: 0xc8d6ff, intensity: rimNight, position: add(t.target, [-5, 12, 18]), target: add(t.target, [0, 0.9, 0]), angle: 0.6, penumbra: 0.8, distance: 40 },
    practicals: [OFF, OFF],
    environmentIntensity: macro ? 0.32 : 0.3,
    exposure: 1.0,
    // 1a looks across the whole infield: thicker haze lets the far field fall off into the night.
    // The macro's haze swallows the lit mast pole and the tree line behind the shoe.
    fog: { color: 0x0e1422, density: side ? 0.019 : macro ? 0.03 : 0.011 },
  };
}

// ---------------------------------------------------------------- gym

export const GYM_VARIANTS = ["base", "plate", "chalk", "hero", "drop", "wide"] as const;

/** Hanging lamps that the two practicals sit in (set space). */
export const GYM_PRACTICALS: [Vec3Tuple, Vec3Tuple] = [[-1.6, 3.62, 0.4], [1.9, 3.62, -0.8]];

/** Sun shadow framing per gym variant: tight frusta on the macros keep the mullion shadows crisp. */
const GYM_SHADOW: Record<string, { target: Vec3Tuple; extent: number; radius: number }> = {
  base: { target: [-1, 0, -1.5], extent: 9.5, radius: 2.6 },
  wide: { target: [-1, 0, -1.5], extent: 9.5, radius: 2.6 },
  // 3a: the outer plate on the -X sleeve (its face catches the window light at a grazing angle).
  plate: { target: [-0.95, 0.3, 0.08], extent: 1.1, radius: 1.6 },
  chalk: { target: [0, 1.3, -0.15], extent: 1.7, radius: 2.2 },
  hero: { target: [-0.3, 0.7, -0.3], extent: 3.2, radius: 2.4 },
  drop: { target: [0.8, 0.25, 0.1], extent: 1.9, radius: 2 },
};

/**
 * Gym looks. Light: sunrise through the back windows (warm key from behind, warm bounce in front).
 * Dark: moonlight through the same windows, tungsten practicals. The shot variants add the units a
 * DP would rig for each set-up: a rim behind the subject and practical[1] re-purposed as a soft
 * face/body key (motivated by the bounce off the platform or a lamp), so Dre's deep-brown skin reads
 * against bright windows; the hanging lamp practical[0] stays where its bulb is.
 */
export function gymPreset(theme: Theme, variant: string): LightingPreset {
  const v = (GYM_VARIANTS as readonly string[]).includes(variant) ? variant : "base";
  const shadow = GYM_SHADOW[v];
  const light = theme === "light";
  const preset: LightingPreset = light
    ? {
        sun: sun({ color: 0xffd09a, intensity: 9.5, dir: KEY_DIRS.gymLight, target: shadow.target, extent: shadow.extent, radius: shadow.radius, distance: 22, normalBias: 0.015 }),
        sky: { color: 0x9fb0c4, groundColor: 0x4a3c32, intensity: 0.34 },
        fill: { color: 0xa9bdd6, intensity: 0.35, position: [4, 3, 8] },
        rim: rimOff(),
        practicals: [
          { color: 0xffb36b, intensity: 1.2, position: GYM_PRACTICALS[0], distance: 7, decay: 2 },
          { color: 0xffb36b, intensity: 1.2, position: GYM_PRACTICALS[1], distance: 7, decay: 2 },
        ],
        environmentIntensity: 0.42,
        exposure: 1.0,
        fog: { color: 0x6b5d50, density: 0.012 },
      }
    : {
        sun: sun({ color: 0x9fb6ff, intensity: 3.6, dir: KEY_DIRS.gymDark, target: shadow.target, extent: shadow.extent, radius: shadow.radius, distance: 22, normalBias: 0.015 }),
        sky: { color: 0x334263, groundColor: 0x2a2018, intensity: 0.18 },
        fill: { color: 0xffb072, intensity: 0.12, position: [3, 4, 6] },
        rim: rimOff(),
        practicals: [
          // Tungsten, but pale enough that deep-brown skin stays brown rather than terracotta.
          { color: 0xffc08c, intensity: 9, position: GYM_PRACTICALS[0], distance: 9, decay: 2 },
          { color: 0xffc08c, intensity: 9, position: GYM_PRACTICALS[1], distance: 9, decay: 2 },
        ],
        environmentIntensity: 0.34,
        exposure: 1.05,
        fog: { color: 0x1a1a22, density: 0.014 },
      };
  // Units that land on skin stay close to white: saturated warm light pushed Dre's deep-brown skin
  // to terracotta (hue ≈ 20°, saturation ≤ 0.6 is the target on key-lit skin).
  const rim = (position: Vec3Tuple, target: Vec3Tuple, intensity: number, angle = 0.5, distance = 10): LightingPreset["rim"] =>
    ({ color: light ? 0xffdab0 : 0xa9c1ff, intensity, position, target, angle, penumbra: 0.85, distance });
  const key = (position: Vec3Tuple, intensity: number, distance: number): PointPreset =>
    ({ color: light ? 0xffe8d8 : 0xffe4bc, intensity, position, distance, decay: 2 });

  if (v === "plate") {
    // Grazing window light on the plate face; a rim spot behind and above the stack (the window side)
    // grazes the plate's top edge for the low 3/4 the shot ends on.
    preset.sun.intensity = light ? 10 : 5;
    // Little front fill: black rubber should stay black, the raking light does the drawing.
    preset.fill = { color: light ? 0xd8c8b6 : 0x8ea2d6, intensity: light ? 0.28 : 0.22, position: [-6, 2.2, 5] };
    preset.rim = rim([-0.7, 1.15, -1.0], [-0.97, 0.43, 0.08], light ? 18 : 20, 0.3, 4);
    preset.practicals[1] = key([-1.55, 0.42, 0.95], light ? 0.8 : 2.2, 2.2);
    preset.environmentIntensity = light ? 0.38 : 0.36;
    // Exposed for the light, not the rubber: ink and rims carry the face; the window behind the
    // end frame bridges the exposure into the bright 3b.
    preset.exposure = light ? 0.92 : 1.08;
  } else if (v === "chalk") {
    // Backlit 3/4 MCU from the right: window sun rims the far edge, a rim spot the near edge, and a
    // soft key from front-left lights the short side of the face (sculpted, eyes still lit).
    preset.fill = { color: light ? 0xc8b8a8 : 0x7f90c4, intensity: light ? 0.24 : 0.12, position: [3, 1.5, 7] };
    preset.rim = rim([1.5, 2.6, -2.2], [0, 1.5, -0.15], light ? 36 : 32, 0.45, 8);
    preset.practicals[1] = key([-0.5, 2.0, 1.45], light ? 6 : 6.5, 4);
    preset.exposure = light ? 1.02 : 1.05;
    if (!light) {
      // Night: the room falls to black and only the window glow and its one shaft carry the background
      // (a lit hemisphere and env turned the MCU's background into an overcast-day blue haze); the
      // face key carries a little more of the exposure instead.
      preset.sky.intensity = 0.06;
      preset.environmentIntensity = 0.16;
      preset.fill.intensity = 0.07;
      preset.practicals[1] = key([-0.5, 2.0, 1.45], 7.6, 4);
      preset.exposure = 0.98;
    }
  } else if (v === "hero") {
    // Aimed at the back and shoulders: on the head it outlined the beard's edge in a hard bright line.
    preset.rim = rim([-0.6, 3.4, -3.2], [0, 1.05, 0], light ? 30 : 26, 0.44, 12);
    // Soft key high and frontal: the face still reads at lockout, when the chin comes up.
    preset.practicals[1] = key([1.35, 2.35, 2.35], light ? 12 : 15, 7);
    // Night: hold the room down so the moon shafts and the lamp pools carry the frame.
    if (!light) {
      preset.exposure = 0.84;
      preset.sky.intensity = 0.1;
      preset.environmentIntensity = 0.26;
    }
  } else if (v === "drop") {
    // Backlight the dust rings from behind the plates; a low kicker on the plate faces.
    preset.rim = rim([1.5, 1.4, -1.9], [0.9, 0.25, 0.1], light ? 22 : 24, 0.55, 6);
    preset.practicals[1] = key([1.8, 0.55, 1.35], light ? 1.6 : 3, 3);
  }
  return preset;
}

// ---------------------------------------------------------------- kitchen

export const KITCHEN_VARIANTS = ["base", "overhead", "side", "wide"] as const;

/**
 * Pendant fixtures (bulb centres) over the bowls, hung high enough (shade rims at 2.02 m) that the
 * 4a flat-lay lens can sit at ~1.95 m, under them, on a near-orthographic 31 mm lens.
 */
export const KITCHEN_PENDANTS: [Vec3Tuple, Vec3Tuple] = [[-0.36, 2.08, 0], [0.36, 2.08, 0]];
/**
 * Night overhead: where the two pools of pendant light are thrown from. A cheat below the real
 * fixtures (the shade's cone stand-in): a short cut-off range from here keeps two distinct warm
 * pools on the place settings, with the table corners falling into the dark.
 */
const KITCHEN_POOLS: [Vec3Tuple, Vec3Tuple] = [[-0.36, 1.62, 0], [0.36, 1.62, 0]];
/** Morning flat-lay sun: a degree off the window key, so the mullion stripes fall between the bowls. */
const KITCHEN_OVERHEAD_SUN = dir(-151.5, 22);

export function kitchenPreset(theme: Theme, variant: string): LightingPreset {
  const v = (KITCHEN_VARIANTS as readonly string[]).includes(variant) ? variant : "base";
  const overhead = v === "overhead";
  const side = v === "side";
  // Overhead: a tight frustum on the table top and a small radius keep the window-mullion stripes
  // crisp (a large PCF radius dithers the penumbra).
  const extent = overhead ? 1.2 : side ? 1.5 : 2.6;
  const target: Vec3Tuple = [0, 0.75, 0];
  if (theme === "light") {
    return {
      sun: sun({
        color: overhead ? 0xffe2bc : 0xffd6a8,
        intensity: overhead ? 8.6 : 6.6,
        dir: overhead ? KITCHEN_OVERHEAD_SUN : KEY_DIRS.kitchenLight,
        target,
        extent,
        radius: overhead ? 2.2 : 2,
        distance: 9,
        normalBias: side ? 0.025 : 0.01,
      }),
      // A cool sky fill: the sun stripes read warm against blue-grey shade.
      sky: overhead ? { color: 0xaec4e6, groundColor: 0x8a6a50, intensity: 0.46 } : { color: 0xc6d6ea, groundColor: 0x8a6a50, intensity: 0.42 },
      // Side: a soft warm bounce from the lens side (Maya's shoulder), low enough to keep the
      // window rim reading on both profiles.
      fill: side ? { color: 0xffe6cc, intensity: 0.85, position: [-1.0, 1.5, 3.4] } : { color: 0xfff0e0, intensity: 0.4, position: [1.5, 2.4, 3.5] },
      // Side: the window's warm light rakes in from behind-left and above: hair, shoulders, Maya's
      // nape and Dre's cheek (he faces the window).
      rim: { color: 0xffd2a0, intensity: side ? 17 : 0, position: [-1.45, 2.2, -1.2], target: [0, 1.15, 0], angle: 0.62, penumbra: 0.9, distance: 7 },
      practicals: [
        { color: 0xffc58a, intensity: 0, position: KITCHEN_PENDANTS[0], distance: 4, decay: 2 },
        { color: 0xffc58a, intensity: 0, position: KITCHEN_PENDANTS[1], distance: 4, decay: 2 },
      ],
      environmentIntensity: overhead ? 0.5 : 0.52,
      exposure: 0.95,
      fog: { color: 0xe8dccb, density: 0.0 },
    };
  }
  // Night: the two pendants (right above the bowls) are the light. Overhead, they pool warm light
  // on each place setting and the table falls off into the dark; the key only grounds shadows.
  // Side: a softer, less saturated tungsten on the faces and a cool window kick on the far edges,
  // so skin keeps its own colour against the warm wall.
  const pendant = overhead ? 0xffc283 : 0xffcba4;
  return {
    sun: sun({ color: 0xffc896, intensity: overhead ? 0.32 : side ? 1.0 : 4.2, dir: KEY_DIRS.kitchenDark, target, extent, radius: overhead ? 2.4 : 2, distance: 6, normalBias: side ? 0.03 : 0.01 }),
    sky: { color: 0x40506e, groundColor: 0x3a2a1e, intensity: overhead ? 0.07 : 0.14 },
    fill: { color: side ? 0xd8c4b4 : 0xffb98a, intensity: overhead ? 0.06 : side ? 0.3 : 0.25, position: side ? [-1.0, 1.5, 3.4] : [1.5, 2.4, 3.5] },
    rim: { color: 0x9db8ff, intensity: side ? 22 : 0, position: [-1.6, 2.0, -1.1], target: [0, 1.15, 0], angle: 0.6, penumbra: 0.9, distance: 7 },
    practicals: [
      { color: pendant, intensity: overhead ? 5.5 : side ? 9 : 2.2, position: overhead ? KITCHEN_POOLS[0] : KITCHEN_PENDANTS[0], distance: overhead ? 1.08 : 4.5, decay: 2 },
      { color: pendant, intensity: overhead ? 5.5 : side ? 9 : 2.2, position: overhead ? KITCHEN_POOLS[1] : KITCHEN_PENDANTS[1], distance: overhead ? 1.08 : 4.5, decay: 2 },
    ],
    environmentIntensity: overhead ? 0.16 : 0.3,
    exposure: 1.05,
    fog: { color: 0x1a1612, density: 0.0 },
  };
}

// ---------------------------------------------------------------- studio

export const STUDIO_VARIANTS = ["base", "walk", "rise", "wide"] as const;

/**
 * The light hall: the back wall's room-side face sits at `wallZ` (`depth` thick) and opens on one
 * tall doorway of light centred on the walk path (x = 0, from the floor up). The squad walks out
 * of it towards +Z, the lens.
 */
export const STUDIO_DOOR = { wallZ: -11, depth: 0.45, width: 3.1, height: 4.7 } as const;

/**
 * Unit vector towards the studio key (both themes, so the doorway's beam volume fits either): a
 * sun low behind the doorway and a few degrees to its left, so it rims the squad, lays their
 * shadows down the floor at the lens and catches one jamb of the doorway.
 */
export const STUDIO_SUN: Vec3Tuple = dir(183.5, 17);

/** The doorway's light (centre, width): what the 5b push flies into. Named for the light bar it replaced. */
export const STUDIO_BAR = { center: [0, STUDIO_DOOR.height * 0.5, STUDIO_DOOR.wallZ] as Vec3Tuple, length: STUDIO_DOOR.width, radius: 0.035 };

/**
 * Hero-walk light. The sun (the only shadow caster) is the doorway's light: the wall gates it into
 * a carpet down the floor, it rims hair, shoulders and arms from behind and draws the long leg
 * shadows (and, through the floor shader, the legs' dark reflections). The rig's spot is the face
 * key: a big soft source right of the lens, ~45° off the walk axis and above the eyes; the fill is
 * its weak opposite (key:fill ≈ 3:1 on the faces). `rise` (5b): the room light falls away and the
 * doorway takes over.
 */
export function studioPreset(theme: Theme, variant: string): LightingPreset {
  const v = (STUDIO_VARIANTS as readonly string[]).includes(variant) ? variant : "walk";
  const rise = v === "rise";
  const light = theme === "light";
  return {
    sun: sun({
      color: light ? 0xffcf98 : 0xff7b54,
      intensity: light ? 5.6 : 7.5,
      dir: STUDIO_SUN,
      target: [0, 0.9, -5.4],
      extent: 6.4,
      radius: 2.2,
      distance: 22,
      bias: -0.0003,
      normalBias: 0.025,
    }),
    sky: light ? { color: 0xeef1f5, groundColor: 0xc9b9a6, intensity: rise ? 0.4 : 0.5 } : { color: 0x2c3240, groundColor: 0x1a100c, intensity: rise ? 0.06 : 0.14 },
    fill: { color: light ? 0xdfe7f2 : 0xb8c4dc, intensity: rise ? 0 : light ? 0.3 : 0.11, position: [-6, 2.5, 5] },
    rim: {
      color: light ? 0xf4f4f2 : 0xe6ebf4,
      intensity: rise ? 0 : light ? 66 : 46,
      position: [3.8, 3.3, 0.9],
      target: [0, 1.35, -2.3],
      angle: 0.52,
      penumbra: 1,
      distance: 18,
    },
    practicals: [OFF, OFF],
    environmentIntensity: light ? (rise ? 0.36 : 0.42) : rise ? 0.22 : 0.3,
    exposure: 1.0,
    fog: light ? { color: 0xf2e8dc, density: 0.008 } : { color: 0x1e1210, density: 0.022 },
  };
}

/**
 * Translates the sun (position + target) and the rim spot of a preset by `offset`, e.g. to keep the
 * shadow frustum on a runner or rider moving down the track. Practicals are fixtures and stay put
 * unless `includePracticals` is set; the fill is directional and is never moved.
 */
export function shiftPreset(preset: LightingPreset, offset: THREE.Vector3Like, includePracticals = false): LightingPreset {
  const o: Vec3Tuple = [offset.x, offset.y, offset.z];
  return {
    ...preset,
    sun: { ...preset.sun, position: add(preset.sun.position, o), target: add(preset.sun.target, o) },
    rim: { ...preset.rim, position: add(preset.rim.position, o), target: add(preset.rim.target, o) },
    practicals: includePracticals
      ? [
          { ...preset.practicals[0], position: add(preset.practicals[0].position, o) },
          { ...preset.practicals[1], position: add(preset.practicals[1].position, o) },
        ]
      : [{ ...preset.practicals[0] }, { ...preset.practicals[1] }],
  };
}
