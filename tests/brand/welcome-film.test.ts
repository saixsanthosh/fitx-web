import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPOSITIONS } from "@/components/brand/films/compositions";
import { FITX_MARK_ENTRY, FITX_MARK_PATHS, FITX_MARK_SIZE } from "@/components/brand/logo/geometry";
import { checkFilmDef, FILM_DEFS } from "@/components/brand/intro/director/film-defs";
import { CAST_ORDER } from "@/components/brand/intro/character/cast";
import { PLATFORM } from "@/components/brand/intro/dimensions";
import {
  WELCOME_BEATS,
  WELCOME_DURATION,
  WELCOME_REVEAL_AT,
  WELCOME_SCORE_HITS,
  WELCOME_SHOTS,
  WELCOME_STAGE_START,
  welcomeShotAt,
} from "@/components/brand/intro/films/welcome/timeline";
import {
  CRANE_LIMITS,
  closestRevealRatio,
  framingFits,
  ignitionAt,
  MARK_BAR_LINE,
  MARK_BOX_METRES,
  MARK_FLOOR_BOUNDS,
  MARK_FLOOR_SCALE,
  MARK_FORMATION_MS,
  MARK_IGNITION,
  MARK_IGNITION_END,
  MARK_IGNITION_ORDER,
  MARK_PLATES,
  markOutline,
  markToFloor,
  outlineArea,
  parseMarkPath,
  revealMarkBox,
  revealMarkInFrame,
  topDownFraming,
} from "@/components/brand/intro/films/welcome/mark-floor";
import { BAR_CENTRE, BAR_Y, INLAY_TOP, PLATE_SEATS, SLEEVE_LENGTH, sleeveZ, WELCOME_PLATES } from "@/components/brand/intro/films/welcome/props";
import { LOADS, plateTravel } from "@/components/brand/intro/films/welcome/load-motion";
import { dreAction, igniteClear, stripLevel, WELCOME_BRAND_BG, WELCOME_LAB } from "@/components/brand/intro/films/welcome/shots";
import { GREETING_AT, GREETING_MAX_NAME, greetingName, welcomeGreeting } from "@/components/brand/films/welcome/overlay-plan";

const ROOT = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const near = (actual: number, expected: number, tolerance: number, message: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not within ${tolerance} of ${expected}`);

// ------------------------------------------------------------------------------------------------- timeline

test("every beat sits on a measured hit of score #5, inside its own shot and inside the 12.0 s film", () => {
  const beats = [...WELCOME_BEATS.flicker, WELCOME_BEATS.lightOn, ...WELCOME_BEATS.plateSeat, ...WELCOME_BEATS.settle, ...WELCOME_BEATS.craneHits, WELCOME_BEATS.reveal, WELCOME_BEATS.bloomPeak];
  for (const beat of beats) {
    assert.ok(WELCOME_SCORE_HITS.includes(beat), `${beat} is a measured hit`);
    assert.ok(beat > 0 && beat < WELCOME_DURATION, `${beat} is inside the film`);
  }
  assert.deepEqual(WELCOME_BEATS.flicker.map(welcomeShotAt), ["w0-light", "w0-light", "w0-light"]);
  assert.deepEqual(WELCOME_BEATS.plateSeat.map(welcomeShotAt), ["w1-maya", "w2-leo", "w3-dre"]);
  assert.ok(WELCOME_BEATS.craneHits.every((hit) => welcomeShotAt(hit) === "w4-crane"));
  assert.equal(WELCOME_BEATS.lightOn, WELCOME_STAGE_START[1], "the light holds on the cut to Maya");
  assert.equal(WELCOME_BEATS.reveal, WELCOME_REVEAL_AT);
  assert.equal(WELCOME_REVEAL_AT, WELCOME_STAGE_START[5]);
  WELCOME_BEATS.plateSeat.forEach((seat, index) => assert.ok(WELCOME_BEATS.settle[index] > seat, `settle ${index} after its seat`));
});

// ------------------------------------------------------------------------------------------------- the film definition

test("the welcome film: six shots on the C0 timeline, the gym set, the three athletes, all five compositions", async () => {
  const film = await FILM_DEFS.welcome();
  assert.equal(film.id, "welcome");
  assert.equal(film.duration, WELCOME_DURATION);
  assert.deepEqual([...film.stageStart], [...WELCOME_STAGE_START]);
  assert.deepEqual(film.shots.map((shot) => shot.id), WELCOME_SHOTS.map((shot) => shot.id));
  film.shots.forEach((shot, index) => {
    assert.equal(shot.start, WELCOME_SHOTS[index].start, `${shot.id} start`);
    assert.equal(shot.end, WELCOME_SHOTS[index].end, `${shot.id} end`);
    assert.equal(shot.set, "gym", `${shot.id} plays on the gym set`);
    assert.equal(typeof shot.subjects, "function", `${shot.id} has framing subjects`);
  });
  assert.deepEqual([...film.sets], ["gym"]);
  assert.deepEqual([...film.cast], [...CAST_ORDER]);
  assert.deepEqual([...film.comps], COMPOSITIONS.map((band) => band.id));
  assert.deepEqual(checkFilmDef(film), []);
  // The opening shot needs nobody, so the film starts while the athletes are still generating.
  assert.deepEqual([...film.shots[0].cast], []);
  assert.deepEqual(film.shots.slice(1, 4).map((shot) => [...shot.cast]), [["maya"], ["leo"], ["dre"]]);
});

test("the def stays node-safe and never imports the strip-only-unsafe modules", () => {
  for (const file of ["def.ts", "shots.ts", "props.ts", "load-motion.ts", "mark-floor.ts"]) {
    const text = source(`src/components/brand/intro/films/welcome/${file}`);
    assert.doesNotMatch(text, /from "\.\.\/\.\.\/motion"/, `${file}: not motion/index.ts`);
    assert.doesNotMatch(text, /from "\.\.\/\.\.\/fx\/post"/, `${file}: not fx/post.ts`);
    assert.doesNotMatch(text, /from "\.\.\/\.\.\/sets"/, `${file}: not sets/index.ts`);
    assert.doesNotMatch(text, /from "[^"]*shots\/common"/, `${file}: not the intro's shot helpers`);
  }
  const props = source("src/components/brand/intro/films/welcome/props.ts");
  assert.match(props, /SVGLoader\.createShapes/);
  assert.match(props, /new THREE\.ExtrudeGeometry/);
});

