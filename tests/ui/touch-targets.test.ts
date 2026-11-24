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
  // The flow names each radio by its `name`, React's useId() (`_r_0_` and so on), because it has no text of its own.
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

test("Workouts: History's “All” link is 44 × 44 px (was just under 44 px wide)", () => {
  assert.match(css("src/app/(dashboard)/workouts/Workouts.module.css"), /^\.textLink \{[^}]*min-width: 44px;[^}]*min-height: 44px;/m);
  assert.match(source("src/app/(dashboard)/workouts/page.tsx"), /<Link href="\/workouts\/history" className=\{styles\.textLink\}>All<ArrowRight/);
});
