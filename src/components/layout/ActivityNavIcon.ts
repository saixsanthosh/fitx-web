"use client";

// Written with createElement (no JSX) so the navigation config, which imports it, stays loadable by the
// node:test unit tests.
import { createElement, useEffect, useState } from "react";
import { m } from "framer-motion";
import { EASE } from "@/components/motion/tokens";
import { usePageVisible, useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

type Point = readonly [number, number];
type Pose = {
  name: "walk" | "run" | "ride";
  head: Point;
  shoulder: Point;
  hip: Point;
  arms: readonly [Point, Point, Point, Point];
  legs: readonly [Point, Point, Point, Point];
};

const at = ([x, y]: Point) => `${x} ${y}`;

/** One path with the same commands in every pose, so it morphs smoothly from one to the next. */
export function bodyPath({ shoulder, hip, arms, legs }: Pose): string {
  const [elbowA, handA, elbowB, handB] = arms;
  const [kneeA, footA, kneeB, footB] = legs;
  return [
    `M${at(shoulder)} L${at(hip)}`,
    `M${at(shoulder)} L${at(elbowA)} L${at(handA)}`,
    `M${at(shoulder)} L${at(elbowB)} L${at(handB)}`,
    `M${at(hip)} L${at(kneeA)} L${at(footA)}`,
    `M${at(hip)} L${at(kneeB)} L${at(footB)}`,
  ].join(" ");
}

/** Walking, running and cycling figures on a 24 px grid, facing right. */
export const ACTIVITY_POSES: readonly Pose[] = [
  { name: "walk", head: [13, 4.2], shoulder: [12.6, 7.6], hip: [11.6, 13.4], arms: [[14, 10.4], [15.4, 12.8], [11.2, 10.6], [9.8, 12.8]], legs: [[13.2, 17], [14.6, 20.8], [10.6, 17.2], [9, 20.8]] },
  { name: "run", head: [14.6, 4.4], shoulder: [13.8, 7.8], hip: [11.4, 13], arms: [[16.2, 9.6], [17.6, 7.6], [11.6, 10.6], [9.6, 9.4]], legs: [[15.2, 14.8], [14.4, 18.6], [9.8, 16.6], [6.4, 17.8]] },
  { name: "ride", head: [15.2, 5.2], shoulder: [13.8, 8.2], hip: [9.8, 11.4], arms: [[15.4, 9.4], [16.6, 10.4], [15, 9.8], [16.2, 10.8]], legs: [[13.2, 13.4], [11.8, 17.2], [12, 14.6], [10.2, 18.4]] },
];

const BIKE_FRAME = "M6.2 17.6 L11 17.6 L9.4 11.8 M11 17.6 L15.6 11.4 L17.8 17.6 M15.6 11.4 L16.6 10.2 M8.4 11.8 L10.6 11.8";
/** How long each pose shows, crossfade included (ms). */
export const POSE_MS = 1200;
const MORPH = { duration: 0.45, ease: EASE.inOut };

/** The pose for a moment in time: every icon on the page shows the same one. */
export function poseIndexAt(time: number): number {
  return Math.floor(time / POSE_MS) % ACTIVITY_POSES.length;
}

export type ActivityNavIconProps = { size?: number; className?: string; active?: boolean; strokeWidth?: number };

/**
 * The Activity menu icon: a stroke figure that walks, runs and rides in a loop (about 1.2 s a pose,
 * morphing between them). It holds the walking pose with reduced motion, while the tab is hidden, and on
 * the server. Decorative (aria-hidden): the link's text names it.
 */
export function ActivityNavIcon({ size = 24, className, active = false, strokeWidth }: ActivityNavIconProps) {
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const [tick, setTick] = useState(0);
  const running = !reduced && visible;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick(poseIndexAt(Date.now())), POSE_MS / 4);
    return () => window.clearInterval(id);
  }, [running]);

  const pose = ACTIVITY_POSES[running ? tick : 0];
  const riding = pose.name === "ride";
  const stroke = strokeWidth ?? (active ? 2.2 : 1.8);
  return createElement(
    "svg",
    {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke,
      strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false", className,
      "data-pose": pose.name,
    },
    createElement(m.g, { initial: false, animate: { opacity: riding ? 1 : 0 }, transition: MORPH, strokeWidth: stroke * 0.85 },
      createElement("circle", { cx: 6.2, cy: 17.6, r: 3.4 }),
      createElement("circle", { cx: 17.8, cy: 17.6, r: 3.4 }),
      createElement("path", { d: BIKE_FRAME }),
    ),
    createElement(m.path, { initial: false, animate: { d: bodyPath(pose) }, transition: MORPH }),
    createElement(m.circle, { initial: false, animate: { cx: pose.head[0], cy: pose.head[1] }, transition: MORPH, r: 2, fill: "currentColor", stroke: "none" }),
  );
}

/** Marks a nav icon that takes `active` itself (lucide icons take strokeWidth instead). */
ActivityNavIcon.fitxNavIcon = true as const;
