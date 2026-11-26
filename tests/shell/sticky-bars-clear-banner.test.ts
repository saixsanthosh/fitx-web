import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compile } from "tailwindcss";

// Release 3, fix round 3d (integration; the open item of the shell's round 3b). While the privacy banner is open it
// sets --fitx-inset-consent on <html>: from the banner's top edge to the window's bottom (its height, the gap under
// it and, on a phone, the bottom bar it floats over); unset, so 0, once a choice is made. The page's scroll padding
// then keeps a focused control clear of the banner, but it cannot move a bar that sticks to the bottom of the screen:
// such a bar kept its own bottom offset and sat under the banner (z-index 49 over their 5 to 40), its buttons hidden
// and their clicks taken. On a long setup step, Back and Continue; the recorder's Pause and Finish mid-run; the import
// screen's Import button; the AI Coach's message box (76 to about 226 px up on a phone, under a banner reaching about
// 270 px); the live workout's Previous and Next and its rest timer.
//
// Every sticky or fixed bar anchored to the bottom of the screen now raises its bottom offset to clear the banner
// while it is open, and keeps its own offset otherwise, or is listed below with the reason it never sits under the
// banner. A bar is an element positioned sticky or fixed with a bottom offset (a Tailwind bottom-* utility, a CSS
// bottom, or an inset whose top is auto). Layers that span the whole height (inset-0, inset-y-0, inset: 0: overlays,
// films, side drawers) are not bars.

const SRC = "src";
const read = (file: string) => readFileSync(`${SRC}/${file}`, "utf8");
const files = readdirSync(SRC, { recursive: true }).map(String).sort();
const CONSENT = "--fitx-inset-consent";

/** The bars that never sit under the banner, each with the reason. Keyed by file and what identifies the bar there. */
const NOT_UNDER_THE_BANNER: Array<{ file: string; bar: RegExp; reason: string }> = [
  {
    file: "components/layout/BottomNav.tsx",
    bar: /^fitx-app-only .*\bfixed inset-x-0 bottom-0\b/,
    reason: "the phone's bottom bar: the banner floats above it (.fitx-consent's bottom adds --fitx-inset-bottom-bar)",
  },
  {
    file: "app/(dashboard)/workouts/page.tsx",
    bar: /^sticky bottom-0 grid grid-cols-2 /,
    reason: "the workout builder's Save buttons: they stick inside the builder's own scrolling panel, a modal sheet drawn above the banner (z-index 50 over 49; consent-banner-place.test.ts)",
  },
  {
    file: "app/(dashboard)/nutrition/Nutrition.module.css",
    bar: /^\.addActions$/,
    reason: "Add to log's buttons: they stick inside the Log food sheet's own scrolling panel, a native modal <dialog> (Sheet.tsx, showModal) in the top layer, above the banner",
  },
  {
    file: "components/coach/CoachPanel.module.css",
    bar: /^\.panel$/,
    reason: "the AI Coach panel: a native modal <dialog> (CoachPanel.tsx, showModal) in the top layer, above the banner",
  },
];

type Bar = { file: string; bar: string; offsets: Array<{ variant: string; value: string }> };

/** The class tokens of every className attribute in a .tsx file: its quoted parts ("…" and `…`), per element. */
function classLists(text: string): string[][] {
  const lists: string[][] = [];
  for (const match of text.matchAll(/className=/g)) {
    const start = match.index + "className=".length;
    let value = "";
    if (text[start] === '"') value = text.slice(start, text.indexOf('"', start + 1) + 1);
    else if (text[start] === "{") {
      let depth = 0;
      let quote = "";
      for (let at = start; at < text.length && !value; at += 1) {
        const char = text[at];
        if (quote) {
          if (char === quote && text[at - 1] !== "\\") quote = "";
        } else if (char === '"' || char === "'" || char === "`") quote = char;
        else if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) value = text.slice(start, at + 1);
        }
      }
    }
    const quoted = [...value.matchAll(/"([^"]*)"|`([^`]*)`/g)].map((part) => (part[1] ?? part[2]).replace(/\$\{|[}"']/g, " "));
    lists.push(quoted.join(" ").split(/\s+/).filter(Boolean));
  }
  return lists;
}

