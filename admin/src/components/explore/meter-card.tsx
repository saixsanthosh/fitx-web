import { Panel } from "@/components/console/ui";
import type { ExploreMeter } from "@/lib/data/explore";
import { FREE_PLAN, formatBytes, meterTone, share } from "@/lib/explore-rules";
import { formatIstDateTime } from "@/lib/time";
import styles from "./explore.module.css";

const KIND_LABELS: Record<string, string> = { photos: "Photos", videos: "Videos", posters: "Posters", stories: "Stories", avatars: "Profile photos", covers: "Covers" };

/** One measured amount against its limit, as a labelled bar (SVG attributes, no inline styles: the CSP blocks them). */
function Gauge({ label, used, limit, unsized = 0, limitLabel }: { label: string; used: number | null; limit: number | null; unsized?: number; limitLabel: string }) {
  const fraction = share(used, limit);
  const tone = meterTone(fraction);
  const width = fraction === null ? 0 : Math.max(Math.min(fraction, 1) * 100, fraction > 0 ? 1 : 0);
  const percent = fraction === null ? null : Math.round(fraction * 1000) / 10;
  return (
    <div className={`${styles.gauge} ${styles[tone] ?? ""}`}>
      <p className={styles.gaugeTop}>
        {label}
        <span>{used === null ? "Not known" : `${unsized > 0 ? "At least " : ""}${formatBytes(used)} of ${limitLabel}${percent === null ? "" : ` (${percent}%)`}`}</span>
      </p>
      <svg className={styles.bar} viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={`${label}: ${used === null ? "not known" : `${formatBytes(used)} of ${limitLabel}`}`}>
        <rect className={styles.barTrack} x={0} y={0} width={100} height={8} rx={4} />
        {width > 0 && <rect className={styles.barFill} x={0} y={0} width={width} height={8} rx={4} />}
      </svg>
      {unsized > 0 && <p className={styles.note}>{unsized.toLocaleString("en-IN")} {unsized === 1 ? "file has" : "files have"} no recorded size, so the real total is higher.</p>}
    </div>
  );
}

/** The Supabase Free plan as Explore uses it: storage, Explore's own caps, the database and today's video plays. */
export function MeterCard({ meter }: { meter: ExploreMeter }) {
  const storage = meter.buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
  const unsized = meter.buckets.reduce((sum, bucket) => sum + bucket.unsized, 0);
  const social = meter.buckets.find((bucket) => bucket.bucket === "social-media");
  const videos = (meter.explore.videos?.bytes ?? 0) + (meter.explore.posters?.bytes ?? 0);
  const kinds = Object.entries(meter.explore).filter(([, value]) => value.files > 0);
  return (
    <Panel title="Free plan" hint={`Measured ${formatIstDateTime(meter.measuredAt) ?? "now"}. Egress is shown only in the Supabase dashboard.`} id="explore-meter">
      <div className={styles.meter}>
        <Gauge label="Storage, all buckets" used={storage} limit={FREE_PLAN.storageBytes} unsized={unsized} limitLabel="1 GB" />
        <Gauge label="Explore files" used={social ? social.bytes : null} limit={meter.caps.socialMediaBytes} unsized={social?.unsized ?? 0} limitLabel={formatBytes(meter.caps.socialMediaBytes)} />
        <Gauge label="Videos and posters" used={videos} limit={meter.caps.videoBytes} unsized={(meter.explore.videos?.unsized ?? 0) + (meter.explore.posters?.unsized ?? 0)} limitLabel={formatBytes(meter.caps.videoBytes)} />
        <Gauge label="Video plays signed today" used={meter.videoPlayBytesToday} limit={meter.caps.videoPlayBytesPerDay} limitLabel={`${formatBytes(meter.caps.videoPlayBytesPerDay)} a day`} />
        <Gauge label="Database" used={meter.databaseBytes} limit={FREE_PLAN.databaseBytes} limitLabel="500 MB" />
        {kinds.length > 0 && (
          <ul className={styles.kinds} aria-label="Explore files by kind">
            {kinds.map(([kind, value]) => <li key={kind}>{KIND_LABELS[kind] ?? kind} · {value.files.toLocaleString("en-IN")} · {formatBytes(value.bytes)}</li>)}
          </ul>
        )}
        <p className={styles.note}>
          {meter.trash.files === null ? "Clean-up queue not known." : meter.trash.files === 0 ? "No files waiting for the clean-up." : `${meter.trash.files.toLocaleString("en-IN")} ${meter.trash.files === 1 ? "file waits" : "files wait"} for the nightly clean-up${meter.trash.oldest ? ` (oldest ${formatIstDateTime(meter.trash.oldest)})` : ""}.`}
          {" "}
          {meter.hourlyJob ? `Hourly clean-up last ran ${formatIstDateTime(meter.hourlyJob.startedAt) ?? "at an unknown time"}${meter.hourlyJob.status ? ` (${meter.hourlyJob.status})` : ""}.` : "Hourly clean-up: no run recorded."}
        </p>
      </div>
    </Panel>
  );
}
