import { Fragment, type ReactNode } from "react";

/**
 * Renders the coach's plain-text replies: paragraphs, "- " and "1. " lists, and **bold**. Builds
 * React elements only (no HTML injection), so nothing in a reply can run as code.
 */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (index < lines.length && (ordered ? numbered : bullet).test(lines[index])) {
        items.push(lines[index].replace(ordered ? numbered : bullet, ""));
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={ordered ? "list-decimal space-y-1.5 pl-5" : "list-disc space-y-1.5 pl-5 marker:text-fitx-text-disabled"}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !bullet.test(lines[index]) && !numbered.test(lines[index])) {
      paragraph.push(lines[index].replace(/^#{1,6}\s+/, ""));
      index += 1;
    }
    blocks.push(<p key={blocks.length}>{paragraph.map((part, partIndex) => <Fragment key={partIndex}>{partIndex > 0 && <br />}{inline(part)}</Fragment>)}</p>);
  }
  return <div className="space-y-3 text-[15px] leading-7 text-fitx-text">{blocks}</div>;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}
