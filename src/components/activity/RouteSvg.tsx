import { fitRoute } from "@/lib/activity/share-card";
import type { LatLng } from "@/lib/activity/types";

/**
 * A route drawn as a line without a map: list thumbnails, and the fallback when a device cannot
 * show the interactive map. Purely decorative (the surrounding text carries the information).
 */
export function RouteSvg({ segments, className, strokeWidth = 3 }: { segments: readonly (readonly LatLng[])[]; className?: string; strokeWidth?: number }) {
  const size = 100;
  const paths = fitRoute(segments, { x: 0, y: 0, width: size, height: size }, 8);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
      {paths.map((segment, i) => (
        <polyline
          key={i}
          points={segment.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
          fill="none"
          stroke="var(--fitx-primary)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
