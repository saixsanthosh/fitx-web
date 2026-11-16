/**
 * Colour grades ("looks") for the intro film. Pure data, no three.js.
 *
 * `exposure` and the bloom settings act on the scene-linear HDR image; everything else is
 * applied by the film pass in display space after tone mapping, the way a colourist grades
 * a log/film scan: lift/gamma/gain → S-curve contrast → saturation → split tone → vignette →
 * grain. Day looks: warm highlights over soft teal shadows. Night looks: deeper teal-orange.
 */

/** Display-space RGB triplet. */
export type GradeRGB = [number, number, number];

export interface GradeParams {
  /** Exposure offset in stops (EV) before tone mapping, on top of the lighting preset's exposure. 0 = neutral. */
  exposure: number;
  /** S-curve contrast around mid-grey in display space (never clips). 1 = neutral. */
  contrast: number;
  /** 1 = neutral, 0 = monochrome. */
  saturation: number;
  /** Shadow offset per channel (display space, fades to 0 at white). 0 = neutral. */
  lift: GradeRGB;
  /** Midtone power per channel; > 1 brightens. 1 = neutral. */
  gamma: GradeRGB;
  /** White-point multiplier per channel. 1 = neutral. */
  gain: GradeRGB;
  /** Luma-neutral chroma offset pushed into the shadows ([0,0,0] = none; e.g. [-0.02, 0.004, 0.022] = teal). */
  shadowTint: GradeRGB;
  /** Luma-neutral chroma offset pushed into the highlights (e.g. [0.025, 0.008, -0.03] = warm). */
  highlightTint: GradeRGB;
  /** Optical vignette strength 0..1 (0.25 ≈ a fast prime wide open). */
  vignette: number;
  /** Film-grain amplitude 0..1 (0.3 ≈ fine 35 mm stock; keep < 0.6). */
  grain: number;
  /** Lateral chromatic aberration toward the edges 0..1 (1 ≈ 0.25 % of frame height at the corners). */
  aberration: number;
  /** UnrealBloom strength (scene-linear additive; the five mips add up to ~3x this, so 0.15–0.3 is filmic). */
  bloomStrength: number;
  /** UnrealBloom radius 0..1 (mixes toward the wider mips). */
  bloomRadius: number;
  /** Scene-linear brightness where bloom is at full strength; it fades in from half this value (soft knee). Diffuse white ≈ 1, so day looks sit near 2.5 and night looks near 1.5. */
  bloomThreshold: number;
}

const grade = (params: GradeParams) => params;

export const NEUTRAL_GRADE: GradeParams = grade({
  exposure: 0,
  contrast: 1,
  saturation: 1,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  shadowTint: [0, 0, 0],
  highlightTint: [0, 0, 0],
  vignette: 0,
  grain: 0,
  aberration: 0,
  bloomStrength: 0,
  bloomRadius: 0.5,
  bloomThreshold: 2.5,
});

/**
 * The film's looks, keyed `<set><TimeOfDay>`; light theme = sunrise/day/morning/light,
 * dark theme = night/evening/dark. Shots blend between them with `mixGrades`.
 */
