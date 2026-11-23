/**
 * The film's director (main thread): owns the renderer, the fixed light rig, the post chain,
 * the sets/props/effects and the cast, and plays the shot list in `timeline.ts`.
 *
 * Everything a shot shows is a pure function of film time, so the same code path serves
 * real-time playback and lab seeking. Failure at any point (no WebGL, weak GPU, lost context,
 * worker/generation errors, or a sustained low frame rate) calls `onUnsupported` exactly once and
 * the overlay falls back to the static brand.
 */

import * as THREE from "three";
import { pickComposition } from "../../films/compositions";
import { applyLightingPreset, createLightRig } from "../lighting";
import type { IntroCallbacks, QualityTier, Theme } from "../types";
import type { CharacterId } from "../character/types";
import { CAST } from "../character/cast";
import { loadCharacter, releaseCharacterWorkers } from "../character/client";
import { createCharacterMaterials, disposeCharacterMaterials } from "../character/materials";
import { assembleCharacter } from "../character/assemble";
import { detectQuality, downgradeQuality, fitQualityToGpu, qualityForTier, type QualitySettings } from "../fx/quality";
import { createPost, type GradeParams } from "../fx/post";
import { applyCameraState, isPortraitComposition } from "./camera";
import { buildStage, hideStage, type Stage } from "./stage-kit";
import type { FilmDef } from "./film-def";
import { filmFinalStageStart, filmShotIndexAt, filmStageAt } from "./film-defs";
import { INTRO_FILM } from "./intro-def";
import type { FilmContext, ShotFrame, SubjectBox } from "./shot-types";

export interface IntroDirector {
  setTheme(theme: Theme): void;
  /** Lab/dev: pause and render the exact frame at film time `time`. Resolves after it rendered. */
  seek(time: number): Promise<void>;
  play(): void;
  pause(): void;
  /** Resolves when the first shot can play (or rejects if the film is unsupported). */
  readonly ready: Promise<void>;
  /** Current film time in seconds. */
  readonly time: number;
  /** The settings the film renders with (null until the renderer exists). */
  readonly quality: QualitySettings | null;
  /**
   * Lab: the subjects of the last rendered frame (`ShotModule.subjects`, world space; null when its shot has none)
   * with the camera that rendered it, so the lab can project them. Null before the first frame.
   */
  labSubjects(): { shot: string; time: number; boxes: readonly SubjectBox[] | null; camera: THREE.PerspectiveCamera } | null;
  dispose(): void;
}

/** What `DirectorOptions.onFrame` receives after every frame the director tried to render. */
export type FilmFrameInfo = { time: number; shot: string; rendered: boolean; castReady: boolean };

export interface DirectorOptions {
  canvas: HTMLCanvasElement;
  theme: Theme;
  callbacks: IntroCallbacks;
  /** Start playing as soon as the first shot is ready (default true). */
  autoplay?: boolean;
  /** Force a tier instead of detecting one (lab). */
  tier?: QualityTier;
  /** Lab mode: never fall back for performance, keep going when seeking; a frame without its cast throws. */
  lab?: boolean;
  /**
   * Pinned render settings (the lab passes `LAB_QUALITY`). Applied whatever tier the device would get, clamped to
   * the GPU's limits; takes precedence over `tier`.
   */
  quality?: QualitySettings;
  /** Fixed render size in CSS pixels, in place of the window's (the lab renders exact frame sizes). */
  size?: { width: number; height: number };
  /** Called after every frame the director tried to render, in the same task as the render. */
  onFrame?(frame: FilmFrameInfo): void;
}

const DEV = process.env.NODE_ENV !== "production";
/** While a needed character is still generating, film time slows to this rate (a graceful slow-mo hold). */
const HOLD_RATE = 0.22;
/** If a hold lasts this long (wall seconds), jump straight to the brand. */
const HOLD_LIMIT = 2.4;
/** Median frame times (seconds) that trigger a downgrade (high tier) or the static fallback (medium tier). */
const SLOW_HIGH = 1 / 26;
const SLOW_MEDIUM = 1 / 21;