const POSITIONED = /^(?:[a-z0-9-]+:)*(?:sticky|fixed)$/;
const BOTTOM = /^((?:[a-z0-9-]+:)*)bottom-(.+)$/;

/** A Tailwind bottom-* value as CSS: bottom-20 is 5rem (the 0.25rem scale), bottom-[…] its arbitrary value. */
function tailwindLength(raw: string): string {
  if (/^\[.+\]$/.test(raw)) return raw.slice(1, -1).replace(/_/g, " ");
  if (/^\d+(?:\.\d+)?$/.test(raw)) return `${Number(raw) * 0.25}rem`;
  throw new Error(`bottom-${raw}: add it to the model`);
}

function tsxBars(file: string): Bar[] {
  const bars: Bar[] = [];
  for (const tokens of classLists(read(file))) {
    if (!tokens.some((token) => POSITIONED.test(token))) continue;
    const offsets = tokens.flatMap((token) => {
      const match = BOTTOM.exec(token);
      return match ? [{ variant: match[1], value: tailwindLength(match[2]) }] : [];
    });
    if (offsets.length) bars.push({ file, bar: tokens.join(" "), offsets });
  }
  return bars;
}

/** Each innermost rule of a stylesheet (inside @media too), comments removed. */
function cssRules(text: string) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].trim().split(",").map((selector) => selector.trim().replace(/\s+/g, " ")),
    declarations: new Map(match[2].split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const colon = part.indexOf(":");
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as [string, string];
    })),
  }));
}

function cssBars(file: string): Bar[] {
  const rules = cssRules(read(file));
  const positioned = new Set(rules.filter((rule) => /^(sticky|fixed)$/.test(rule.declarations.get("position") ?? "")).flatMap((rule) => rule.selectors));
  const bars = new Map<string, Bar>();
  for (const rule of rules) {
    const inset = rule.declarations.get("inset")?.split(/\s+/);
    // inset: top [right [bottom [left]]]; anchored to the bottom only when its top is auto.
    const anchored = inset && inset[0] === "auto" ? (inset[2] ?? inset[0]) : undefined;
    const value = rule.declarations.get("bottom") ?? anchored;
    if (!value) continue;
    for (const selector of rule.selectors.filter((name) => positioned.has(name))) {
      const bar = bars.get(selector) ?? { file, bar: selector, offsets: [] };
      bar.offsets.push({ variant: "", value });
      bars.set(selector, bar);
    }
  }
  return [...bars.values()];
}

/** Every custom property a stylesheet defines, with each value it is given, in order. */
function cssVariables(file: string): Map<string, string[]> {
  const variables = new Map<string, string[]>();
  for (const rule of cssRules(read(file))) {
    for (const [name, value] of rule.declarations) if (name.startsWith("--")) variables.set(name, [...(variables.get(name) ?? []), value]);
  }
  return variables;
}

/** Inline styles that fix or stick an element with a bottom offset (none today; scanned so one can't slip in). */
function inlineBars(file: string): Bar[] {
  return [...read(file).matchAll(/position: "(?:sticky|fixed)"[^}]*\bbottom:\s*([^,}]+)/g)].map((match) => ({ file, bar: match[0], offsets: [{ variant: "", value: match[1].trim() }] }));
}

const bars = [
  ...files.filter((file) => file.endsWith(".tsx")).flatMap((file) => [...tsxBars(file), ...inlineBars(file)]),
  ...files.filter((file) => file.endsWith(".css")).flatMap(cssBars),
];

