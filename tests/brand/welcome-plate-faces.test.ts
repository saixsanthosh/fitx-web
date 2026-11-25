import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BARBELL } from "@/components/brand/intro/dimensions";
import { createBarbell, PLATE_BODY, PLATE_FACES } from "@/components/brand/intro/sets/props/barbell";
import type { BarbellPlate, BarbellProp, IntroSet } from "@/components/brand/intro/sets/types";
import { resetWelcomeProps, restoreBarbell, welcomePlates, welcomeProps, WELCOME_PLATES } from "@/components/brand/intro/films/welcome/props";

// D14 (review finding spec:welcome-dre-plate-label): in "The Forge" each loaded plate's face reads its own weight, as
// film-welcome's design has them (Maya's 20 kg, 450 mm; Leo's 10 kg, 350 mm; Dre's 5 kg, 260 mm). Dre's plate is the
// gym barbell's second 20 kg coral bumper scaled down, so it wears its own face: the coral artwork reading 5 KG, on a
// clone of the bumper's material, with nothing else in the picture changed. Built on the real barbell, drawn on
// canvases that record what is painted on them (node has no canvas).

type Call = unknown[];
type RecordingCanvas = { width: number; height: number; calls: Call[]; getContext(kind: string): unknown };

/** A canvas whose 2D context records every call and every property set, in order. */
function recordingCanvas(): RecordingCanvas {
  const calls: Call[] = [];
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_, name) =>
      name === "createImageData"
        ? (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
        : (...args: unknown[]) => void calls.push([String(name), ...args]),
    set: (_, name, value) => {
      calls.push([`${String(name)} =`, value]);
      return true;
    },
  });
  return { width: 0, height: 0, calls, getContext: (kind: string) => (kind === "2d" ? context : null) };
}

/** The real barbell and the welcome props on a stand-in gym set, staged as at a shot's `enter`. */
function staged() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const before = globals.document;
  globals.document = {
    createElement(tag: string) {
      assert.equal(tag, "canvas");
      return recordingCanvas();
    },
  };
  try {
    const barbell = createBarbell();
    const gym = { group: new THREE.Group() } as unknown as IntroSet;
    const welcome = welcomeProps(gym, "dark");
    resetWelcomeProps(welcome, barbell);
    return { barbell, welcome };
  } finally {
    globals.document = before;
  }
}

const body = (plate: BarbellPlate) => {
  const mesh = plate.object.getObjectByName(PLATE_BODY) as THREE.Mesh | undefined;
  assert.ok(mesh?.isMesh, "every plate has its rubber body");
  return mesh;
};
const materialOf = (plate: BarbellPlate) => body(plate).material as THREE.MeshStandardMaterial;

/** What a plate material's face says and how it is drawn (its colour and height artwork). */
function faceOf(material: THREE.MeshStandardMaterial) {
  const colour = material.map?.image as RecordingCanvas | undefined;
  const height = material.bumpMap?.image as RecordingCanvas | undefined;
  assert.ok(colour?.calls && height?.calls, "a face has colour and height artwork");
  const texts = colour.calls.filter(([name]) => name === "fillText").map(([, text]) => text);
  return { texts, colour, height };
}

/** An object's own settings, without its identity and the keys given. */
const settings = (object: object, without: readonly string[]) =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !["uuid", "version", ...without].includes(key)));

/** The barbell plate on the -X sleeve matching +X plate `index`: never in the welcome film, so it keeps its own face. */
const twin = (barbell: BarbellProp, index: number) => barbell.plates.right[index];

test("the three plates read the design's weights: Maya's 20 KG, Leo's 10 KG, Dre's 5 KG, each with the bumper's small line", () => {
  assert.deepEqual(
    WELCOME_PLATES.map((plate) => [plate.owner, plate.diameter, plate.face]),
    [["maya", 0.45, "20 KG"], ["leo", 0.35, "10 KG"], ["dre", 0.26, "5 KG"]],
  );
  const { barbell } = staged();
  welcomePlates(barbell).forEach((plate, index) => {
    const { owner, face } = WELCOME_PLATES[index];
    const { texts } = faceOf(materialOf(plate));
    // At 12 and at 6 o'clock, so it reads from either side of the bar.
    assert.deepEqual(texts, [face, "OLYMPIC BUMPER", face, "OLYMPIC BUMPER"], `${owner}'s plate`);
  });
  // The barbell's own faces, which Maya's and Leo's plates keep.
  assert.deepEqual([PLATE_FACES.coral.text, PLATE_FACES.graphite.text], ["20 KG", "10 KG"]);
  assert.deepEqual([PLATE_FACES.coral.small, PLATE_FACES.graphite.small], ["OLYMPIC BUMPER", "OLYMPIC BUMPER"]);
  assert.deepEqual(WELCOME_PLATES.map((plate) => BARBELL.plates[plate.index].color), ["coral", "graphite", "coral"]);
});