/** The intro film's director: `createFilmDirector` with the intro's definition (signature unchanged). */
export function createIntroDirector(options: DirectorOptions): IntroDirector {
  return createFilmDirector(INTRO_FILM, options);
}

/** Plays any `FilmDef` (film-def.ts). */
export function createFilmDirector(film: FilmDef, options: DirectorOptions): IntroDirector {
  const { canvas, callbacks } = options;
  const SHOT_LIST = film.shots;
  const FILM_DURATION = film.duration;
  const shotIndexAt = (time: number) => filmShotIndexAt(film, time);
  const castOrder = film.cast.filter((id): id is CharacterId => Object.prototype.hasOwnProperty.call(CAST, id));
  const autoplay = options.autoplay ?? true;
  let theme = options.theme;

  let disposed = false;
  let failed = false;
  let playing = false;
  let raf = 0;
  let previousNow = 0;
  let filmTime = 0;
  let activeShot = -1;
  let lastStage = -1;
  let readySent = false;
  let precompileStarted = false;
  let completeSent = false;
  let holdSeconds = 0;
  let frameSamples: number[] = [];
  let downgraded = false;
  let lastGrade: GradeParams | null = null;
  let lastRendered: { index: number; frame: ShotFrame } | null = null;

  let renderer: THREE.WebGLRenderer | null = null;
  let quality: QualitySettings | null = null;
  let stage: Stage | null = null;
  let ctx: FilmContext | null = null;
  const cast: FilmContext["cast"] = {};
  const listeners: Array<() => void> = [];
  // One promise per character that resolves once it is assembled (lab seeks wait on these).
  const arrived = new Map<CharacterId, { promise: Promise<void>; resolve: () => void }>();
  const arrival = (id: CharacterId) => {
    let entry = arrived.get(id);
    if (!entry) {
      let resolve: () => void = () => {};
      const promise = new Promise<void>((done) => (resolve = done));
      entry = { promise, resolve };
      arrived.set(id, entry);
    }
    return entry;
  };

  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Callers that only use callbacks must not see an unhandled rejection.
  ready.catch(() => {});

  const fail = (reason: string) => {
    if (failed || disposed) return;
    failed = true;
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (DEV) console.warn("[FITX intro] Falling back to the static brand:", reason);
    rejectReady(new Error(reason));
    callbacks.onUnsupported();
  };

  const viewport = () => ({
    width: Math.max(1, options.size?.width ?? window.innerWidth),
    height: Math.max(1, options.size?.height ?? window.innerHeight),
    devicePixelRatio: window.devicePixelRatio || 1,
  });

  const castReadyFor = (shotIndex: number) => SHOT_LIST[shotIndex].cast.every((id) => cast[id]);

  /** Renders the exact frame at film time `time`. */
  const renderAt = (time: number, dt: number) => {
    if (!ctx || !stage || !renderer) return;
    const shotIndex = shotIndexAt(time);
    const shot = SHOT_LIST[shotIndex];
    if (!castReadyFor(shotIndex)) {
      options.onFrame?.({ time, shot: shot.id, rendered: false, castReady: false });
      // The lab never skips a frame silently: a render without its cast would be a wrong frame in the master.
      if (options.lab) throw new Error(`lab frame at ${time.toFixed(4)} s (${shot.id}) has no cast yet`);
      return;
    }
    const def = shot;
    const { width, height } = viewport();
    const frame: ShotFrame = {
      time,
      local: time - def.start,
      duration: def.end - def.start,
      progress: Math.min(1, Math.max(0, (time - def.start) / (def.end - def.start))),
      aspect: width / height,
    };
    ctx.aspect = width / height;
    ctx.composition = pickComposition(width, height);
    // Staging follows the composition (not the raw aspect), so the live film stages what its cut does.
    ctx.portrait = isPortraitComposition(ctx.composition);

    if (shotIndex !== activeShot) {
      hideStage(stage, cast);
      const set = stage.sets[shot.set];
      set.group.visible = true;
      ctx.scene.environment = set.environment;
      shot.enter(ctx, frame);
      activeShot = shotIndex;
    }

    const view = shot.update(ctx, frame);
    stage.sets[shot.set].update(time);
    applyLightingPreset(ctx.lights, view.lighting, ctx.scene, renderer);
    if (view.grade !== lastGrade) {
      lastGrade = view.grade;
      ctx.post.setGrade(view.grade);
    }
    applyCameraState(ctx.camera, view.camera, frame.aspect);
    ctx.post.setFocus(view.focus.distance, view.focus.aperture, view.focus.maxBlur);
    ctx.post.setWhip(view.whip?.direction ?? [0, 0], view.whip?.amount ?? 0);
    ctx.post.setFlash(view.flash?.color ?? 0xffffff, view.flash?.amount ?? 0);
    ctx.post.setFade(view.fade?.color ?? 0x000000, view.fade?.amount ?? 0);
    // Passing film time keeps the grain a pure function of time (seekable, identical replays).
    ctx.post.render(dt, time);

    lastRendered = { index: shotIndex, frame };
    options.onFrame?.({ time, shot: shot.id, rendered: true, castReady: true });

    const nextStage = filmStageAt(film, time);
    if (nextStage !== lastStage) {
      lastStage = nextStage;
      callbacks.onStage(nextStage);
    }
  };

  /**
   * Renders like `renderAt` but turns any exception from shot, set or post code into the static
   * fallback: a thrown frame must never leave a frozen picture covering the page.
   */
  const safeRenderAt = (time: number, dt: number) => {
    try {
      renderAt(time, dt);
      return true;
    } catch (error) {
      fail(`frame error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const complete = () => {
    if (completeSent || failed || disposed) return;
    completeSent = true;
    playing = false;
    if (DEV && frameSamples.length) {
      const sorted = [...frameSamples].sort((a, b) => a - b);
      console.info(`[FITX intro] median ${(1 / sorted[Math.floor(sorted.length / 2)]).toFixed(0)} fps, tier ${quality?.tier}, DPR ${renderer?.getPixelRatio()}`);
    }
    callbacks.onComplete();
  };

  const guardFrameRate = (dt: number) => {
    if (options.lab || !quality || filmTime < 0.8 || dt <= 0) return;
    frameSamples.push(dt);
    if (frameSamples.length > 40) frameSamples.shift();
    if (frameSamples.length < 30) return;
    const median = [...frameSamples].sort((a, b) => a - b)[Math.floor(frameSamples.length / 2)];
    if (quality.tier === "high" && !downgraded && median > SLOW_HIGH) {
      downgraded = true;
      frameSamples = [];
      applyQuality(downgradeQuality(quality));
    } else if (median > SLOW_MEDIUM) {
      fail("render rate fell below the intro target");
    }
  };

  const applyQuality = (next: QualitySettings | null) => {
    if (!renderer || !ctx || !stage) return;
    if (!next) {
      fail("render rate fell below the intro target");
      return;
    }
    quality = next;
    ctx.quality = next;
    // In place: resizes targets and MSAA, never recompiles a shader.
    ctx.post.applyQuality(next);
    const sun = ctx.lights.sun;
    if (sun.shadow.mapSize.x !== next.shadowMapSize) {
      sun.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    stage.setParticleScale(next.particleScale / stage.particleScale);
  };

  const tick = (now: number) => {
    raf = 0;
    if (!playing || disposed || failed) return;
    const dt = previousNow ? Math.min((now - previousNow) / 1000, 0.1) : 0;
    previousNow = now;

    try {
      // Slow film time down (never freeze it) while a character for the next shot is still generating.
      const upcoming = shotIndexAt(Math.min(FILM_DURATION, filmTime + 0.12));
      let rate = 1;
      if (!castReadyFor(upcoming)) {
        rate = HOLD_RATE;
        holdSeconds += dt;
        if (holdSeconds > HOLD_LIMIT) {
          filmTime = Math.max(filmTime, filmFinalStageStart(film));
          holdSeconds = 0;
        }
      } else {
        holdSeconds = 0;
      }

      const next = Math.min(FILM_DURATION, filmTime + dt * rate);
      filmTime = castReadyFor(shotIndexAt(next)) ? next : filmTime;
      renderAt(filmTime, dt);
      if (rate === 1) guardFrameRate(dt);
    } catch (error) {
      fail(`frame error: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (failed || disposed) return;

    if (filmTime >= FILM_DURATION) {
      complete();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const play = () => {
    if (disposed || failed || completeSent || playing) return;
    playing = true;
    previousNow = 0;
    raf = requestAnimationFrame(tick);
  };

  const pause = () => {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const setTheme = (next: Theme) => {
    theme = next;
    if (!ctx || !stage) return;
    ctx.theme = next;
    try {
      stage.applyTheme(next);
    } catch (error) {
      fail(`theme error: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    activeShot = -1;
    if (!playing && readySent) safeRenderAt(filmTime, 0);
  };

  const onResize = () => {
    if (!renderer || !ctx || !quality || options.size) return;
    const { width, height } = viewport();
    ctx.post.setSize(width, height, quality.dpr);
    ctx.camera.aspect = width / height;
    ctx.camera.updateProjectionMatrix();
    activeShot = -1;
    if (!playing && readySent) safeRenderAt(filmTime, 0);
  };

  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      previousNow = 0;
    } else if (playing && !raf && !disposed && !failed) {
      previousNow = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    fail("WebGL context lost");
  };

  const addCharacter = (id: CharacterId, data: Awaited<ReturnType<typeof loadCharacter>>) => {
    if (disposed || !ctx || cast[id]) return;
    const instance = assembleCharacter(data, materials);
    ctx.scene.add(instance.group);
    cast[id] = instance;
    // Characters that arrive after the initial precompile may use material roles nobody used
    // yet (helmet plastic, lenses, belt leather). Compile them now, off the cut. `compile`
    // only visits visible objects; it runs synchronously inside `compileAsync`, so the group is
    // hidden again before any frame can render it.
    if (precompileStarted) {
      instance.group.visible = true;
      ctx.post.compileObject(instance.group).catch(() => {});
    }
    instance.group.visible = false;
    arrival(id).resolve();
  };

  let materials: ReturnType<typeof createCharacterMaterials>;

  const start = async () => {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
    } catch (error) {
      fail(error instanceof Error ? error.message : "WebGL unavailable");
      return;
    }
    canvas.addEventListener("webglcontextlost", onContextLost);
    listeners.push(() => canvas.removeEventListener("webglcontextlost", onContextLost));

    const detected = detectQuality(renderer, viewport());
    if (!detected) {
      fail("device below the intro's requirements");
      return;
    }
    // Lab/dev override: pinned settings first (always applied, clamped to the GPU), else a forced tier at the
    // detected viewport budget.
    const gl = renderer.getContext();
    const chosen: QualitySettings = options.quality
      ? fitQualityToGpu(options.quality, Number(gl.getParameter(0x8d57 /* MAX_SAMPLES (WebGL2) */)) || 0, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048)
      : options.tier && options.tier !== detected.tier
        ? qualityForTier(options.tier, viewport())
        : detected;
    quality = chosen;

    const { width, height } = viewport();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0);
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.02, 600);
    camera.filmGauge = 36;
    const lights = createLightRig({ shadowMapSize: quality.shadowMapSize });
    scene.add(lights.group);

    // Kick off character generation first: it runs in workers while we build everything else.
    const castPromises = Object.fromEntries(castOrder.map((id) => [id, loadCharacter(id)])) as Record<CharacterId, ReturnType<typeof loadCharacter>>;
    // loadCharacter only queues the pool's pump as a microtask: yield once so the workers boot and
    // Maya's request is posted now, overlapping generation with the (long, synchronous) stage build.
    await Promise.resolve();
    if (disposed || failed) return;

    materials = createCharacterMaterials();
    stage = buildStage(renderer, scene, theme, quality);
    const post = createPost(renderer, scene, camera, quality);
    post.setSize(width, height, quality.dpr);
    // Before any character can arrive: the late-compile path needs a context.
    ctx = {
      renderer, scene, camera, post, quality, lights, sets: stage.sets, props: stage.props, fx: stage.fx, cast, theme,
      portrait: isPortraitComposition(pickComposition(width, height)), aspect: width / height, composition: pickComposition(width, height),
    };

    for (const id of castOrder) {
      castPromises[id].then((data) => addCharacter(id, data)).catch((error: unknown) => {
        // Missing later characters only shorten the film (the hold jumps to the brand); a missing
        // opening character is fatal and handled below.
        if (DEV) console.warn(`[FITX intro] character ${id} failed`, error);
      });
    }

    // A film with a cast waits for its opening character (fatal if it fails); a film without one starts at once.
    if (castOrder.length > 0) {
      try {
        const first = await castPromises[castOrder[0]];
        if (disposed) return;
        addCharacter(castOrder[0], first);
      } catch (error) {
        fail(error instanceof Error ? error.message : "character generation failed");
        return;
      }
    }

    // Compile every shader variant up front so cuts never stall: show everything once, with an
    // environment map bound (program variants depend on it), against the post chain's HDR target.
    try {
      for (const set of Object.values(stage.sets)) set.group.visible = true;
      for (const instance of Object.values(cast)) if (instance) instance.group.visible = true;
      scene.environment = stage.sets.track.environment;
      stage.primeEffects(true);
      precompileStarted = true;
      await post.compile();
    } catch (error) {
      precompileStarted = true;
      if (DEV) console.warn("[FITX intro] shader precompile failed; continuing", error);
    }
    if (disposed || failed || !stage) return;
    stage.primeEffects(false);
    hideStage(stage, cast);

    filmTime = 0;
    activeShot = -1;
    if (!safeRenderAt(0, 0)) return;
    if (!readySent) {
      readySent = true;
      resolveReady();
      callbacks.onReady();
    }
    if (autoplay) play();
  };

  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  listeners.push(() => window.removeEventListener("resize", onResize));
  listeners.push(() => document.removeEventListener("visibilitychange", onVisibility));

  start().catch((error: unknown) => fail(error instanceof Error ? error.message : "intro start failed"));

  return {
    ready,
    get time() {
      return filmTime;
    },
    get quality() {
      return quality;
    },
    labSubjects() {
      if (!lastRendered || !ctx) return null;
      const shot = SHOT_LIST[lastRendered.index];
      return { shot: shot.id, time: lastRendered.frame.time, boxes: shot.subjects ? shot.subjects(ctx, lastRendered.frame) : null, camera: ctx.camera };
    },
    setTheme,
    play,
    pause,
    async seek(time: number) {
      await ready;
      pause();
      filmTime = Math.max(0, Math.min(FILM_DURATION, time));
      // Seeking ahead of generation: wait for this shot's cast (a failed character never resolves,
      // so cap the wait).
      const needed = SHOT_LIST[shotIndexAt(filmTime)].cast.map((id) => arrival(id as CharacterId).promise);
      await Promise.race([Promise.all(needed), new Promise((done) => setTimeout(done, 15000))]);
      activeShot = -1;
      // The lab hears about a frame that could not render (its seek rejects); playback falls back as before.
      if (options.lab) renderAt(filmTime, 0);
      else safeRenderAt(filmTime, 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      listeners.forEach((remove) => remove());
      for (const instance of Object.values(cast)) instance?.dispose();
      if (stage) stage.dispose();
      ctx?.post.dispose();
      if (ctx) {
        ctx.lights.sun.shadow.map?.dispose();
        ctx.scene.clear();
      }
      if (materials) disposeCharacterMaterials();
      // Let in-flight generation finish into the cache (instant replay, no wasted work on a dev
      // double-mount); the pool shuts itself down once idle.
      releaseCharacterWorkers();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = null;
      ctx = null;
      stage = null;
    },
  };
}