// ------------------------------------------------------------------------------------------------- the mark floor

test("the mark paths parse back to their pieces, each a closed outline with area", () => {
  assert.equal(MARK_IGNITION_ORDER.length, 10);
  for (const { id, d } of FITX_MARK_PATHS) {
    const commands = parseMarkPath(d);
    assert.equal(commands[0].kind, "M", id);
    assert.equal(commands[commands.length - 1].kind, "Z", id);
    const outline = markOutline(id);
    assert.ok(outline.length >= 4, id);
    assert.ok(Math.abs(outlineArea(outline)) > 500, `${id} has area`);
  }
  assert.throws(() => parseMarkPath("M0 0C1 1 2 2 3 3Z"), /unsupported/);
});

test("the mark floor fits the lifting platform, upright for a lens looking down with screen-up +X", () => {
  assert.equal(MARK_FLOOR_SCALE, 0.0042);
  assert.ok(MARK_FLOOR_BOUNDS.maxX - MARK_FLOOR_BOUNDS.minX < PLATFORM.width, "inside the platform's width (X)");
  assert.ok(MARK_FLOOR_BOUNDS.maxZ - MARK_FLOOR_BOUNDS.minZ < PLATFORM.depth, "inside the platform's depth (Z)");
  near(MARK_FLOOR_BOUNDS.minX + MARK_FLOOR_BOUNDS.maxX, 0, 1e-9, "centred on X");
  near(MARK_FLOOR_BOUNDS.minZ + MARK_FLOOR_BOUNDS.maxZ, 0, 1e-9, "centred on Z");
  // The top of the mark (small y) is +X, its right (large x) is +Z.
  assert.ok(markToFloor(300, 0).x > 0 && markToFloor(600, 300).z > 0);
  assert.equal(MARK_BOX_METRES, FITX_MARK_SIZE * MARK_FLOOR_SCALE);
  // The bar piece is the top bar of the F, along Z; the plates sit on its +Z end, stepping down in size.
  assert.ok(MARK_BAR_LINE.x > 0.85 && MARK_BAR_LINE.x < 1.0);
  assert.ok(MARK_BAR_LINE.z1 > MARK_BAR_LINE.z0);
  assert.deepEqual(MARK_PLATES.map((plate) => plate.id), ["plate-1", "plate-2", "plate-3"]);
  for (let index = 1; index < 3; index += 1) {
    assert.ok(MARK_PLATES[index].z > MARK_PLATES[index - 1].z, "plates run out along +Z");
    assert.ok(MARK_PLATES[index].height < MARK_PLATES[index - 1].height, "and get smaller");
  }
});

