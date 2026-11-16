/**
 * Eye aperture geometry shared by the head sculpt (worker: the socket opening) and the face rig
 * (main thread: lid shells, lash lines), so the two always agree. Worker-safe, no `three`.
 * OWNER: character-details agent.
 *
 * Eye frame: origin at the eyeball centre, +Z forward (gaze rest), +Y up, +X LATERAL (towards
 * the ear; for the character's right eye that is world −X). A direction is described by its
 * azimuth θ (from +Z towards lateral +X) and elevation φ (above the XZ plane).
 *
 * The visible opening is an almond bounded by an upper and a lower margin curve φ(θ) that meet at
 * the medial and lateral corners. The upper margin peaks a little medially, the lower dips a
 * little laterally, and the lateral corner sits higher than the medial one (canthal tilt).
 */

export interface EyeAperture {
  /** Medial (nose-side) corner azimuth, radians (negative). */
  medial: number;
  /** Lateral corner azimuth, radians (positive). */
  lateral: number;
  /** Peak elevation of the upper margin when open, radians. */
  upper: number;
  /** Lowest elevation of the lower margin, radians (negative). */
  lower: number;
  /** Corner elevation at the medial / lateral corner, radians (lateral − medial = canthal tilt). */
  cornerMedial: number;
  cornerLateral: number;
}

const DEG = Math.PI / 180;

/** Default almond for a calm, slightly hooded adult eye (per-character values tweak it). */
export function defaultAperture(openAngle: number, tilt: number): EyeAperture {
  return {
    medial: -64 * DEG,
    lateral: 76 * DEG,
    upper: openAngle,
    lower: -27 * DEG,
    cornerMedial: -3.5 * DEG - tilt * 0.5,
    cornerLateral: -3.5 * DEG + tilt * 0.5,
  };
}

/** Normalised position across the opening, 0 at the medial corner and 1 at the lateral corner. */
export const apertureU = (a: EyeAperture, theta: number) => (theta - a.medial) / (a.lateral - a.medial);

const cornerAt = (a: EyeAperture, u: number) => a.cornerMedial + (a.cornerLateral - a.cornerMedial) * Math.min(1, Math.max(0, u));

/** Bump 0 at the corners, 1 at its peak u = `peak`; flattened so the lids stay open across the iris. */
function bump(u: number, peak: number, power: number) {
  if (u <= 0 || u >= 1) return 0;
  const gamma = Math.log(0.5) / Math.log(peak);
  return Math.pow(Math.sin(Math.PI * Math.pow(u, gamma)), power);
}

/** Upper margin elevation at azimuth θ (beyond the corners it stays at the corner elevation). */
export function upperMargin(a: EyeAperture, theta: number) {
  const u = apertureU(a, theta);
  const c = cornerAt(a, u);
  return c + (a.upper - c) * bump(u, 0.44, 0.62);
}

/** Lower margin elevation at azimuth θ. */
export function lowerMargin(a: EyeAperture, theta: number) {
  const u = apertureU(a, theta);
  const c = cornerAt(a, u);
  return c + (a.lower - c) * bump(u, 0.56, 0.8);
}

/**
 * Signed angular distance (radians, negative inside) of direction (θ, φ) from the almond
 * grown by `grow` = {up, down, side} radians. Used for the socket cut and for paint masks.
 */
export function apertureAngularDistance(a: EyeAperture, theta: number, phi: number, grow = { up: 0, down: 0, side: 0 }) {
  const t = Math.min(a.lateral + grow.side, Math.max(a.medial - grow.side, theta));
  const tc = Math.min(a.lateral, Math.max(a.medial, t));
  const up = upperMargin(a, tc) + grow.up;
  const lo = lowerMargin(a, tc) - grow.down;
  const side = Math.max(a.medial - grow.side - theta, theta - a.lateral - grow.side);
  // At the corners the margins meet; growing them apart keeps a rounded tip.
  return Math.max(phi - up, lo - phi, side);
}

/** Eye-frame → (θ, φ) for a local point (x lateral, y up, z forward). */
export function eyeAngles(x: number, y: number, z: number): [number, number] {
  return [Math.atan2(x, z), Math.atan2(y, Math.hypot(x, z))];
}

/** Unit direction for azimuth θ, elevation φ in the eye frame. */
export function eyeDir(theta: number, phi: number): [number, number, number] {
  const c = Math.cos(phi);
  return [Math.sin(theta) * c, Math.sin(phi), Math.cos(theta) * c];
}
