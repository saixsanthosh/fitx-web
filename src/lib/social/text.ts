/**
 * Captions and comments as text runs: plain text, #hashtags and @mentions, matching the database's own parsing
 * (fitx_social_hashtags_in and fitx_social_mentions_in), so a link is drawn exactly where the database records one.
 */
export type TextRun = { kind: "text"; text: string } | { kind: "tag"; text: string; tag: string } | { kind: "mention"; text: string; username: string };

const TOKEN = /(^|[^a-zA-Z0-9_&])#([a-zA-Z0-9_]{1,50})|(^|[^a-zA-Z0-9_.])@([a-zA-Z0-9._]{3,30})/g;

export function textRuns(input: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const previous = runs[runs.length - 1];
    if (previous?.kind === "text") previous.text += text;
    else runs.push({ kind: "text", text });
  };
  for (const match of input.matchAll(TOKEN)) {
    const lead = match[1] ?? match[3] ?? "";
    const start = (match.index ?? 0) + lead.length;
    push(input.slice(last, start));
    if (match[2] !== undefined) {
      runs.push({ kind: "tag", text: `#${match[2]}`, tag: match[2].toLowerCase() });
      last = start + 1 + match[2].length;
    } else {
      // A sentence's full stop after a name is not part of it.
      const raw = match[4];
      const name = raw.replace(/\.+$/, "");
      if (name.length < 3) {
        push(`@${raw}`);
      } else {
        runs.push({ kind: "mention", text: `@${name}`, username: name.toLowerCase() });
        push(raw.slice(name.length));
      }
      last = start + 1 + raw.length;
    }
  }
  push(input.slice(last));
  return runs;
}

/** The distinct hashtags of a text, lower case, at most 30, in order. */
export function hashtagsIn(input: string): string[] {
  const tags: string[] = [];
  for (const run of textRuns(input)) if (run.kind === "tag" && !tags.includes(run.tag)) tags.push(run.tag);
  return tags.slice(0, 30);
}

/** The distinct mentioned usernames of a text, lower case, at most 20, in order. */
export function mentionsIn(input: string): string[] {
  const names: string[] = [];
  for (const run of textRuns(input)) if (run.kind === "mention" && !names.includes(run.username)) names.push(run.username);
  return names.slice(0, 20);
}
