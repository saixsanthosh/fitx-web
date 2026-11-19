/** The travel in px either side of rest for a parallax speed: `speed × 100` px in all. */
export function parallaxRange(speed: number): [number, number] {
  const half = Math.round(Math.max(0, speed) * 50);
  return [half, -half];
}
