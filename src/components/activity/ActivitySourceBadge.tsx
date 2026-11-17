import { Smartphone, Watch } from "lucide-react";
import { sourceLabel, type SourceInfo } from "@/lib/activity/source";
import { cn } from "@/lib/utils";

/**
 * Where an activity came from, in an icon and words (never colour alone): "Recorded with FITX" or
 * "Imported · Garmin Forerunner 255 · FIT". `pill` for an activity page, `inline` for history rows.
 */
export function ActivitySourceBadge({ info, variant = "inline", className }: { info: SourceInfo; variant?: "inline" | "pill"; className?: string }) {
  const Icon = info.source === "file" ? Watch : Smartphone;
  const label = sourceLabel(info);
  if (variant === "pill") {
    return (
      <span className={cn("inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-fitx-border bg-fitx-surface px-2.5 text-xs font-medium text-fitx-text-secondary", className)}>
        <Icon size={13} aria-hidden="true" className="shrink-0 text-fitx-primary" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-[11px] text-fitx-text-secondary", className)}>
      <Icon size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
