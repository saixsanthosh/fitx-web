// The content migration's audit actions are in the catalogue, and the content screens keep to Admin's
// strict CSP (no inline styles) and its colour variables (no raw colours).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const audit = await importTypeScriptModule("src/lib/audit-catalog.ts");
const content = await importTypeScriptModule("src/lib/audit-catalog-content.ts");
const migration = await readFile(new URL("../../supabase/migrations/20261121100036_fitx_admin_content.sql", import.meta.url), "utf8");

const SRC = new URL("../src/", import.meta.url);
const CONTENT_DIRS = ["app/(control)/training/", "app/(control)/nutrition/", "app/(control)/billing/", "app/(control)/reports/", "components/content/", "lib/content/"];

async function contentFiles(pattern) {
  const files = [];
  for (const dir of CONTENT_DIRS) {
    for (const name of await readdir(new URL(dir, SRC), { recursive: true })) {
      if (pattern.test(name)) files.push([`${dir}${name}`, await readFile(new URL(`${dir}${name}`, SRC), "utf8")]);
    }
  }
  return files;
}

test("every action the content migration writes is catalogued as written by the database", () => {
  const written = [...migration.matchAll(/fitx_admin_op_log_event\(p_operator_id, '([a-z_]+)', '([a-z_]+)'/g)];
  assert.ok(written.length >= 14, String(written.length));
  for (const [, action, resource] of written) {
    assert.ok(audit.isAuditAction(action), `${action} is written by SQL but missing from the catalogue`);
    assert.equal(audit.AUDIT_ACTIONS[action].source, "database", action);
    assert.ok(content.CONTENT_AUDIT_RESOURCE_TYPES.includes(resource), resource);
  }
  for (const action of Object.keys(content.CONTENT_AUDIT_ACTIONS)) assert.match(action, /^[a-z][a-z0-9_]{2,79}$/);
});

test("actions the Admin server logs itself are catalogued as server actions", async () => {
  for (const [name, source] of await contentFiles(/\.(ts|tsx)$/)) {
    for (const match of source.matchAll(/action: "([a-z_]+)"/g)) {
      assert.ok(audit.isAuditAction(match[1]), `${name}: ${match[1]}`);
      assert.equal(audit.AUDIT_ACTIONS[match[1]].source, "server", `${name}: ${match[1]}`);
    }
  }
});

test("content screens set no inline styles (the CSP blocks them)", async () => {
  for (const [name, source] of await contentFiles(/\.tsx$/)) {
    assert.doesNotMatch(source, /\sstyle=\{|\sstyle="/, name);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/, name);
  }
});

test("content CSS uses only Admin's colour variables", async () => {
  const allowed = new Set(["--ink", "--ink-soft", "--muted", "--line", "--line-strong", "--paper", "--surface", "--surface-soft", "--coral", "--coral-deep", "--coral-pale", "--green", "--green-pale", "--red", "--red-pale", "--shadow", "--radius"]);
  for (const [name, source] of await contentFiles(/\.css$/)) {
    const css = source.replace(/\/\*[^]*?\*\//g, "");
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i, name);
    for (const match of css.matchAll(/var\((--[a-z-]+)\)/g)) assert.ok(allowed.has(match[1]), `${name}: ${match[1]}`);
  }
});

test("buttons and controls in the content CSS are at least 44 px high", async () => {
  const [[, css]] = await contentFiles(/content\.module\.css$/);
  for (const selector of [".button,", ".small {", ".tab {", ".input,", ".choice span {", ".toggle {"]) {
    const block = css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
    assert.match(block, /min-height: 44px/, selector);
  }
});
