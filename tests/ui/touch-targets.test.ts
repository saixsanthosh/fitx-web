import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Flow 29's tablet sweep (820 px) notes targets under 44 px. These are the ones it found, as the source now draws them
// (JSX and CSS modules, which `node --test` cannot render, so their source is checked). Tailwind's 11 is 2.75rem: 44 px.
const source = (file: string) => readFileSync(file, "utf8");
const css = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "");

test("Library cards: the card is the exercise's link, and its title row is a 44 px target too (was 19 px tall)", () => {
  const card = source("src/components/exercises/discovery/ExerciseResultCard.tsx");
  const title = card.match(/<h3[^>]*>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<Link href=\{href\} onClick=\{onOpen\} className="([^"]+)">/)?.[1] ?? "";
  assert.ok(title, "the title link is found");
  for (const token of ["flex", "min-h-11", "items-center", "after:absolute", "after:inset-0"]) assert.ok(title.split(/\s+/).includes(token), token);
  assert.match(card, /<article[^>]*className=\{`[^`]*\brelative\b/, "the link's ::after covers the card");
});

test("Explore's first-visit set-up: each switch is a 54 × 44 px button drawing its 50 × 30 track inside (was 50 × 30)", () => {
  const styles = css("src/components/social/Explore.module.css");
  assert.match(styles, /^\.switch \{[^}]*width: 54px; height: 44px;/m);
  assert.match(styles, /^\.switch::before \{[^}]*width: 50px; height: 30px;/m);
  assert.match(source("src/components/social/Switch.tsx"), /role="switch"[\s\S]*className=\{styles\.switch\}/);
  assert.match(source("src/components/social/ProfileForm.tsx"), /<SwitchRow id="social-private"/, "the set-up's switch is this one");
});

test("Segmented controls (Progress, Activity): the 1 × 1 '_r_' radios are hidden on purpose; their 44 × 44 px labels are the targets", () => {
  const segmented = source("src/components/ui/Segmented.tsx");
  // Each radio's `name` is React's useId() (`_r_0_` and so on), what flow 29 used to report for it, measured at 1 × 1;
  // the flow now measures the label around it (below, and the next test).
  assert.match(segmented, /const name = useId\(\);/);
  assert.match(segmented, /<input\s+type="radio"\s+name=\{name\}[\s\S]*?className="peer sr-only"/);
  // The label holds the radio and its visible segment, which is at least 44 px each way.
  assert.match(segmented, /<label key=\{option\.value\}[^>]*>\s*<input/);
  const segment = segmented.match(/<span className="([^"]+)">\s*\{option\.icon\}/)?.[1] ?? "";
  for (const token of ["flex", "min-h-11", "min-w-11"]) assert.ok(segment.split(/\s+/).includes(token), token);
  for (const file of ["src/components/progress/ProgressAnalytics.tsx", "src/components/activity/ActivityHome.tsx"]) {
    assert.match(source(file), /<Segmented\b/, `${file} uses it`);
  }
});

test("flow 29 measures what a member taps: a radio or checkbox by its label, a visually hidden control by its label or not at all", async () => {
  const { findSmallTargets } = await import("../e2e/flows/29-tablet-sweep.mjs");
  // A stand-in for the few DOM calls findSmallTargets makes, with the components' markup: Segmented (a 1 × 1 sr-only
  // radio inside the label that draws the segment), Nutrition's diet filter (a visible checkbox wrapped in its label),
  // a checkbox named by a label elsewhere (`for`), a hidden file input with no label, a small button, a text field and
  // a link inside prose.
  type Box = { width: number; height: number };
  type Node = {
    tagName: string;
    type?: string;
    textContent: string;
    display?: string;
    parent: Node | null;
    labels?: Node[];
    attributes?: Record<string, string>;
    getBoundingClientRect(): Box;
    getAttribute(name: string): string | null;
    closest(selector: string): Node | null;
  };
  const node = (tagName: string, [width, height]: [number, number], extra: Partial<Node> = {}): Node => {
    const self: Node = {
      tagName,
      textContent: "",
      parent: null,
      ...extra,
      getBoundingClientRect: () => ({ width, height }),
      getAttribute: (name) => self.attributes?.[name] ?? null,
      closest: (selector) => {
        const tags = selector.split(",").map((part) => part.trim().toUpperCase());
        for (let at: Node | null = self; at; at = at.parent) if (tags.includes(at.tagName)) return at;
        return null;
      },
    };
    return self;
  };
  const within = (parent: Node, child: Node) => Object.assign(child, { parent });
  const segment = node("LABEL", [58, 44], { textContent: "Week" });
  const squeezed = node("LABEL", [40, 44], { textContent: "All" });
  const filter = node("LABEL", [132, 44], { textContent: "Hide non-veg" });
  const elsewhere = node("LABEL", [120, 44], { textContent: "Show rest days" });
  const prose = node("P", [600, 60]);
  const elements = [
    within(segment, node("INPUT", [1, 1], { type: "radio", attributes: { name: "_r_0_" } })),
    within(squeezed, node("INPUT", [1, 1], { type: "radio", attributes: { name: "_r_0_" } })),
    within(filter, node("INPUT", [16, 16], { type: "checkbox" })),
    node("INPUT", [16, 16], { type: "checkbox", labels: [elsewhere] }),
    node("INPUT", [1, 1], { type: "file", attributes: { name: "photo" } }),
    node("BUTTON", [30, 30], { attributes: { "aria-label": "Close" } }),
    node("INPUT", [200, 36], { type: "text", attributes: { name: "q" } }),
    within(prose, node("A", [50, 18], { textContent: "food sources", display: "inline" })),
  ];
  const globals = globalThis as unknown as { document?: unknown; getComputedStyle?: unknown };
  const saved = { document: globals.document, getComputedStyle: globals.getComputedStyle };
  globals.document = { querySelectorAll: () => elements };
  globals.getComputedStyle = (element: Node) => ({ display: element.display ?? "inline-flex" });
  try {
    assert.deepEqual(findSmallTargets(), ["All 40×44", "Close 30×30", "q 200×36"],
      "the segments and the checkboxes are measured by their labels (only the squeezed one is small); the unlabelled hidden input and the link in prose are left out");
  } finally {
    globals.document = saved.document;
    globals.getComputedStyle = saved.getComputedStyle;
  }
  // The markup the stand-in copies: Segmented's radio sits inside its label (above), and so does the diet filter's checkbox.
  assert.match(source("src/app/(dashboard)/nutrition/page.tsx"), /<label className=\{styles\.filter\}><input type="checkbox"/);
});

test("Workouts: History's “All” link is 44 × 44 px (was just under 44 px wide)", () => {
  assert.match(css("src/app/(dashboard)/workouts/Workouts.module.css"), /^\.textLink \{[^}]*min-width: 44px;[^}]*min-height: 44px;/m);
  assert.match(source("src/app/(dashboard)/workouts/page.tsx"), /<Link href="\/workouts\/history" className=\{styles\.textLink\}>All<ArrowRight/);
});