/** Whether a bottom offset reaches the banner's inset: directly, or through a variable whose every value does. */
function clearsTheBanner(bar: Bar, value: string): boolean {
  if (value.includes(CONSENT)) return true;
  const variables = bar.file.endsWith(".css") ? cssVariables(bar.file) : new Map<string, string[]>();
  return [...value.matchAll(/var\((--[a-z0-9-]+)/g)].some((match) => {
    const definitions = variables.get(match[1]) ?? [];
    return definitions.length > 0 && definitions.every((definition) => definition.includes(CONSENT));
  });
}

test("every sticky or fixed bar at the bottom of the screen clears the banner, or is listed with its reason", () => {
  const listed = new Set<string>();
  const raised: string[] = [];
  for (const bar of bars) {
    const entry = NOT_UNDER_THE_BANNER.find((item) => item.file === bar.file && item.bar.test(bar.bar));
    if (entry) {
      listed.add(entry.file);
      continue;
    }
    for (const { variant, value } of bar.offsets) {
      assert.ok(clearsTheBanner(bar, value), `${bar.file}: ${variant}bottom ${value} keeps its offset under the open banner (${bar.bar})`);
    }
    raised.push(bar.file);
  }
  for (const entry of NOT_UNDER_THE_BANNER) {
    assert.ok(listed.has(entry.file), `${entry.file}: the listed bar is gone, so drop it from the list`);
    assert.ok(entry.reason.length > 40, entry.file);
  }
  assert.deepEqual(raised.sort(), [
    "app/(dashboard)/workouts/active/page.tsx",
    "components/activity/ActivityImportScreen.tsx",
    "components/activity/ActivityRecorderScreen.tsx",
    "components/coach/Coach.module.css",
    "components/onboarding/Onboarding.module.css",
    "components/session/RestDock.tsx",
  ]);
});

// A small evaluator for the bottom offsets as CSS works them out: px, rem (16 px) and plain numbers, calc() with
// + - * /, max(), min(), var() with its fallback and env(safe-area-inset-bottom). consent null: the banner is closed,
// so --fitx-inset-consent is unset and var() takes its fallback.
type Values = { consent: number | null; safe: number };
type Token = { kind: "number" | "name" | "mark"; text: string; px: number };

function lex(text: string): Token[] {
  const tokens: Token[] = [];
  const afterOperand = () => {
    const last = tokens[tokens.length - 1];
    return Boolean(last && (last.kind !== "mark" || last.text === ")"));
  };
  for (let at = 0; at < text.length;) {
    const rest = text.slice(at);
    const char = text[at];
    if (/\s/.test(char)) at += 1;
    else if ("(),*/+".includes(char) || (char === "-" && rest[1] !== "-" && afterOperand())) {
      tokens.push({ kind: "mark", text: char, px: 0 });
      at += 1;
    } else if (/^-?(?:\d|\.\d)/.test(rest)) {
      const [whole, sign, amount, unit = ""] = /^(-?)(\d+(?:\.\d+)?|\.\d+)(px|rem)?/.exec(rest)!;
      const size = Number(amount) * (sign ? -1 : 1);
      tokens.push({ kind: "number", text: whole, px: unit === "rem" ? size * 16 : size });
      at += whole.length;
    } else {
      const name = /^-{0,2}[a-z][a-z0-9-]*/i.exec(rest);
      assert.ok(name, `${text}: can't read "${rest}"`);
      tokens.push({ kind: "name", text: name[0], px: 0 });
      at += name[0].length;
    }
  }
  return tokens;
}

function px(expression: string, values: Values): number {
  const tokens = lex(expression);
  let at = 0;
  const take = () => tokens[at++];
  const expect = (text: string) => assert.equal(take()?.text, text, `${expression}: ${text} expected`);
  const sum = (): number => {
    let value = product();
    while (tokens[at]?.text === "+" || tokens[at]?.text === "-") value = take().text === "+" ? value + product() : value - product();
    return value;
  };
  const product = (): number => {
    let value = operand();
    while (tokens[at]?.text === "*" || tokens[at]?.text === "/") value = take().text === "*" ? value * operand() : value / operand();
    return value;
  };
  const operand = (): number => {
    const token = take();
    assert.ok(token, `${expression}: ends too soon`);
    if (token.kind === "number") return token.px;
    if (token.text === "(") {
      const value = sum();
      expect(")");
      return value;
    }
    assert.equal(token.kind, "name", `${expression}: unexpected ${token.text}`);
    expect("(");
    if (token.text === "var") {
      const name = take().text;
      let fallback: number | null = null;
      if (tokens[at]?.text === ",") {
        take();
        fallback = sum();
      }
      expect(")");
      assert.equal(name, CONSENT, `${expression}: ${name} is not modelled`);
      assert.ok(fallback !== null, `${expression}: ${CONSENT} needs a fallback for when the banner is closed`);
      return values.consent ?? fallback;
    }
    if (token.text === "env") {
      const name = take().text;
      expect(")");
      assert.equal(name, "safe-area-inset-bottom");
      return values.safe;
    }
    const list = [sum()];
    while (tokens[at]?.text === ",") {
      take();
      list.push(sum());
    }
    expect(")");
    if (token.text === "calc") return list[0];
    if (token.text === "max") return Math.max(...list);
    if (token.text === "min") return Math.min(...list);
    throw new Error(`${expression}: ${token.text}() is not modelled`);
  };
  const value = sum();
  assert.equal(at, tokens.length, `${expression}: left over`);
  return value;
}

test("the evaluator reads the offsets as the browser does", () => {
  const closed = { consent: null, safe: 0 };
  assert.equal(px("0", closed), 0);
  assert.equal(px("5.25rem", closed), 84);
  assert.equal(px("calc(env(safe-area-inset-bottom)+.75rem)", { consent: null, safe: 34 }), 46);
  assert.equal(px("max(5rem,calc(var(--fitx-inset-consent,0px)+8px))", closed), 80);
  assert.equal(px("max(5rem,calc(var(--fitx-inset-consent,0px)+8px))", { consent: 270, safe: 0 }), 278);
  assert.equal(px("max(0px, calc(10px + 4px - 20px))", closed), 0);
  assert.equal(px("calc(2 * 3px - -1px)", closed), 7);
  assert.throws(() => px("var(--fitx-inset-consent)", closed), /needs a fallback/);
  assert.throws(() => px("var(--other, 4px)", closed), /not modelled/);
  assert.throws(() => px("50vh", closed), /left over/);
});

/** A bar's bottom offsets by the width they apply from (Tailwind's sm 640, md 768, lg 1024), as CSS. */
function offsetsOf(file: string, identify: RegExp | string): Record<string, string> {
  const found = bars.filter((bar) => bar.file === file && (typeof identify === "string" ? bar.bar === identify : identify.test(bar.bar)));
  assert.equal(found.length, 1, `${file}: one bar`);
  return Object.fromEntries(found[0].offsets.map(({ variant, value }) => [variant.replace(/:$/, "") || "base", value]));
}

const BANNERS = [120, 154, 200, 270, 330]; // from a laptop's 130 px banner 24 px up to a phone's over its bar, text enlarged
const SAFE = [0, 34]; // the home indicator's inset on a phone

// Each bar's offset before (so still with the banner closed), by width, and where it stops while the banner is open:
// `gap` above the banner's top edge, plus `above` for a bar that rides on another one.
type Place = { was: (safe: number) => number; above?: number };
const MODEL: Array<{ name: string; file: string; bar: RegExp | string; gap: number; places: Record<string, Place> }> = [
  { name: "setup's Back and Continue", file: "components/onboarding/Onboarding.module.css", bar: ".actions", gap: 0, places: { base: { was: () => 0 } } },
  { name: "the recorder's controls", file: "components/activity/ActivityRecorderScreen.tsx", bar: /^sticky bottom-/, gap: 0, places: { base: { was: () => 0 } } },
  { name: "the import screen's Import", file: "components/activity/ActivityImportScreen.tsx", bar: /^sticky bottom-/, gap: 8, places: { base: { was: () => 80 }, md: { was: () => 16 } } },
  { name: "the live workout's Previous and Next", file: "app/(dashboard)/workouts/active/page.tsx", bar: /^fixed inset-x-3 bottom-/, gap: 8, places: { base: { was: (safe) => safe + 12 } } },
  { name: "the rest timer", file: "components/session/RestDock.tsx", bar: /^fitx-panel fixed /, gap: 8, places: { base: { was: (safe) => safe + 84, above: 72 }, sm: { was: () => 16 } } },
];

test("with the banner closed each raised bar keeps its old offset; open, it stops just clear of the banner", () => {
  for (const { name, file, bar, gap, places } of MODEL) {
    const offsets = offsetsOf(file, bar);
    assert.deepEqual(Object.keys(offsets).sort(), Object.keys(places).sort(), name);
    for (const [width, value] of Object.entries(offsets)) {
      const { was, above = 0 } = places[width];
      for (const safe of SAFE) {
        assert.equal(px(value, { consent: null, safe }), was(safe), `${name} (${width}), banner closed, safe ${safe}`);
        for (const banner of BANNERS) {
          const consent = banner + safe;
          const open = px(value, { consent, safe });
          assert.equal(open, Math.max(was(safe), consent + gap + above), `${name} (${width}): under a banner reaching ${consent} px`);
          assert.ok(open >= consent + gap, name);
        }
      }
    }
  }
});

test("the rest timer rides on Previous and Next on a phone, banner or not; from 640 px it clears the banner alone", () => {
  const timer = offsetsOf("components/session/RestDock.tsx", /^fitx-panel fixed /);
  const bar = offsetsOf("app/(dashboard)/workouts/active/page.tsx", /^fixed inset-x-3 bottom-/);
  for (const safe of SAFE) {
    for (const banner of [null, ...BANNERS]) {
      const values = { consent: banner === null ? null : banner + safe, safe };
      // 4.5rem: the bar's 48 px and the 24 px between them, as before.
      assert.equal(px(timer.base, values) - px(bar.base, values), 72, `safe ${safe}, banner ${banner}`);
    }
  }
  // Previous and Next show only on phones, so from 640 px nothing is under the timer.
  assert.match(read("app/(dashboard)/workouts/active/page.tsx"), /fixed inset-x-3 bottom-\[[^\]]+\] z-30 mx-auto grid max-w-md grid-cols-2 gap-2 sm:hidden/);
  for (const banner of BANNERS) assert.equal(px(timer.sm, { consent: banner, safe: 0 }), banner + 8);
});

