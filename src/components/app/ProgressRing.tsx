/** A circular progress meter. The fill defaults to the brand colour and the track follows the theme. */
export function ProgressRing({ value, target, label, color = "var(--fitx-primary)", size = 124, description }: { value: number; target: number; label: string; color?: string; size?: number; description?: string }) {
  const percent = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;
  const summary = description ?? (target > 0 ? `${label}: ${Math.round(value)} of ${Math.round(target)}` : `${label}: ${Math.round(value)}`);
  return (
    <div role="img" aria-label={summary} className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="h-full w-full rounded-full" style={{ background: `conic-gradient(${color} ${percent}%, var(--fitx-track) 0)` }} />
      <div className="absolute inset-[8px] flex flex-col items-center justify-center rounded-full bg-fitx-card">
        <span className="text-xl font-semibold tabular-nums text-fitx-text">{target > 0 ? `${Math.round(percent)}%` : "N/A"}</span>
        <span className="mt-0.5 text-[11px] text-fitx-text-secondary">{label}</span>
      </div>
    </div>
  );
}
