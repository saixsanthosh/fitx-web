import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { returnFocusTarget, type FocusTarget } from "@/components/ui/sheet-focus";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const element = (name: string, isConnected = true): FocusTarget & { name: string } => ({ name, isConnected, focus: () => undefined });

// Bug 83 (explore-4): closing New message left focus on the page body, because Message was disabled while it looked
// up conversations, so the sheet recorded the body as the element to return to.
test("a sheet returns focus to the control its host names, else to its opener, never to the page itself", () => {
  const body = element("body");
  const message = element("Message");
  const opener = element("opener");
  assert.equal(returnFocusTarget(message, body, body), message, "the named Message button wins over a body opener");
  assert.equal(returnFocusTarget(message, opener, body), message);
  assert.equal(returnFocusTarget(null, opener, body), opener, "without a named control: the opener, as before");
  assert.equal(returnFocusTarget(undefined, opener, body), opener);
  assert.equal(returnFocusTarget(element("gone", false), opener, body), opener, "a named control that left the page is skipped");
  assert.equal(returnFocusTarget(null, element("gone", false), body), null, "an opener that left the page: focus stays put");
  assert.equal(returnFocusTarget(null, body, body), null, "the page itself is never a target");
  assert.equal(returnFocusTarget(null, null, body), null);
});

test("Sheet takes returnFocus as an optional, additive prop and uses the same rule on close and on unmount", () => {
  const sheet = source("src/components/ui/Sheet.tsx");
  assert.match(sheet, /returnFocus\?: RefObject<HTMLElement \| null>;/);
  assert.equal((sheet.match(/returnFocusTarget\(named\.current\?\.current, opener\.current, document\.body\)\?\.focus\(\);/g) ?? []).length, 2);
  // Existing props keep their names and defaults (other streams' sheets are unchanged).
  assert.match(sheet, /export function Sheet\(\{ open, onClose, title, description, children, footer, side = "auto", className = "", returnFocus \}: SheetProps\)/);
});

test("Message stays focusable while it looks things up, and names itself as the place to return to", () => {
  const button = source("src/components/social/messages/MessageButton.tsx");
  assert.doesNotMatch(button, /disabled=\{busy\}/, "no disabled-while-busy");
  assert.match(button, /<button ref=\{button\} type="button" [^>]*aria-disabled=\{busy \|\| undefined\}/);
  assert.match(button, /async function open\(\) \{\s*if \(busy\) return;/, "a second press while busy does nothing");
  assert.match(button, /<NewMessageSheet [^>]*returnFocus=\{button\}/);
  assert.match(source("src/components/social/messages/NewMessageSheet.tsx"), /<Sheet open=\{open\} onClose=\{onClose\} title="New message" returnFocus=\{returnFocus\}>/);
});
