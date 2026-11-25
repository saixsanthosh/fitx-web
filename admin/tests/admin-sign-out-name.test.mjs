// Admin's header Sign out button (BUGS.md 91, cross-cutting-7): below 640 px its words were display:none and its icon
// is hidden from screen readers, so the only way to sign out on a phone was an unnamed "button". The words are now
// hidden from the eye only (the sr-only pattern), so the button is named "Sign out" at every width.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("the Sign out button keeps its words for screen readers at every width", async () => {
  const shell = await readFile(new URL("../src/components/admin-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<button className=\{styles\.signOut\} type="submit"><LogOut aria-hidden="true" size=\{17\} \/><span>Sign out<\/span><\/button>/);
  const css = await readFile(new URL("../src/components/admin-shell.module.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/\.signOut span \{([^}]*)\}/g)].map((match) => match[1]);
  assert.equal(rules.length, 2, "one rule for phones, one from 640 px");
  for (const rule of rules) assert.doesNotMatch(rule, /display:\s*none|visibility:\s*hidden/, rule);
  assert.match(rules[0], /position: absolute; width: 1px; height: 1px;[^]*clip-path: inset\(50%\)/, "phones: hidden from the eye only");
  assert.match(rules[1], /position: static;[^]*clip-path: none/, "from 640 px: shown");
  assert.ok(css.indexOf(rules[1]) > css.indexOf("@media (min-width: 640px)"), "the shown rule is inside the 640 px query");
});
