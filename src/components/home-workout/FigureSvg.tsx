"use client";

import type { Ref } from "react";
import { useImperativeHandle, useRef } from "react";
import type { Box, FigurePoints, Part, SideKey, Vec } from "@/lib/home-workout/figure";
import { angleAt, BONES, FLOOR_Y } from "@/lib/home-workout/figure";
import { cn } from "@/lib/utils";
import styles from "./figure.module.css";

/** Draws a frame without React rendering it: the loops call this up to 60 times a second. */
export interface FigureHandle {
  draw(points: FigurePoints | null, hidden?: ReadonlySet<string>): void;
}

const SEGMENTS: ReadonlyArray<readonly [string, Part, Part]> = [
  ["upperArm", "shoulder", "elbow"],
  ["forearm", "elbow", "wrist"],
  ["thigh", "hip", "knee"],
  ["shin", "knee", "ankle"],
  ["foot", "ankle", "toe"],
];
const JOINTS: readonly Part[] = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"];

interface FigureSvgProps {
  ref?: Ref<FigureHandle>;
  /** The drawing's frame, in figure units. */
  box: Box;
  /** The joint angle to draw and label (demonstrations). */
  angle?: { side: SideKey; joints: readonly [Part, Part, Part] } | null;
  /** A faint dotted outline of the turnaround pose (demonstrations). */
  ghost?: FigurePoints | null;
  /** Light dumbbells in the hands. */
  weights?: boolean;
  /** A wall behind the figure, at this x. */
  wallX?: number | null;
  floor?: boolean;
  /** The accessible name; without it the drawing is decorative. */
  label?: string;
  className?: string;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function ghostPath(points: FigurePoints): string {
  const line = (a: Vec, b: Vec) => `M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`;
  const side = points.near;
  return [line(side.shoulder, side.elbow), line(side.elbow, side.wrist), line(side.shoulder, side.hip), line(side.hip, side.knee), line(side.knee, side.ankle)].join("");
}

/** The FITX figure: thick rounded limbs, the far side dimmed, tracking points on the near joints. */
export function FigureSvg({ ref, box, angle, ghost, weights, wallX, floor = true, label, className }: FigureSvgProps) {
  const svg = useRef<SVGSVGElement>(null);
  const found = useRef<{ root: SVGSVGElement; map: Map<string, SVGElement> } | null>(null);

  useImperativeHandle(ref, () => ({
    draw(points, hidden) {
      const current = svg.current;
      if (!current) return;
      // The drawing's parts, found once by their data-k names (and again if the SVG is replaced).
      if (found.current?.root !== current) {
        found.current = { root: current, map: new Map([...current.querySelectorAll<SVGElement>("[data-k]")].map((element) => [element.dataset.k ?? "", element])) };
      }
      const map = found.current.map;
      const root = map.get("root");
      if (!points) {
        root?.setAttribute("class", styles.dim);
        return;
      }
      root?.setAttribute("class", styles.live);
      const attr = (key: string, values: Record<string, number | string>) => {
        const element = map.get(key);
        if (!element) return;
        for (const [name, value] of Object.entries(values)) element.setAttribute(name, typeof value === "number" ? fmt(value) : value);
      };
      const show = (key: string, on: boolean) => map.get(key)?.classList.toggle(styles.hidden, !on);
      for (const sideKey of ["near", "far"] as const) {
        const side = points[sideKey];
        for (const [segment, from, to] of SEGMENTS) {
          const key = `${sideKey}-${segment}`;
          attr(key, { x1: side[from].x, y1: side[from].y, x2: side[to].x, y2: side[to].y });
          show(key, !hidden?.has(key));
        }
      }
      const { near, far } = points;
      const shoulderMid = { x: (near.shoulder.x + far.shoulder.x) / 2, y: (near.shoulder.y + far.shoulder.y) / 2 };
      attr("torso", { d: `M${fmt(near.shoulder.x)} ${fmt(near.shoulder.y)}L${fmt(far.shoulder.x)} ${fmt(far.shoulder.y)}L${fmt(far.hip.x)} ${fmt(far.hip.y)}L${fmt(near.hip.x)} ${fmt(near.hip.y)}Z` });
      show("torso", !hidden?.has("torso"));
      attr("neck", { x1: shoulderMid.x, y1: shoulderMid.y, x2: points.head.x, y2: points.head.y });
      attr("head", { cx: points.head.x, cy: points.head.y });
      show("head", !hidden?.has("head"));
      show("neck", !hidden?.has("head"));
      for (const joint of JOINTS) {
        attr(`joint-${joint}`, { cx: near[joint].x, cy: near[joint].y });
        show(`joint-${joint}`, !hidden?.has(`joint-${joint}`));
      }
      const hipX = (near.hip.x + far.hip.x) / 2;
      const lowest = Math.max(near.ankle.y, far.ankle.y, near.toe.y, far.toe.y);
      attr("shadow", { cx: hipX, cy: Math.max(FLOOR_Y, lowest) + 2, rx: 46 + Math.abs(near.ankle.x - far.ankle.x) / 2 });
      if (weights) {
        for (const sideKey of ["near", "far"] as const) {
          const side = points[sideKey];
          const dx = side.wrist.x - side.elbow.x;
          const dy = side.wrist.y - side.elbow.y;
          const length = Math.hypot(dx, dy) || 1;
          const half = 9;
          const centre = { x: side.wrist.x + (dx / length) * 4, y: side.wrist.y + (dy / length) * 4 };
          attr(`weight-${sideKey}`, { x1: centre.x - (dy / length) * half, y1: centre.y + (dx / length) * half, x2: centre.x + (dy / length) * half, y2: centre.y - (dx / length) * half });
        }
      }
      if (angle) {
        const side = points[angle.side];
        const [a, b, c] = angle.joints.map((part) => side[part]);
        const degrees = angleAt(a, b, c);
        const r = 26;
        const start = Math.atan2(a.y - b.y, a.x - b.x);
        let end = Math.atan2(c.y - b.y, c.x - b.x);
        let delta = end - start;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        end = start + delta;
        const p1 = { x: b.x + r * Math.cos(start), y: b.y + r * Math.sin(start) };
        const p2 = { x: b.x + r * Math.cos(end), y: b.y + r * Math.sin(end) };
        attr("arc", { d: `M${fmt(b.x)} ${fmt(b.y)}L${fmt(p1.x)} ${fmt(p1.y)}A${r} ${r} 0 0 ${delta > 0 ? 1 : 0} ${fmt(p2.x)} ${fmt(p2.y)}Z` });
        // The label sits outside the angle, opposite its opening.
        const mid = start + delta / 2;
        const out = { x: b.x - Math.cos(mid) * 34, y: b.y - Math.sin(mid) * 34 };
        attr("angle", { x: out.x, y: out.y + 6 });
        const text = map.get("angle");
        if (text) text.textContent = `${Math.round(degrees)}°`;
      }
    },
  }), [angle, weights]);

  return (
    <svg
      ref={svg}
      viewBox={`${fmt(box.x)} ${fmt(box.y)} ${fmt(box.width)} ${fmt(box.height)}`}
      className={cn(styles.svg, className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g data-k={"root"} className={styles.dim}>
        {floor && <line className={styles.floor} x1={box.x} x2={box.x + box.width} y1={FLOOR_Y + 8} y2={FLOOR_Y + 8} />}
        {wallX != null && <line className={styles.wall} x1={wallX} x2={wallX} y1={FLOOR_Y + 8} y2={FLOOR_Y - 236} />}
        {floor && <ellipse data-k={"shadow"} className={styles.shadow} cx={200} cy={FLOOR_Y + 2} rx={50} ry={6} />}
        {ghost && <path className={styles.ghost} d={ghostPath(ghost)} />}
        <g className={styles.far}>
          {SEGMENTS.map(([segment]) => <line key={segment} data-k={`far-${segment}`} className={styles.limb} />)}
        </g>
        {weights && <line data-k={"weight-far"} className={styles.weight} />}
        <path data-k={"torso"} className={styles.torso} />
        <line data-k={"neck"} className={styles.neck} />
        <circle data-k={"head"} className={styles.head} r={BONES.headRadius} />
        <g>
          {SEGMENTS.map(([segment]) => <line key={segment} data-k={`near-${segment}`} className={styles.limb} />)}
        </g>
        {weights && <line data-k={"weight-near"} className={styles.weight} />}
        {angle && <path data-k={"arc"} className={styles.arc} />}
        {JOINTS.map((joint) => <circle key={joint} data-k={`joint-${joint}`} className={styles.joint} r={3.6} />)}
        {angle && <text data-k={"angle"} className={styles.angle} textAnchor="middle" />}
      </g>
    </svg>
  );
}