test("Dre's face is the coral bumper's own artwork with 5 KG for 20 KG, on a clone of its material; nothing else changes", () => {
  const { barbell } = staged();
  const [maya, leo, dre] = welcomePlates(barbell);
  const coral = materialOf(maya);
  const five = materialOf(dre);
  // Maya's and Leo's plates keep the barbell's own materials (the same objects as on the plates the film never shows).
  assert.equal(coral, materialOf(twin(barbell, WELCOME_PLATES[0].index)));
  assert.equal(materialOf(leo), materialOf(twin(barbell, WELCOME_PLATES[1].index)));
  assert.equal(materialOf(twin(barbell, WELCOME_PLATES[2].index)), coral, "Dre's barbell plate itself wears the coral face");
  assert.notEqual(five, coral, "Dre's plate wears a material of its own");
  assert.notEqual(five.map, coral.map);
  assert.notEqual(five.bumpMap, coral.bumpMap);

  // The same artwork, call for call (base, ring, lettering, sizes and places), with only the weight changed.
  const swap = (calls: Call[]) => calls.map((call) => call.map((part) => (part === "20 KG" ? "5 KG" : part)));
  const own = faceOf(coral);
  const its = faceOf(five);
  assert.deepEqual([its.colour.width, its.colour.height, its.height.width, its.height.height], [own.colour.width, own.colour.height, own.height.width, own.height.height]);
  assert.deepEqual(its.colour.calls, swap(own.colour.calls), "the colour artwork");
  assert.deepEqual(its.height.calls, swap(own.height.calls), "the height (raised lettering and rims)");
  assert.ok(own.colour.calls.some((call) => call[0] === "fillStyle =" && call[1] === PLATE_FACES.coral.base), "the coral base colour");

  // A clone: every setting of the coral material and of its two textures, only the artwork new.
  assert.equal(five.type, coral.type);
  assert.deepEqual(settings(five, ["map", "bumpMap"]), settings(coral, ["map", "bumpMap"]));
  assert.ok(five.map && coral.map && five.bumpMap && coral.bumpMap);
  assert.deepEqual(settings(five.map, ["source"]), settings(coral.map, ["source"]));
  assert.deepEqual(settings(five.bumpMap, ["source"]), settings(coral.bumpMap, ["source"]));
  assert.notEqual(five.map.source, coral.map.source, "the coral bumpers' own artwork is not redrawn");
  assert.deepEqual(faceOf(coral).texts, ["20 KG", "OLYMPIC BUMPER", "20 KG", "OLYMPIC BUMPER"]);

  // The geometry and size: the coral bumper's own body and hub, scaled to 260 mm exactly as before.
  assert.equal(body(dre).geometry, body(maya).geometry, "the 20 kg bumper's body (one shared geometry)");
  assert.equal(body(dre).geometry, body(twin(barbell, WELCOME_PLATES[2].index)).geometry);
  const spec = WELCOME_PLATES[2];
  const base = BARBELL.plates[spec.index];
  assert.deepEqual(dre.object.scale.toArray(), [spec.thickness / base.thickness, spec.diameter / base.diameter, spec.diameter / base.diameter]);
  const hub = (plate: BarbellPlate) => plate.object.children.find((child) => child !== body(plate)) as THREE.Mesh;
  assert.equal(hub(dre).material, hub(maya).material, "the steel hub unchanged");
});

test("one clone for the whole film, disposed with the welcome props; the barbell's own faces are never disposed or redrawn", () => {
  const { barbell, welcome } = staged();
  const [maya, , dre] = welcomePlates(barbell);
  const coral = materialOf(maya);
  const five = materialOf(dre);
  // Every shot's enter stages the bar again: the same clone each time, no new artwork.
  resetWelcomeProps(welcome, barbell);
  resetWelcomeProps(welcome, barbell);
  assert.equal(materialOf(dre), five);

  const disposed: string[] = [];
  const watch = (item: THREE.Material | THREE.Texture | null, name: string) => {
    assert.ok(item);
    item.addEventListener("dispose", () => disposed.push(name));
  };
  watch(five, "5 KG material");
  watch(five.map, "5 KG colour");
  watch(five.bumpMap, "5 KG height");
  watch(coral, "coral material");
  watch(coral.map, "coral colour");
  watch(coral.bumpMap, "coral height");
  welcome.dispose();
  assert.deepEqual(disposed.sort(), ["5 KG colour", "5 KG height", "5 KG material"]);
  assert.equal(materialOf(dre), coral, "no plate is left wearing a disposed face");
});

test("restoreBarbell gives Dre's barbell plate back its own size and face", () => {
  const { barbell } = staged();
  const [maya, , dre] = welcomePlates(barbell);
  assert.notEqual(materialOf(dre), materialOf(maya));
  restoreBarbell(barbell);
  assert.equal(materialOf(dre), materialOf(maya), "the coral bumper's own material");
  assert.deepEqual(dre.object.scale.toArray(), [1, 1, 1]);
});
