// The quote library (src/data/quotes.ts): enough for a year without repeats, honest about authorship, and every
// quote matched to a moving scene that exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { QUOTES, QUOTE_THEMES, THEME_SCENES, quoteById } from "@/data/quotes";
import { HOMESCENES_MEDIA } from "@/data/home-scenes-media";
import { SCENES, sceneFor } from "@/lib/home/scenes";

test("at least 366 quotes, so a member sees a different one every day for a year", () => {
  assert.ok(QUOTES.length >= 366, `only ${QUOTES.length}`);
});

test("ids are unique and stable in form, and no line appears twice", () => {
  assert.equal(new Set(QUOTES.map((quote) => quote.id)).size, QUOTES.length);
  for (const quote of QUOTES) assert.match(quote.id, /^[a-z]{3}-\d{3}$/);
  const normal = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  assert.equal(new Set(QUOTES.map((quote) => normal(quote.text))).size, QUOTES.length);
});

test("a quote credited to a person names its source; FITX's own lines name nobody", () => {
  for (const quote of QUOTES) {
    if (quote.author !== null) assert.ok(quote.source && quote.source.trim(), `${quote.id} needs a source`);
    else assert.equal(quote.source, null, `${quote.id} has a source but no author`);
  }
});

test("lines are short enough to read over a moving picture, with typographic apostrophes", () => {
  for (const quote of QUOTES) {
    assert.ok(quote.text.length >= 10 && quote.text.length <= 120, `${quote.id} is ${quote.text.length} characters`);
    assert.doesNotMatch(quote.text, /['"]/, `${quote.id} uses a straight quote mark`);
    assert.equal(quote.text, quote.text.trim());
  }
});

test("every theme is well stocked and every scene is a real, generated still", () => {
  for (const theme of QUOTE_THEMES) assert.ok(QUOTES.filter((quote) => quote.theme === theme).length >= 50, theme);
  for (const quote of QUOTES) {
    assert.ok(quote.scene in HOMESCENES_MEDIA, `${quote.id} names scene ${quote.scene}`);
    assert.ok((THEME_SCENES[quote.theme] as readonly string[]).includes(quote.scene), `${quote.id} scene does not match its mood`);
  }
  for (const id of Object.keys(HOMESCENES_MEDIA)) {
    assert.ok(id in SCENES, `${id} has no motion set`);
    assert.ok(existsSync(new URL(`../../public${HOMESCENES_MEDIA[id as keyof typeof HOMESCENES_MEDIA].src}`, import.meta.url)), id);
  }
  assert.equal(sceneFor("nonsense").id, "dawn-road");
  assert.equal(sceneFor("rain-track").motion, "rain");
});

test("the heavy bag stays whole in the phone crop, panning included", () => {
  // Home's stage on a 390 px phone is about 390 × 716; .camera is inset -6% (1.12 × the stage) and the still
  // covers it at its focus; the pan keyframes scale it by 1.08 and move it ±2.4% of its width.
  const { width, height } = HOMESCENES_MEDIA["heavy-bag"];
  const stage = { w: 390, h: 716 };
  const layer = { w: stage.w * 1.12, h: stage.h * 1.12 };
  const scale = Math.max(layer.w / width, layer.h / height);
  const focusX = Number.parseFloat(SCENES["heavy-bag"].focus) / 100;
  const imageLeft = -(width * scale - layer.w) * focusX; // the still's left edge, in layer pixels
  const visible = (shift: number) => {
    // Stage pixels 0 and 390 in layer pixels, undoing the camera's scale (about its centre) and shift.
    const toLayer = (x: number) => (x + (layer.w - stage.w) / 2 - layer.w / 2 - shift) / 1.08 + layer.w / 2;
    return [(toLayer(0) - imageLeft) / scale / width, (toLayer(stage.w) - imageLeft) / scale / width];
  };
  const bag = [598 / 1344, 722 / 1344]; // the bag's left and right edges in the still
  for (const shift of [-0.024 * layer.w, 0, 0.024 * layer.w]) {
    const [from, to] = visible(shift);
    assert.ok(from < bag[0] - 0.03 && to > bag[1] + 0.03, `bag at ${bag.map((x) => x.toFixed(3))} but the phone shows ${from.toFixed(3)}–${to.toFixed(3)}`);
  }
});

test("quoteById finds a quote and refuses unknown ids", () => {
  assert.equal(quoteById(QUOTES[5].id), QUOTES[5]);
  assert.equal(quoteById("zzz-999"), null);
  assert.equal(quoteById(null), null);
});
