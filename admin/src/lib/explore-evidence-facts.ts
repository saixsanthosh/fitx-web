// The named facts of a report's snapshot, as Admin shows them under "What was reported": each value in Admin's own
// words, a time in IST like every other time in Admin, a label for a stored code, never the raw stored value
// (BUGS.md 67: a message's "Sent" read "2026-11-25T15:12:06.677982+00:00"). Imports only explore-rules and time,
// which have no imports, so tests can load it.
import { METRIC_LABELS, type TargetType } from "@/lib/explore-rules";
import { formatIstDateTime } from "@/lib/time";

export type EvidenceFact = { label: string; value: string };

const text = (value: unknown, max = 300): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const handle = (value: unknown): string | null => {
  const name = text(value, 60);
  return name ? `@${name}` : null;
};
/** A stored code in words; an unknown code as it is (a moderator still sees it), nothing for no value. */
const word = (words: Record<string, string>, value: unknown): string | null =>
  typeof value === "string" && Object.hasOwn(words, value) ? words[value] : text(value, 60);

const VISIBILITY: Record<string, string> = { public: "Public", private: "Private" };
const KINDS: Record<string, string> = { weekly: "Weekly", monthly: "Monthly" };
const METRICS: Record<string, string> = Object.fromEntries(Object.entries(METRIC_LABELS).map(([metric, { label }]) => [metric, label]));

export function evidenceFacts(targetType: TargetType, snapshot: Record<string, unknown>): EvidenceFact[] {
  const facts: EvidenceFact[] = [];
  const add = (label: string, value: string | null) => {
    if (value) facts.push({ label, value });
  };
  switch (targetType) {
    case "post":
      add("Author", handle(snapshot.author));
      add("Place", text(snapshot.location));
      if (snapshot.kind === "video" || snapshot.kind === "text") add("Kind", snapshot.kind === "video" ? "Video post" : "Discussion");
      break;
    case "comment":
    case "story":
      add("Author", handle(snapshot.author));
      break;
    case "message":
      add("Sender", handle(snapshot.sender));
      add("Sent", typeof snapshot.created_at === "string" ? formatIstDateTime(snapshot.created_at) : null);
      break;
    case "account":
      add("Username", handle(snapshot.username));
      add("Name", text(snapshot.display_name));
      break;
    case "community":
      add("Name", text(snapshot.name));
      add("Address", typeof snapshot.slug === "string" && snapshot.slug ? `/explore/c/${snapshot.slug.slice(0, 60)}` : null);
      add("Visibility", word(VISIBILITY, snapshot.visibility));
      break;
    case "challenge":
      add("Title", text(snapshot.title));
      add("Kind", word(KINDS, snapshot.kind));
      add("Counts", word(METRICS, snapshot.metric));
      break;
  }
  return facts;
}
