import { useId, type CSSProperties } from "react";
import { FITX_MARK_ENTRY, FITX_MARK_PATHS, FITX_MARK_VIEWBOX } from "@/components/brand/logo/geometry";
import { cn } from "@/lib/utils";

type FitxMarkProps = {
  size?: number;
  className?: string;
  animate?: boolean;
};

/**
 * FITX's mark: the F with the barbell, crossed by the X (exact geometry in brand/logo/geometry.ts), filled with
 * `currentColor`. With `animate` it forms in about 1.4 s: each stroke grows out of its own shape in the order the
 * mark is written (bar, stem, arm, the X's long stroke, its other diagonal), then the plates slide onto the bar.
 * Transform and opacity only; static with reduced motion (globals.css). `--fitx-mark-tempo` scales the timing.
 */
export function FitxMark({ size = 36, className, animate = false }: FitxMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      aria-hidden="true"
      className={cn("fitx-mark", animate && "fitx-mark--formation", className)}
      width={size}
      height={size}
      viewBox={FITX_MARK_VIEWBOX}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
    >
      {animate ? (
        <>
          <defs>
            {FITX_MARK_PATHS.filter(({ id }) => !id.startsWith("plate")).map(({ id, d }) => (
              <clipPath key={id} id={`fm${uid}-${id}`} clipPathUnits="userSpaceOnUse"><path d={d} /></clipPath>
            ))}
          </defs>
          {FITX_MARK_PATHS.map(({ id, d }) => {
            const entry = FITX_MARK_ENTRY[id];
            const style = { "--fx": `${entry.x}px`, "--fy": `${entry.y}px` } as CSSProperties;
            const piece = <path className={`fitx-mark__piece fitx-mark__piece--${id}`} d={d} style={style} />;
            return id.startsWith("plate")
              ? <g key={id}>{piece}</g>
              : <g key={id} clipPath={`url(#fm${uid}-${id})`}>{piece}</g>;
          })}
        </>
      ) : (
        FITX_MARK_PATHS.map(({ id, d }) => <path key={id} className={`fitx-mark__piece fitx-mark__piece--${id}`} d={d} />)
      )}
    </svg>
  );
}