test("the loaded bar lies on the mark's bar line with its three plates over the mark's plates", () => {
  near(BAR_CENTRE.x, MARK_BAR_LINE.x, 1e-9, "the bar on the bar line");
  near(BAR_Y - INLAY_TOP, WELCOME_PLATES[0].diameter / 2, 1e-9, "plate 1 stands on the inlay");
  assert.deepEqual(WELCOME_PLATES.map((plate) => plate.owner), ["maya", "leo", "dre"]);
  const seatsZ = PLATE_SEATS.map(sleeveZ);
  const meanSeat = seatsZ.reduce((a, b) => a + b, 0) / 3;
  const meanMark = MARK_PLATES.reduce((a, plate) => a + plate.z, 0) / 3;
  near(meanSeat, meanMark, 1e-9, "the stack's middle on the mark plates' middle");
  seatsZ.forEach((z, index) => near(z, MARK_PLATES[index].z, 0.13, `plate ${index + 1} over its mark`));
  for (let index = 1; index < 3; index += 1) assert.ok(WELCOME_PLATES[index].diameter < WELCOME_PLATES[index - 1].diameter, "the stack steps down like the mark's");
  // Each plate starts hung on the sleeve tip (or rolling on to it) and seats inside the sleeve.
  (["maya", "leo", "dre"] as const).forEach((id, index) => {
    const spec = LOADS[id];
    const travel = spec.zSeat - spec.zStart;
    const startU = PLATE_SEATS[index] + travel;
    assert.ok(startU + WELCOME_PLATES[index].thickness / 2 <= SLEEVE_LENGTH + 1e-9, `${id}'s plate starts on the sleeve`);
    near(spec.height, BAR_Y, 1e-9, `${id} loads at the bar's height`);
  });
});

test("the plates travel smoothly into the seat, rebound once and stop; Maya's rolls without slipping", () => {
  for (const id of ["maya", "leo", "dre"] as const) {
    const spec = LOADS[id];
    assert.equal(plateTravel(spec, 0).z, spec.zStart);
    assert.equal(plateTravel(spec, spec.seat).z, spec.zSeat);
    assert.equal(plateTravel(spec, spec.seat + 2).z, spec.zSeat);
    let previous: number = spec.zStart;
    for (let t = spec.push; t <= spec.seat; t += 1 / 240) {
      const { z } = plateTravel(spec, t);
      assert.ok(z >= previous - 1e-12, `${id} never moves back during the push`);
      previous = z;
    }
    const rebound = Math.min(...Array.from({ length: 60 }, (_, i) => plateTravel(spec, spec.seat + i / 240).z));
    assert.ok(spec.zSeat - rebound <= spec.rebound + 1e-9 && spec.zSeat - rebound > 0, `${id} rebounds at most ${spec.rebound} m`);
  }
  const maya = LOADS.maya;
  const mid = plateTravel(maya, (maya.push + maya.seat) / 2);
  near(-mid.roll * maya.radius, mid.z - maya.zStart, 1e-9, "turn × radius = distance");
  assert.equal(plateTravel(LOADS.leo, 0.6).roll, 0);
});

test("the plates seat on the score's hits", () => {
  near(WELCOME_SHOTS[1].start + LOADS.maya.seat, WELCOME_BEATS.plateSeat[0], 1e-9, "Maya");
  near(WELCOME_SHOTS[2].start + LOADS.leo.seat, WELCOME_BEATS.plateSeat[1], 1e-9, "Leo");
  // Dre in slow motion: his clip's seat lands on 5.86 s of film time (one 60 fps frame).
  let film = WELCOME_SHOTS[3].start;
  while (dreAction(film - WELCOME_SHOTS[3].start) < LOADS.dre.seat) film += 1 / 600;
  near(film, WELCOME_BEATS.plateSeat[2], 1 / 60, "Dre");
  assert.ok(WELCOME_LAB.DRE_SLOW < 0.5, "slow motion");
});

test("the strip light is dark, stutters on the three opening hits and holds from the swell", () => {
  assert.equal(stripLevel(0), 0);
  assert.equal(stripLevel(0.2), 0);
  const peaks = WELCOME_BEATS.flicker.map((hit) => stripLevel(hit));
  assert.ok(peaks[0] > 0.3 && peaks[1] > peaks[0] && peaks[2] > peaks[1], `brighter each time: ${peaks}`);
  assert.ok(stripLevel(WELCOME_BEATS.flicker[0] + 0.2) < 0.15, "dark again between flashes");
  assert.ok(stripLevel(WELCOME_BEATS.lightOn) > 1);
  for (let t = WELCOME_BEATS.lightOn + 0.3; t < WELCOME_DURATION; t += 0.25) near(stripLevel(t), 1, 0.01, `on at ${t}`);
});

