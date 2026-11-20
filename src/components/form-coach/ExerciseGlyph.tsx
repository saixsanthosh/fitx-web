import type { ExerciseId } from "@/lib/form-rules/types";
import { DEMONSTRATIONS } from "@/lib/home-workout/demos";
import type { FigurePoints, Vec } from "@/lib/home-workout/figure";
import { demoBounds, place } from "@/lib/home-workout/figure";

const cache = new Map<ExerciseId, { points: FigurePoints; box: ReturnType<typeof demoBounds> }>();

/** The exercise's turnaround pose from its demonstration, drawn small. */
function glyphOf(id: ExerciseId) {
  let entry = cache.get(id);
  if (!entry) {
    const demo = DEMONSTRATIONS[id];
    const frame = demo.keyframes[Math.min(1, demo.keyframes.length - 1)];
    entry = { points: place(demo, frame.pose, frame.at ?? demo.at), box: demoBounds(demo, 1, 10) };
    cache.set(id, entry);
  }
  return entry;
}

const r = (n: number) => Math.round(n * 10) / 10;
const seg = (a: Vec, b: Vec) => `M${r(a.x)} ${r(a.y)}L${r(b.x)} ${r(b.y)}`;

/** A small pictogram of each camera exercise, drawn from the same figure as its demonstration. */
export function ExerciseGlyph({ id, className }: { id: ExerciseId; className?: string }) {
  const { points, box } = glyphOf(id);
  const limbs = (side: FigurePoints["near"]) =>
    [seg(side.shoulder, side.elbow), seg(side.elbow, side.wrist), seg(side.hip, side.knee), seg(side.knee, side.ankle)].join("");
  const { near, far } = points;
  const shoulder = { x: (near.shoulder.x + far.shoulder.x) / 2, y: (near.shoulder.y + far.shoulder.y) / 2 };
  const hip = { x: (near.hip.x + far.hip.x) / 2, y: (near.hip.y + far.hip.y) / 2 };
  return (
    <svg viewBox={`${r(box.x)} ${r(box.y)} ${r(box.width)} ${r(box.height)}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d={limbs(far)} strokeWidth={14} opacity={0.4} />
      <path d={`${seg(shoulder, hip)}${seg(near.shoulder, far.shoulder)}${seg(near.hip, far.hip)}`} strokeWidth={18} />
      <path d={limbs(near)} strokeWidth={14} />
      <circle cx={r(points.head.x)} cy={r(points.head.y)} r={15} fill="currentColor" stroke="none" />
    </svg>
  );
}
