// Bug 77 (cross-cutting-11), the sign-in pages' part: "Create an account", "Sign in" (on sign-up) and "Back to sign in"
// were 40 px tall stand-alone targets (`.account a { min-height: 40px }`). Every control the sign-in pages draw is now at
// least 44 x 44 px, and the footer gives back the 4 px the account links gained, so each page still fits one screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/components/auth/auth.module.css", import.meta.url), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector` (outside media queries or inside). */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `auth.module.css has a rule for ${selector}`);
  return Object.fromEntries(match[1].split(";").map((part) => part.split(":")).filter((pair) => pair.length >= 2).map(([name, ...value]) => [name.trim(), value.join(":").trim()]));
}

const px = (value: string | undefined) => (value && /^\d+px$/.test(value) ? Number.parseInt(value, 10) : NaN);

test("the account links under the sign-in forms are 44 x 44 px targets", () => {
  const account = rule(".account a");
  assert.ok(px(account["min-height"]) >= 44, `.account a min-height ${account["min-height"]}`);
  assert.ok(px(account["min-width"]) >= 44, `.account a min-width ${account["min-width"]}`);
});

test("the footer gives back what the account links gained, so the pages still fit one screen", () => {
  // Before: 12 px of padding above a 40 px link line. Now 8 px above a 44 px one: the same 52 px.
  const footer = rule(".footer");
  assert.equal(px(footer["padding-top"]) + px(rule(".account a")["min-height"]), 52);
});

test("every other control on the sign-in pages is at least 44 px tall", () => {
  for (const selector of [".homeLink", ".tilt", ".link", ".details > summary", ".primary", ".google", ".option"]) {
    const declarations = rule(selector);
    assert.ok(px(declarations["min-height"]) >= 44, `${selector} min-height ${declarations["min-height"]}`);
  }
  for (const selector of [".pause", ".reveal"]) {
    const declarations = rule(selector);
    assert.ok(px(declarations.width) >= 44 && px(declarations.height) >= 44, `${selector} ${declarations.width} x ${declarations.height}`);
  }
});
