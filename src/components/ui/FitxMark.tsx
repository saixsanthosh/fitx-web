import { cn } from "@/lib/utils";

type FitxMarkProps = {
  size?: number;
  className?: string;
  animate?: boolean;
};

/** FITX's standalone mark: a shared spine, open F/T bars, and a directional X. */
export function FitxMark({ size = 36, className, animate = false }: FitxMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn("fitx-mark", animate && "fitx-mark--formation", className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      focusable="false"
    >
      <path className="fitx-mark__path fitx-mark__path--cap" d="M10 13H54" />
      <path className="fitx-mark__path fitx-mark__path--spine" d="M32 13V54" />
      <path className="fitx-mark__path fitx-mark__path--crossbar" d="M10 29H32" />
      <path className="fitx-mark__path fitx-mark__path--x" d="M32 31L53 52M32 52L53 31" />
    </svg>
  );
}
