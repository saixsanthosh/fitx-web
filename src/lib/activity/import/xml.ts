/*
 * A small, single-pass XML scanner for GPX and TCX files. It reads elements, attributes and text in
 * one linear walk, never builds a DOM and never expands entities beyond the five XML ones and
 * character references (a DOCTYPE is skipped, so files cannot define entities of their own). That
 * keeps huge or hostile files cheap: no "billion laughs", no external entities, no quadratic regex
 * backtracking on unclosed tags.
 */

export class XmlError extends Error {}

export type XmlHandler = {
  /** An element opened. `name` and attribute names are local names (namespace prefix removed). */
  open?(name: string, attrs: Readonly<Record<string, string>>, selfClosing: boolean): void;
  close?(name: string): void;
  /** Text inside the current element (entities decoded). Called only while `wantText()` says so. */
  text?(text: string): void;
  wantText?(): boolean;
};

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

/** Decodes the five XML entities and numeric character references; anything else is kept as written. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,4});/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

const localName = (qualified: string) => {
  const colon = qualified.lastIndexOf(":");
  return colon >= 0 ? qualified.slice(colon + 1) : qualified;
};

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = 0;
  const n = source.length;
  while (i < n) {
    while (i < n && isSpace(source.charCodeAt(i))) i++;
    const nameStart = i;
    while (i < n && !isSpace(source.charCodeAt(i)) && source[i] !== "=") i++;
    const name = source.slice(nameStart, i);
    while (i < n && isSpace(source.charCodeAt(i))) i++;
    if (!name) break;
    if (source[i] !== "=") continue;
    i++;
    while (i < n && isSpace(source.charCodeAt(i))) i++;
    const quote = source[i];
    if (quote !== "\"" && quote !== "'") break;
    const end = source.indexOf(quote, i + 1);
    if (end < 0) throw new XmlError("Unclosed attribute value");
    attrs[localName(name)] = decodeEntities(source.slice(i + 1, end));
    i = end + 1;
  }
  return attrs;
}

/** The index of the `>` that ends a tag starting at `from`, skipping quoted attribute values. */
function tagEnd(xml: string, from: number): number {
  let quote = "";
  for (let i = from; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * Walks `xml` and reports elements and text to `handler`. Throws XmlError for broken markup
 * (an unclosed tag, comment or CDATA section) or nesting deeper than `maxDepth`.
 */
export function scanXml(xml: string, handler: XmlHandler, options: { maxDepth?: number } = {}): void {
  const maxDepth = options.maxDepth ?? 64;
  let depth = 0;
  let i = 0;
  const n = xml.length;
  const wantsText = () => Boolean(handler.text) && (handler.wantText ? handler.wantText() : true);
  while (i < n) {
    const lt = xml.indexOf("<", i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i && wantsText()) {
      const raw = xml.slice(i, textEnd);
      if (raw.trim()) handler.text!(decodeEntities(raw));
    }
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlError("Unclosed comment");
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlError("Unclosed CDATA section");
      if (wantsText()) handler.text!(xml.slice(lt + 9, end));
      i = end + 3;
    } else if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlError("Unclosed processing instruction");
      i = end + 2;
    } else if (xml.startsWith("<!", lt)) {
      // A DOCTYPE (possibly with an internal subset in brackets): skipped, never interpreted.
      const bracket = xml.indexOf("[", lt);
      const close = xml.indexOf(">", lt);
      if (close < 0) throw new XmlError("Unclosed declaration");
      if (bracket >= 0 && bracket < close) {
        const subsetEnd = xml.indexOf("]", bracket);
        const end = subsetEnd < 0 ? -1 : xml.indexOf(">", subsetEnd);
        if (end < 0) throw new XmlError("Unclosed declaration");
        i = end + 1;
      } else {
        i = close + 1;
      }
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) throw new XmlError("Unclosed end tag");
      const name = localName(xml.slice(lt + 2, end).trim());
      depth = Math.max(0, depth - 1);
      handler.close?.(name);
      i = end + 1;
    } else {
      const end = tagEnd(xml, lt + 1);
      if (end < 0) throw new XmlError("Unclosed tag");
      let body = xml.slice(lt + 1, end);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      let nameEnd = 0;
      while (nameEnd < body.length && !isSpace(body.charCodeAt(nameEnd))) nameEnd++;
      const name = localName(body.slice(0, nameEnd));
      if (!name) throw new XmlError("Empty tag name");
      const attrs = nameEnd < body.length ? parseAttributes(body.slice(nameEnd)) : {};
      if (!selfClosing && ++depth > maxDepth) throw new XmlError("Nested too deeply");
      handler.open?.(name, attrs, selfClosing);
      if (selfClosing) handler.close?.(name);
      i = end + 1;
    }
  }
}
