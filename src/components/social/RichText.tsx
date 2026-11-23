import Link from "next/link";
import { textRuns } from "@/lib/social/text";
import styles from "./Explore.module.css";

/** A caption or comment with its #hashtags and @mentions as links. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {textRuns(text).map((run, index) => {
        if (run.kind === "tag") return <Link key={index} className={styles.tag} href={`/explore/discover?tag=${encodeURIComponent(run.tag)}`}>{run.text}</Link>;
        if (run.kind === "mention") return <Link key={index} className={styles.tag} href={`/explore/u/${encodeURIComponent(run.username)}`}>{run.text}</Link>;
        return <span key={index}>{run.text}</span>;
      })}
    </>
  );
}