export const GRADES = {
  /** Golden-hour track: amber sun, airy teal shade, gentle sheen on the tartan. Saturation held
   *  back and the shade pulled teal so backlit brown skin stays brown, not brick. */
  trackSunrise: grade({
    exposure: 0.0,
    contrast: 1.3,
    saturation: 1.1,
    lift: [0.008, 0.011, 0.018],
    gamma: [1.0, 1.0, 0.99],
    gain: [1.03, 1.0, 0.95],
    shadowTint: [-0.022, 0.005, 0.022],
    highlightTint: [0.026, 0.01, -0.03],
    vignette: 0.26,
    grain: 0.3,
    aberration: 0.35,
    bloomStrength: 0.16,
    bloomRadius: 0.42,
    bloomThreshold: 2.6,
  }),
  /** Floodlit stadium under a deep blue sky: cold shadows, warm skin and lamps, the edges falling into the dark. */
  trackNight: grade({
    exposure: 0.0,
    contrast: 1.42,
    saturation: 1.1,
    lift: [0.0, 0.008, 0.018],
    gamma: [0.96, 0.98, 1.02],
    gain: [1.04, 0.99, 0.93],
    shadowTint: [-0.03, 0.006, 0.034],
    highlightTint: [0.032, 0.012, -0.034],
    vignette: 0.42,
    grain: 0.38,
    aberration: 0.4,
    bloomStrength: 0.22,
    bloomRadius: 0.48,
    bloomThreshold: 1.6,
  }),
  /** Same sunrise as the track, a touch hotter and more saturated for speed. */
  rideSunrise: grade({
    exposure: 0.05,
    contrast: 1.32,
    saturation: 1.2,
    lift: [0.008, 0.011, 0.018],
    gamma: [1.0, 1.0, 0.99],
    gain: [1.04, 1.0, 0.94],
    shadowTint: [-0.02, 0.005, 0.022],
    highlightTint: [0.03, 0.011, -0.032],
    vignette: 0.24,
    grain: 0.3,
    aberration: 0.4,
    bloomStrength: 0.17,
    bloomRadius: 0.44,
    bloomThreshold: 2.5,
  }),
  /** Night ride: cooler and contrastier than the track, the floodlights flare. */
  rideNight: grade({
    exposure: 0.0,
    contrast: 1.44,
    saturation: 1.12,
    lift: [0.0, 0.009, 0.02],
    gamma: [0.96, 0.98, 1.02],
    gain: [1.03, 0.99, 0.94],
    shadowTint: [-0.032, 0.006, 0.036],
    highlightTint: [0.03, 0.012, -0.03],
    vignette: 0.42,
    grain: 0.38,
    aberration: 0.42,
    bloomStrength: 0.24,
    bloomRadius: 0.5,
    bloomThreshold: 1.6,
  }),
  /**
   * Morning gym: warm window shafts, neutral-cool concrete, slightly gritty. Firm blacks under the haze.
   * Saturation and the warm highlight push stay modest: the sun already paints deep-brown skin warm.
   */
  gymDay: grade({
    exposure: 0.0,
    contrast: 1.38,
    saturation: 1.0,
    lift: [0.0, 0.003, 0.007],
    gamma: [1.0, 1.0, 0.99],
    gain: [1.02, 1.0, 0.96],
    shadowTint: [-0.024, 0.004, 0.026],
    highlightTint: [0.02, 0.01, -0.022],
    vignette: 0.3,
    grain: 0.34,
    aberration: 0.32,
    bloomStrength: 0.17,
    bloomRadius: 0.44,
    bloomThreshold: 2.3,
  }),
  /**
   * Night gym: tungsten practicals against cool moonlight shafts — teal-orange, inky blacks. Held under
   * 1.0 saturation: blue moonlight plus a warm key otherwise turns deep-brown skin maroon.
   */
  gymNight: grade({
    exposure: 0.0,
    contrast: 1.4,
    saturation: 0.94,
    lift: [0.0, 0.004, 0.011],
    gamma: [0.99, 1.0, 1.02],
    gain: [1.03, 0.99, 0.94],
    shadowTint: [-0.03, 0.006, 0.032],
    highlightTint: [0.036, 0.012, -0.036],
    vignette: 0.36,
    grain: 0.4,
    aberration: 0.38,
    bloomStrength: 0.24,
    bloomRadius: 0.48,
    bloomThreshold: 1.5,
  }),
  /** Breakfast in window light: airy, creamy whites, food stays appetising. */
  kitchenMorning: grade({
    exposure: 0.05,
    contrast: 1.22,
    saturation: 1.16,
    lift: [0.012, 0.012, 0.014],
    gamma: [1.01, 1.0, 0.99],
    gain: [1.02, 1.0, 0.96],
    shadowTint: [-0.01, 0.006, 0.01],
    highlightTint: [0.02, 0.01, -0.02],
    vignette: 0.22,
    grain: 0.26,
    aberration: 0.28,
    bloomStrength: 0.14,
    bloomRadius: 0.42,
    bloomThreshold: 2.6,
  }),
  /** Warm evening kitchen under tungsten pendants. */
  kitchenEvening: grade({
    exposure: 0.0,
    contrast: 1.26,
    // Night 4b: held under neutral so the tungsten stays warm without turning skin and wall into
    // one orange; cooler shadows separate the faces from the wall.
    saturation: 0.97,
    lift: [0.004, 0.005, 0.012],
    gamma: [1.0, 1.0, 1.01],
    gain: [1.02, 1.0, 0.96],
    shadowTint: [-0.024, 0.006, 0.03],
    highlightTint: [0.018, 0.008, -0.016],
    vignette: 0.3,
    grain: 0.34,
    aberration: 0.3,
    bloomStrength: 0.14,
    bloomRadius: 0.42,
    bloomThreshold: 2.2,
  }),
  /** Overhead flat-lay, morning: true-colour food on pale oak, cool shade in the window stripes. */
  kitchenOverheadMorning: grade({
    exposure: 0.0,
    contrast: 1.3,
    saturation: 1.1,
    lift: [0.006, 0.008, 0.012],
    gamma: [1.0, 1.0, 1.0],
    gain: [1.02, 1.0, 0.97],
    shadowTint: [-0.018, 0.004, 0.022],
    highlightTint: [0.016, 0.007, -0.014],
    vignette: 0.26,
    grain: 0.24,
    aberration: 0.22,
    bloomStrength: 0.12,
    bloomRadius: 0.4,
    bloomThreshold: 2.8,
  }),
  /** Overhead flat-lay, evening: two warm pendant pools, the table edges sink into the dark. */
  kitchenOverheadEvening: grade({
    exposure: 0.0,
    contrast: 1.28,
    saturation: 1.08,
    lift: [0.004, 0.004, 0.01],
    gamma: [1.0, 1.0, 1.01],
    gain: [1.04, 1.0, 0.94],
    shadowTint: [-0.02, 0.004, 0.024],
    highlightTint: [0.026, 0.01, -0.026],
    vignette: 0.42,
    grain: 0.32,
    aberration: 0.26,
    bloomStrength: 0.2,
    bloomRadius: 0.42,
    bloomThreshold: 1.7,
  }),
  /**
   * The light hall by morning: high key and airy, but with a firm S-curve so the charcoal kit, the
   * long shadows and the backlit edges hold their shape against the bright doorway (never milky).
   * Only the doorway and its mirror bloom.
   */
  studioLight: grade({
    exposure: 0.45,
    contrast: 1.36,
    saturation: 1.06,
    lift: [-0.004, -0.003, 0.0],
    gamma: [1.0, 1.0, 0.99],
    gain: [1.02, 1.0, 0.97],
    shadowTint: [-0.012, 0.002, 0.014],
    highlightTint: [0.014, 0.005, -0.012],
    vignette: 0.32,
    grain: 0.24,
    aberration: 0.25,
    bloomStrength: 0.1,
    bloomRadius: 0.3,
    bloomThreshold: 3.4,
  }),
  /** The hall by night: inky charcoal, coral light, teal-leaning shadows so skin and the coral separate. */
  studioDark: grade({
    exposure: 0.0,
    contrast: 1.32,
    saturation: 1.04,
    lift: [0.0, 0.002, 0.006],
    gamma: [1.0, 1.0, 1.01],
    gain: [1.03, 1.0, 0.97],
    shadowTint: [-0.02, 0.004, 0.022],
    highlightTint: [0.02, 0.006, -0.016],
    vignette: 0.42,
    grain: 0.32,
    aberration: 0.3,
    bloomStrength: 0.14,
    bloomRadius: 0.3,
    bloomThreshold: 3.0,
  }),
  /** 5b crane into the bar, light: the exposure opens and the bloom spreads into a warm white-out. */
  studioSwellLight: grade({
    // The swell is carried by the bar's level/spread and its bloom; exposure waits for the cut.
    exposure: 0.0,
    contrast: 1.24,
    saturation: 1.2,
    lift: [0.0, 0.0, 0.0],
    gamma: [1.0, 1.0, 0.99],
    gain: [1.02, 1.0, 0.97],
    shadowTint: [0, 0, 0],
    highlightTint: [0.012, 0.004, -0.01],
    vignette: 0.16,
    grain: 0.18,
    aberration: 0.22,
    bloomStrength: 0.5,
    bloomRadius: 0.8,
    bloomThreshold: 1.6,
  }),
  /** 5b crane into the bar, dark: the coral bloom swells to fill the frame. */
  studioSwellDark: grade({
    exposure: 0.0,
    contrast: 1.2,
    saturation: 1.1,
    lift: [0.0, 0.002, 0.004],
    gamma: [1.0, 1.0, 1.0],
    gain: [1.04, 1.0, 0.96],
    shadowTint: [0, 0, 0],
    highlightTint: [0.02, 0.006, -0.018],
    vignette: 0.2,
    grain: 0.2,
    aberration: 0.22,
    // A band of coral glow round the bar, not a full-frame veil.
    bloomStrength: 0.3,
    bloomRadius: 0.6,
    bloomThreshold: 1.5,
  }),
  /** Brand hold, light theme: neutral so the fade lands exactly on the page background. */
  brandLight: grade({
    exposure: 0.0,
    contrast: 1.0,
    saturation: 1.0,
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
    shadowTint: [0, 0, 0],
    highlightTint: [0, 0, 0],
    vignette: 0.08,
    grain: 0.12,
    aberration: 0.1,
    bloomStrength: 0.22,
    bloomRadius: 0.5,
    bloomThreshold: 1.8,
  }),
  /** Brand hold, dark theme. */
  brandDark: grade({
    exposure: 0.0,
    contrast: 1.0,
    saturation: 1.0,
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
    shadowTint: [0, 0, 0],
    highlightTint: [0, 0, 0],
    vignette: 0.12,
    grain: 0.14,
    aberration: 0.1,
    bloomStrength: 0.32,
    bloomRadius: 0.54,
    bloomThreshold: 1.2,
  }),
} satisfies Record<string, GradeParams>;