test("the floor lines ignite in the DOM mark's order and timing, the way each piece travels as it forms", () => {
  assert.deepEqual(MARK_IGNITION_ORDER, FITX_MARK_PATHS.map(({ id }) => id));
  const css = source("src/app/globals.css");
  for (const { id } of FITX_MARK_PATHS) {
    const rule = css.match(new RegExp(`\\.fitx-mark__piece--${id} \\{ --fitx-piece-at: (\\d+)ms; --fitx-piece-ms: (\\d+)ms; \\}`));
    assert.ok(rule, `globals.css times ${id}`);
    assert.deepEqual(MARK_FORMATION_MS[id], { at: Number(rule![1]), ms: Number(rule![2]) }, `${id} in step with globals.css`);
  }
  for (const ignition of MARK_IGNITION) {
    const entry = FITX_MARK_ENTRY[ignition.id];
    // The flame runs opposite to the entry offset: back on the floor through markToFloor's axes.
    const length = Math.hypot(entry.x, entry.y);
    near(ignition.direction.x, entry.y / length, 1e-9, `${ignition.id} x`);
    near(ignition.direction.z, -entry.x / length, 1e-9, `${ignition.id} z`);
    near(Math.hypot(ignition.direction.x, ignition.direction.z), 1, 1e-9, `${ignition.id} unit`);
    assert.equal(ignitionAt(ignition.id, WELCOME_REVEAL_AT + ignition.at - 0.001, WELCOME_REVEAL_AT), 0);
    assert.equal(ignitionAt(ignition.id, WELCOME_REVEAL_AT + ignition.at + ignition.duration, WELCOME_REVEAL_AT), 1);
  }
  near(MARK_IGNITION_END, 1.44, 1e-9, "the last plate finishes with the DOM formation (1.44 s)");
  assert.ok(WELCOME_REVEAL_AT + MARK_IGNITION_END < WELCOME_DURATION);
});

test("the reveal's mark box follows LogoReveal.module.css", () => {
  const css = source("src/components/brand/logo/LogoReveal.module.css");
  assert.match(css, /--reveal-size: clamp\(120px, 34vmin, 260px\);/);
  assert.match(css, /max-width: min\(70vw, 62vh\);/);
  assert.match(css, /gap: calc\(var\(--reveal-size\) \* \.1\);/);
  assert.match(css, /font-size: calc\(var\(--reveal-size\) \* \.26\);/);
  const phone = revealMarkBox(390, 844);
  near(phone.side, 132.6, 1e-9, "phone side");
  assert.ok(phone.cy < 422, "the mark sits above the middle (the wordmark is under it)");
  assert.equal(revealMarkBox(1920, 1080).side, 260);
  assert.equal(revealMarkBox(300, 300).side, 120);
  // A phone in landscape caps the box at 62% of the height only when that is smaller.
  assert.ok(revealMarkBox(852, 393).side <= 0.62 * 393);
  for (const band of COMPOSITIONS) {
    const box = revealMarkInFrame(band.id);
    assert.ok(box.size > 0.1 && box.size < 0.4, `${band.id} size ${box.size}`);
    near(box.cx, 0.5, 1e-9, `${band.id} centred across`);
    assert.ok(box.cy > 0.38 && box.cy < 0.5, `${band.id} a little above the middle: ${box.cy}`);
  }
});

