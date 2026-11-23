import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FILM_DEFS,
  FILM_IDS,
  checkFilmDef,
  describeFilm,
  filmFinalStageStart,
  filmShotIndexAt,
  filmStageAt,
} from "@/components/brand/intro/director/film-defs";
import { LAB_QUALITY, fitQualityToGpu } from "@/components/brand/intro/fx/quality";
import { FILM_DURATION, SHOTS, STAGE, STAGE_START, stageAt } from "@/components/brand/intro/timeline";
import { WELCOME_DURATION, WELCOME_STAGE_START } from "@/components/brand/intro/films/welcome/timeline";

const ROOT = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The intro's clock as a film: today's timeline, the shape `INTRO_FILM` builds from `SHOTS`. */
const introTiming = {
  duration: FILM_DURATION,
  stageStart: STAGE_START,
  sets: ["any"],
  cast: [] as string[],
  shots: SHOTS.map((shot) => ({ id: shot.id, start: shot.start, end: shot.end, set: "any", cast: [] as string[] })),
};

test("the registry lists exactly the two films, each loaded on demand", () => {
  assert.deepEqual([...FILM_IDS].sort(), ["intro", "welcome"]);
  for (const id of FILM_IDS) assert.equal(typeof FILM_DEFS[id], "function", id);
  const registry = source("src/components/brand/intro/director/film-defs.ts");
  assert.match(registry, /import\("\.\/intro-def"\)/);
  assert.match(registry, /import\("\.\.\/films\/welcome\/def"\)/);
  assert.doesNotMatch(registry, /^import [^t].*from "\.\.\/films\/welcome/m, "the registry never imports a welcome file statically");
});

test("the welcome film: six shots with their cast on the C0 timeline, all five compositions, plain-JSON description", async () => {
  const welcome = await FILM_DEFS.welcome();
  assert.equal(welcome.id, "welcome");
  assert.equal(welcome.duration, WELCOME_DURATION);
  assert.equal(welcome.duration, 12);
  assert.deepEqual([...welcome.stageStart], [...WELCOME_STAGE_START]);
  assert.equal(welcome.shots.length, 6);
  assert.deepEqual([welcome.shots[0].start, welcome.shots[welcome.shots.length - 1].end], [0, 12]);
  assert.deepEqual([...welcome.shots[0].cast], [], "the opening shot needs nobody");
  assert.deepEqual([...welcome.cast], ["maya", "leo", "dre"]);
  assert.deepEqual([...welcome.comps], ["phone", "tablet-p", "tablet-l", "laptop", "desktop"]);
  assert.deepEqual(checkFilmDef(welcome), []);
  const described = describeFilm(welcome);
  assert.deepEqual(JSON.parse(JSON.stringify(described)), described, "the description is plain JSON");
  assert.ok(described.shots.every((shot) => shot.subjects), "every shot has framing subjects");
});

test("the intro's clock passes the definition check, and the helpers agree with timeline.ts", () => {
  assert.deepEqual(checkFilmDef(introTiming), []);
  for (let frame = 0; frame <= 715; frame += 1) {
    const time = frame / 60;
    assert.equal(filmStageAt(introTiming, time), stageAt(time), `stage at ${time}`);
    const index = filmShotIndexAt(introTiming, time);
    assert.ok(time >= SHOTS[index].start && (time < SHOTS[index].end || index === SHOTS.length - 1), `shot at ${time}`);
  }
  assert.equal(filmFinalStageStart(introTiming), STAGE_START[STAGE.brand]);
  assert.equal(filmShotIndexAt(introTiming, -1), 0);
  assert.equal(filmShotIndexAt(introTiming, 99), SHOTS.length - 1);
});

test("the definition check names gaps, overlaps, undeclared sets and cast, and stages out of order", () => {
  const broken = {
    duration: 3,
    stageStart: [0, 2, 1.5],
    sets: ["studio"],
    cast: ["maya"],
    shots: [
      { id: "a", start: 0, end: 1, set: "studio", cast: ["maya"] },
      { id: "b", start: 1.2, end: 2, set: "gym", cast: ["dre"] },
      { id: "b", start: 2, end: 2.5, set: "studio", cast: [] },
    ],
  };
  const problems = checkFilmDef(broken).join("\n");
  assert.match(problems, /b starts at 1\.2, not 1/);
  assert.match(problems, /undeclared set gym/);
  assert.match(problems, /undeclared character dre/);
  assert.match(problems, /stage 2 must start after stage 1/);
  assert.match(problems, /used twice/);
  assert.match(problems, /last shot ends at 2\.5, not at the duration 3/);
});

test("LAB_QUALITY pins MSAA 4, 2048 shadows, DOF, every particle and dpr 1, clamped only to the GPU", () => {
  assert.deepEqual({ ...LAB_QUALITY }, { tier: "high", dpr: 1, msaa: 4, shadowMapSize: 2048, bloom: true, dof: true, particleScale: 1 });
  assert.ok(Object.isFrozen(LAB_QUALITY));
  assert.equal(fitQualityToGpu(LAB_QUALITY, 8, 16384).msaa, 4);
  assert.deepEqual(fitQualityToGpu(LAB_QUALITY, 2, 1024), { ...LAB_QUALITY, msaa: 2, shadowMapSize: 1024 });
});

test("the director takes pinned quality whatever the tier, a fixed size and onFrame, and throws on a cast-less lab frame", () => {
  const director = source("src/components/brand/intro/director/director.ts");
  // The pinned settings come first and never depend on the detected tier (the old override needed a different tier).
  assert.match(director, /const chosen: QualitySettings = options\.quality\s*\?\s*fitQualityToGpu\(options\.quality/);
  assert.match(director, /options\.size\?\.width \?\? window\.innerWidth/);
  assert.match(director, /options\.onFrame\?\.\(\{ time, shot: shot\.id, rendered: false, castReady: false \}\)/);
  assert.match(director, /if \(options\.lab\) throw new Error/);
  // project() in the lab reads each shot's subjects() with the camera that rendered the frame.
  assert.match(director, /labSubjects\(\) \{\s*if \(!lastRendered \|\| !ctx\) return null;/);
  assert.match(director, /export function createIntroDirector\(options: DirectorOptions\): IntroDirector \{\s*return createFilmDirector\(INTRO_FILM, options\);/);
  const shotTypes = source("src/components/brand/intro/director/shot-types.ts");
  assert.match(shotTypes, /composition: FilmComposition;/);
  assert.match(shotTypes, /subjects\?\(ctx: ShotContext, frame: ShotFrame\): readonly SubjectBox\[\];/);
  for (const act of ["act1-track", "act2-gym", "act3-finale"]) {
    const name = `ACT${act[3]}_LAB`;
    assert.match(source(`src/components/brand/intro/director/shots/${act}.ts`), new RegExp(`export const ${name} = \\{`), name);
  }
});
