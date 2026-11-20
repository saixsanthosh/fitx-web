"use client";

import type { Ref } from "react";
import { useImperativeHandle, useRef } from "react";
import type { PosePoint, Side } from "@/lib/pose/landmarks";
import type { Box } from "@/lib/home-workout/figure";
import { applyTransform, fitTransform, liveFrame } from "@/lib/home-workout/live-figure";
import type { FigureHandle } from "./FigureSvg";
import { FigureSvg } from "./FigureSvg";

export interface LiveFigureHandle {
  /** One analysed camera frame; null clears the figure (nobody in view). */
  update(points: readonly PosePoint[] | null, aspect: number, mirrored: boolean, side: Side | null): void;
}

const STAGE: Box = { x: 0, y: 0, width: 400, height: 300 };

/**
 * The member's own pose, redrawn as the FITX figure from the camera landmarks. The framing follows
 * the body smoothly, so stepping closer or further does not make the figure jump.
 */
export function LiveFigure({ ref, className }: { ref?: Ref<LiveFigureHandle>; className?: string }) {
  const figure = useRef<FigureHandle>(null);
  const framing = useRef<{ scale: number; dx: number; dy: number } | null>(null);

  useImperativeHandle(ref, () => ({
    update(points, aspect, mirrored, side) {
      const frame = liveFrame(points, aspect, mirrored, side);
      if (!frame) {
        figure.current?.draw(null);
        return;
      }
      const target = fitTransform(frame.bounds, STAGE);
      const current = framing.current;
      // Ease the framing (not the pose), so the figure moves exactly as the member does.
      framing.current = current
        ? { scale: current.scale + (target.scale - current.scale) * 0.15, dx: current.dx + (target.dx - current.dx) * 0.15, dy: current.dy + (target.dy - current.dy) * 0.15 }
        : target;
      figure.current?.draw(applyTransform(frame.points, framing.current), frame.hidden);
    },
  }), []);

  return <FigureSvg ref={figure} box={STAGE} floor={false} className={className} />;
}
