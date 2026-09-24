export function ProgressRing({ value, target, label, color = "#79df83", size = 124 }: { value: number; target: number; label: string; color?: string; size?: number }) {
  const percent = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`${label}: ${Math.round(value)} of ${Math.round(target)}`}>
      <div className="h-full w-full rounded-full" style={{ background: `conic-gradient(${color} ${percent}%, rgba(255,255,255,.09) 0)` }} />
      <div className="absolute inset-[8px] flex flex-col items-center justify-center rounded-full bg-fitx-card">
        <span className="text-xl font-semibold tabular-nums text-fitx-text">{target > 0 ? `${Math.round(percent)}%` : "—"}</span>
        <span className="mt-0.5 text-[10px] text-fitx-text-secondary">{label}</span>
      </div>
    </div>
  );
}