test("the top-down framing lands the floor mark where the reveal's mark is, inside the room and the lens limits", () => {
  for (const band of COMPOSITIONS) {
    const reveal = revealMarkInFrame(band.id);
    const crane = topDownFraming(band.id, WELCOME_LAB.TOP_RATIO, WELCOME_LAB.TOP_HEIGHT);
    assert.ok(framingFits(crane), `${band.id}: the crane's end fits (${JSON.stringify(crane)})`);
    const ratio = closestRevealRatio(band.id);
    assert.ok(ratio >= 1 && ratio < WELCOME_LAB.TOP_RATIO, `${band.id}: the ignite shot rises closer to the reveal (${ratio})`);
    const end = topDownFraming(band.id, ratio, CRANE_LIMITS.maxHeight);
    assert.ok(framingFits(end), `${band.id}: the ignite shot's end fits`);
    // Where the mark's centre lands in the frame: (0.5 - frame-up offset) as a share of the height.
    const frameHeight = end.floor.maxX - end.floor.minX;
    near(0.5 + end.centre.x / frameHeight, reveal.cy, 1e-9, `${band.id}: the centres line up`);
    near(MARK_BOX_METRES / frameHeight, reveal.size * ratio, 1e-9, `${band.id}: the box is ${ratio}x the reveal's`);
    assert.ok(end.floor.maxX >= MARK_FLOOR_BOUNDS.maxX && end.floor.minX <= MARK_FLOOR_BOUNDS.minX, `${band.id}: the whole mark in frame (up and down)`);
    assert.ok(end.floor.maxZ >= MARK_FLOOR_BOUNDS.maxZ && end.floor.minZ <= MARK_FLOOR_BOUNDS.minZ, `${band.id}: the whole mark in frame (across)`);
  }
  assert.equal(closestRevealRatio("phone") <= 1.2, true, "a phone comes within 20% of the reveal");
});

test("the frame clears to the page's background by the time the reveal's mark has formed, and holds it", () => {
  assert.deepEqual(WELCOME_BRAND_BG, { light: 0xf7f7f4, dark: 0x151715 });
  const tokens = source("src/app/globals.css");
  assert.match(tokens, /--fitx-bg: #f7f7f4;/);
  assert.match(tokens, /--fitx-bg: #151715;/);
  assert.equal(igniteClear(WELCOME_REVEAL_AT), 0, "the lines are seen igniting first");
  assert.ok(igniteClear(WELCOME_REVEAL_AT + 0.6) < 0.1);
  assert.equal(igniteClear(WELCOME_REVEAL_AT + MARK_IGNITION_END + 0.2), 1);
  assert.equal(igniteClear(WELCOME_DURATION), 1, "the last frame is the page's background");
});

// ------------------------------------------------------------------------------------------------- the overlay

test("the greeting: the first name from the profile only, after the lockup has formed, nothing without a name", () => {
  assert.ok(GREETING_AT > WELCOME_REVEAL_AT + 1.5 && GREETING_AT < WELCOME_DURATION - 1, `greeting at ${GREETING_AT}`);
  assert.deepEqual(welcomeGreeting({ firstName: null, time: 11, held: false }), { text: null, visible: false });
  assert.deepEqual(welcomeGreeting({ firstName: "   ", time: 11, held: false }), { text: null, visible: false });
  assert.deepEqual(welcomeGreeting({ firstName: "Ravi", time: GREETING_AT - 0.01, held: false }), { text: "Welcome, Ravi", visible: false });
  assert.deepEqual(welcomeGreeting({ firstName: " Ravi ", time: GREETING_AT, held: false }), { text: "Welcome, Ravi", visible: true });
  assert.equal(welcomeGreeting({ firstName: "Ravi", time: 11.9, held: true }).visible, true, "a hold at the end keeps it up");
  assert.equal(welcomeGreeting({ firstName: "Ravi", time: Number.NaN, held: false }).visible, false);
  assert.equal(greetingName("Anne  Marie"), "Anne Marie");
  const long = greetingName("A".repeat(40))!;
  assert.equal(Array.from(long).length, GREETING_MAX_NAME);
  assert.ok(long.endsWith("…"));
});

test("the overlay renders only for the welcome film, never takes the pointer, and uses theme tokens", () => {
  const tsx = source("src/components/brand/films/welcome/WelcomeOverlay.tsx");
  assert.match(tsx, /export function WelcomeOverlay\(\{ film, time, held, firstName \}: FilmOverlayProps\)/);
  assert.match(tsx, /if \(film !== "welcome"\) return null;/);
  assert.match(tsx, /if \(!greeting\.text\) return null;/);
  assert.doesNotMatch(tsx, /import [^;]*LogoReveal/, "the reveal is WelcomeFilm's");
  const css = source("src/components/brand/films/welcome/WelcomeOverlay.module.css");
  assert.match(css, /pointer-events: none;/);
  assert.match(css, /color: var\(--fitx-text\);/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, "tokens only");
  // The integrator registered it (6.1b); WelcomeFilm draws it only in its film case, so no welcome manifest, no overlay
  // (tests/brand/welcome-film-runtime.test.ts).
  assert.match(source("src/components/brand/films/registry.ts"), /WELCOME_FILM_OVERLAY: ComponentType<FilmOverlayProps> \| null = WelcomeOverlay;/);
  assert.match(source("src/components/brand/films/cuts.generated.ts"), /welcome: null/);
});