test("the AI Coach's message box stops 8 px above the banner, on phones and from 1024 px", () => {
  const places = cssVariables("components/coach/Coach.module.css").get("--coach-dock-bottom") ?? [];
  assert.equal(places.length, 2, "phones and tablets, then from 1024 px");
  assert.deepEqual(offsetsOf("components/coach/Coach.module.css", ".composerDock"), { base: "var(--coach-dock-bottom)" });
  const [phone, desktop] = places;
  for (const safe of SAFE) {
    assert.equal(px(phone, { consent: null, safe }), safe + 76, "over the phone's bar, as before");
    for (const banner of BANNERS) assert.equal(px(phone, { consent: banner + safe, safe }), banner + safe + 8);
  }
  assert.equal(px(desktop, { consent: null, safe: 0 }), 16, "16 px up from 1024 px, as before");
  for (const banner of BANNERS) assert.equal(px(desktop, { consent: banner, safe: 0 }), banner + 8);
  // The end of the conversation reads the same place (tests/ai/coach-end-room.test.ts models where it stops).
  assert.match(read("components/coach/Coach.module.css").replace(/\/\*[\s\S]*?\*\//g, ""), /\.end \{ scroll-margin-bottom: max\(0px, calc\(var\(--coach-dock-bottom, 76px\) \+/);
});

test("no note in the code still puts the banner at z-index 100 (it is 49 since round 3b)", () => {
  for (const file of files.filter((name) => /\.(tsx?|css)$/.test(name))) {
    assert.doesNotMatch(read(file), /(cookie|privacy|consent) banner \(z-index 100\)/i, file);
  }
});

// Fix round 3e (integration int-recorder-bar-joined-classes). Raising the recorder's controls above the banner, the
// round 3d edit lost the space between two of the bar's other classes: "z-[5]-mx-5". Tailwind makes no CSS for a
// class it can't read, and says nothing, so the bar lost its z-index (auto, not 5) and its -mx-5: at 390 px it spanned
// 37 to 353 instead of 17 to 373, its top divider 20 px short of the card's edges. Its bottom offset was right, so the
// tests above passed. Every bar's other classes and declarations were then checked against the code before that edit
// (only the bottom offsets had changed); the tests below catch the slip itself.

test("no class in src runs an arbitrary value into the next class", () => {
  // After the ] that closes an arbitrary value, a class ends, or goes on with ":" (a variant), "/" (a modifier) or
  // "!" (important). A letter, digit or hyphen there starts the next class with the space lost. Every source file is
  // read, so class lists kept in variables count too; inside className attributes, arbitrary properties ("[--x:1px]")
  // and variants ("[&>svg]:") as well. No class in src needs an exception.
  for (const file of files.filter((name) => /\.(tsx?|css)$/.test(name))) {
    for (const token of read(file).split(/[\s"'`]+/)) {
      assert.doesNotMatch(token, /-\[[^\]\s]*\][a-z0-9-]/i, `${file}: "${token}" runs two classes together`);
    }
    if (!file.endsWith(".tsx")) continue;
    for (const token of classLists(read(file)).flat()) {
      assert.doesNotMatch(token, /\][a-z0-9-]/i, `${file}: "${token}" runs two classes together`);
    }
  }
});

/** The stylesheets every page loads (not CSS modules), comments removed: their classes are the app's own. */
const GLOBAL_CSS = files.filter((file) => file.endsWith(".css") && !file.endsWith(".module.css")).map((file) => read(file).replace(/\/\*[\s\S]*?\*\//g, ""));
const ownClass = (token: string) => /^[\w-]+$/.test(token) && GLOBAL_CSS.some((css) => new RegExp(`\\.${token}(?![\\w-])`).test(css));

/** Whether Tailwind, compiled with the app's globals.css as the app's build does, makes CSS for a class. */
async function tailwindMakesCss(): Promise<(token: string) => boolean> {
  const compiler = await compile(read("app/globals.css"), {
    base: `${SRC}/app`,
    loadStylesheet: async (id: string, base: string) => {
      const path = id === "tailwindcss" ? "node_modules/tailwindcss/index.css" : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  // build() adds the classes it is given to those it has; for one it can't read it returns the same CSS.
  let css = compiler.build([]);
  const known = new Map<string, boolean>();
  return (token) => {
    let made = known.get(token);
    if (made === undefined) {
      const next = compiler.build([token]);
      made = next !== css;
      known.set(token, made);
      css = next;
    }
    return made;
  };
}

test("every class on a bar at the bottom of the screen is one Tailwind makes or the app's stylesheets define", async () => {
  const makesCss = await tailwindMakesCss();
  assert.ok(makesCss("z-[5]") && makesCss("-mx-5") && makesCss("bottom-[var(--fitx-inset-consent,0px)]"), "Tailwind reads the recorder's classes");
  assert.ok(!makesCss("z-[5]-mx-5") && !makesCss("mt-4border-t"), "and not two run together");
  assert.ok(ownClass("fitx-panel") && !ownClass("fitx-no-such-class"), "the app's own classes");
  const classBars = files.filter((file) => file.endsWith(".tsx")).flatMap(tsxBars);
  assert.ok(classBars.some((bar) => bar.file === "components/activity/ActivityRecorderScreen.tsx"), "the recorder's bar is read");
  for (const bar of classBars) {
    for (const token of bar.bar.split(" ")) {
      assert.ok(makesCss(token) || ownClass(token), `${bar.file}: "${token}" makes no CSS (two classes run together, or a misspelt one) and is not one of the app's own (${bar.bar})`);
    }
  }
});

test("each declaration of a bar in a stylesheet is one property and its value", () => {
  // The same slip in a stylesheet: a lost ";" runs two declarations into one, and the browser drops it.
  const withoutBrackets = (value: string) => {
    let flat = value;
    while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, "");
    return flat;
  };
  for (const file of files.filter((name) => name.endsWith(".css"))) {
    const selectors = new Set(cssBars(file).map((bar) => bar.bar));
    for (const rule of cssRules(read(file)).filter((item) => item.selectors.some((selector) => selectors.has(selector)))) {
      for (const [name, value] of rule.declarations) {
        assert.match(name, /^(?:--[a-z0-9-]+|-?[a-z]+(?:-[a-z]+)*)$/, `${file} ${rule.selectors.join(", ")}: "${name}"`);
        assert.ok(value && !withoutBrackets(value).includes(":"), `${file} ${rule.selectors.join(", ")}: "${name}: ${value}" runs two declarations together`);
      }
    }
  }
});
