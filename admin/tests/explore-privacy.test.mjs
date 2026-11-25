// Explore moderation sees only what was reported: only src/lib/data/explore-evidence.ts may name the message and
// conversation tables (and it reads one message's state, never a conversation). Every Explore screen checks
// explore.view, every Explore action explore.moderate, and the screens keep to the CSP and Admin's colours.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const SRC = new URL("../src/", import.meta.url);
const EVIDENCE = "lib/data/explore-evidence.ts";

async function sources(pattern = /\.(ts|tsx|css)$/) {
  const files = [];
  for (const name of await readdir(SRC, { recursive: true })) if (pattern.test(name)) files.push([name, await readFile(new URL(name, SRC), "utf8")]);
  return files;
}

test("only explore-evidence.ts names social_messages or social_conversations", async () => {
  const offenders = (await sources()).filter(([name, source]) => name !== EVIDENCE && /social_(messages|conversations|conversation_sides)/.test(source)).map(([name]) => name);
  assert.deepEqual(offenders, []);
  const evidence = await readFile(new URL(EVIDENCE, SRC), "utf8");
  assert.match(evidence, /\.from\("social_messages"\)\.select\("moderation_state,deleted_at"\)\.eq\("id", messageId\)\.maybeSingle\(\)/, "one message, by its id, and only its state");
  assert.doesNotMatch(evidence, /social_conversations|conversation_id|\.select\("\*"\)|\.select\("body/);
  assert.match(evidence, /EVIDENCE_LINK_SECONDS = 300/);
});

test("every Explore page needs explore.view and every Explore action explore.moderate", async () => {
  const root = new URL("app/(control)/explore/", SRC);
  const files = (await readdir(root, { recursive: true })).filter((name) => /(page\.tsx|actions\.ts)$/.test(name));
  assert.ok(files.length >= 6, String(files.length));
  for (const name of files) {
    const source = await readFile(new URL(name, root), "utf8");
    if (name.endsWith("page.tsx")) assert.match(source, /await requireAdmin\("explore\.view"\)/, name);
    for (const fn of source.matchAll(/export async function (\w+)\(/g)) {
      if (!name.endsWith("actions.ts")) continue;
      const body = source.slice(fn.index, source.indexOf("\n}\n", fn.index));
      // A plain form action, or one for useActionState (the forms that keep what was typed when refused).
      assert.match(body, /^export async function \w+\((?:_previous: FormState, )?formData: FormData\)(?:: Promise<FormState>)? \{\n  const actor = await requireAdmin\("explore\.moderate"\);/, `${name}: ${fn[1]}`);
    }
  }
  const data = await readFile(new URL("lib/data/explore.ts", SRC), "utf8");
  for (const fn of data.matchAll(/export async function (\w+)\(/g)) {
    const body = data.slice(fn.index, data.indexOf("\n}\n", fn.index));
    assert.match(body, /await requireAdmin\("explore\.(view|moderate)"\)/, `data.${fn[1]}`);
  }
});

test("a report page records the view on the audit log and signs media for 300 seconds only", async () => {
  const page = await readFile(new URL("app/(control)/explore/reports/[id]/page.tsx", SRC), "utf8");
  assert.match(page, /logAdminEvent\(\{ actor, action: "explore_report_viewed", resourceType: "social_report", resourceId: report\.id/);
  const evidence = await readFile(new URL(EVIDENCE, SRC), "utf8");
  assert.match(evidence, /createSignedUrl\(path, EVIDENCE_LINK_SECONDS\)/);
  assert.doesNotMatch(evidence, /getPublicUrl/);
});

test("the Explore screens set no inline styles and use only Admin's colour variables", async () => {
  const allowed = new Set(["--ink", "--ink-soft", "--muted", "--line", "--line-strong", "--paper", "--surface", "--surface-soft", "--coral", "--coral-deep", "--coral-pale", "--green", "--green-pale", "--red", "--red-pale", "--amber", "--amber-pale", "--shadow", "--radius", "--on-accent"]);
  const files = (await sources(/\.(tsx|css)$/)).filter(([name]) => name.startsWith("components/explore/") || name.startsWith("app/(control)/explore/"));
  assert.ok(files.length >= 8, String(files.length));
  for (const [name, source] of files) {
    if (name.endsWith(".tsx")) {
      assert.doesNotMatch(source, /\sstyle=\{|\sstyle="/, name);
      assert.doesNotMatch(source, /dangerouslySetInnerHTML/, name);
    } else {
      const css = source.replace(/\/\*[^]*?\*\//g, "");
      assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i, name);
      for (const match of css.matchAll(/var\((--[a-z-]+)\)/g)) assert.ok(allowed.has(match[1]), `${name}: ${match[1]}`);
      assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, `${name} respects reduced motion`);
    }
  }
});

test("buttons and targets: every Explore action button is a real 44 px button with a name", async () => {
  const forms = await readFile(new URL("components/explore/moderation-forms.tsx", SRC), "utf8");
  assert.match(forms, /name="action" value=\{action\} className=\{action === "hide" \? "primary-button" : "quiet-button"\}/);
  assert.match(forms, /Suspend from Explore/);
  assert.match(forms, /Lift suspension/);
  const css = await readFile(new URL("components/explore/explore.module.css", SRC), "utf8");
  for (const cls of ["tab", "edit summary"]) assert.match(css, new RegExp(`\\.${cls.replace(" ", " ")} \\{[^}]*min-height: 44px`), cls);
});