export type GradeName = keyof typeof GRADES;

const mixNumber = (a: number, b: number, t: number) => a + (b - a) * t;
const mixTriplet = (a: GradeRGB, b: GradeRGB, t: number): GradeRGB => [mixNumber(a[0], b[0], t), mixNumber(a[1], b[1], t), mixNumber(a[2], b[2], t)];

/** Linear blend of two grades (t = 0 → a, 1 → b). Exposure blends in stops. */
export function mixGrades(a: GradeParams, b: GradeParams, t: number, out?: GradeParams): GradeParams {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const result: GradeParams = out ?? { ...NEUTRAL_GRADE, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], shadowTint: [0, 0, 0], highlightTint: [0, 0, 0] };
  result.exposure = mixNumber(a.exposure, b.exposure, k);
  result.contrast = mixNumber(a.contrast, b.contrast, k);
  result.saturation = mixNumber(a.saturation, b.saturation, k);
  result.lift = mixTriplet(a.lift, b.lift, k);
  result.gamma = mixTriplet(a.gamma, b.gamma, k);
  result.gain = mixTriplet(a.gain, b.gain, k);
  result.shadowTint = mixTriplet(a.shadowTint, b.shadowTint, k);
  result.highlightTint = mixTriplet(a.highlightTint, b.highlightTint, k);
  result.vignette = mixNumber(a.vignette, b.vignette, k);
  result.grain = mixNumber(a.grain, b.grain, k);
  result.aberration = mixNumber(a.aberration, b.aberration, k);
  result.bloomStrength = mixNumber(a.bloomStrength, b.bloomStrength, k);
  result.bloomRadius = mixNumber(a.bloomRadius, b.bloomRadius, k);
  result.bloomThreshold = mixNumber(a.bloomThreshold, b.bloomThreshold, k);
  return result;
}
