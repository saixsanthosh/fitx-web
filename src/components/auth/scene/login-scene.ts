/**
 * The sign-in page's live scene (main thread, three.js): Dre, the FITX film's lifter, on the platform of the film's
 * gym, working a slow set of deadlifts. The camera orbits him with the phone's tilt or the pointer, and between reps
 * he looks up at you. Everything is borrowed from the film (src/components/brand/intro): the athlete is generated
 * procedurally in a worker, the gym, the barbell, the light rig, the post chain and the grades are the film's own,
 * so the sign-in and the film are one world. Light theme: sunrise through the gym windows; dark: moonlight and
 * tungsten.
 *
 * The page shows a still frame of this scene until `onReady`; any failure (no WebGL2, a weak GPU, a worker or
 * generation error, a lost context or a sustained low frame rate) calls `onUnsupported` once and the still stays.
 */

import * as THREE from "three";
import { assembleCharacter, type CharacterInstance } from "@/components/brand/intro/character/assemble";
import { loadCharacter, releaseCharacterWorkers } from "@/components/brand/intro/character/client";
import { createCharacterMaterials, disposeCharacterMaterials } from "@/components/brand/intro/character/materials";
import { applyCameraState, createCameraState } from "@/components/brand/intro/director/camera";
import { createPost, GRADES, type IntroPost } from "@/components/brand/intro/fx/post";
import { detectQuality, downgradeQuality, type QualitySettings } from "@/components/brand/intro/fx/quality";
import { applyLightingPreset, createLightRig, type LightRig } from "@/components/brand/intro/lighting";
import { applyBreath, applyHeadLook, blinkAmount, poseLift } from "@/components/brand/intro/motion";
import { createBarbell, createGymSet, type BarbellProp, type IntroSet } from "@/components/brand/intro/sets";
import type { Theme } from "@/components/brand/intro/types";
import { follow, idleDrift, liftTimeAt, lookWeightAt, medianFrame, SLOW_FRAME, STILL_SECONDS, type Look } from "./scene-math";

export type LoginSceneCallbacks = {
  /** The first frame is on the canvas. */
  onReady: () => void;
  /** The scene cannot run here (called at most once; the still frame stays). */
  onUnsupported: (reason: string) => void;
};

export interface LoginScene {
  /** Where the viewer is looking from (tilt or pointer), -1 to 1 on each axis; null hands back to the idle drift. */
  setLook(look: Look | null): void;
  setTheme(theme: Theme): void;
  /** Starts or stops the render loop (off screen, hidden tab, the pause button). */
  setRunning(running: boolean): void;
  resize(): void;
  dispose(): void;
}

/** Framing for a wide band (phones, tablets) and a tall panel (laptops): set space, metres, focal length in mm. */
const SHOTS = {
  wide: { position: new THREE.Vector3(2.1, 0.85, 4.3), target: new THREE.Vector3(-0.55, 1.0, 0), focal: 30 },
  tall: { position: new THREE.Vector3(1.25, 0.55, 3.6), target: new THREE.Vector3(0.05, 0.98, 0), focal: 33 },
} as const;
/** How far the viewer's look swings the camera round Dre (radians) and up or down (metres). */
const ORBIT = { yaw: 0.36, rise: 0.38, push: 0.18 } as const;

const DEV = process.env.NODE_ENV !== "production";

export function createLoginScene(host: HTMLElement, initialTheme: Theme, callbacks: LoginSceneCallbacks): LoginScene {
  let theme = initialTheme;
  let disposed = false;
  let failed = false;
  let running = false;
  let ready = false;
  let raf = 0;
  let last = 0;
  // Start on the still frame's moment so the fade from the still to the live scene shows no jump.
  let clock = STILL_SECONDS;
  /** Seconds actually rendered live (the frame-rate guard waits out the first one). */
  let liveSeconds = 0;
  let look: Look | null = null;
  const eased = { x: 0, y: 0 };
  let samples: number[] = [];
  let downgraded = false;

  let renderer: THREE.WebGLRenderer | null = null;
  let quality: QualitySettings | null = null;
  let post: IntroPost | null = null;
  let lights: LightRig | null = null;
  let gym: IntroSet | null = null;
  let barbell: BarbellProp | null = null;
  let dre: CharacterInstance | null = null;
  let materials: ReturnType<typeof createCharacterMaterials> | null = null;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
  const state = createCameraState();
  const platform = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const orbit = new THREE.Vector3();
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0";

  const fail = (reason: string) => {
    if (failed || disposed) return;
    failed = true;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (DEV) console.warn("[FITX sign-in scene] showing the still frame:", reason);
    callbacks.onUnsupported(reason);
  };

  const size = () => {
    const rect = host.getBoundingClientRect();
    return { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)), devicePixelRatio: window.devicePixelRatio || 1 };
  };

  const frame = (dt: number) => {
    if (!renderer || !post || !lights || !gym || !barbell || !dre) return;
    const { width, height } = size();
    const aspect = width / height;
    const shot = aspect < 1.15 ? SHOTS.tall : SHOTS.wide;

    // The viewer's look, eased, or the idle drift.
    const goal = look ?? idleDrift(clock);
    eased.x = follow(eased.x, goal.x, dt, look ? 0.16 : 0.6);
    eased.y = follow(eased.y, goal.y, dt, look ? 0.16 : 0.6);

    // Dre's set, his breath and blinks; the bar follows his hands.
    const t = liftTimeAt(clock);
    const lift = poseLift(dre.rig, t);
    dre.setHandPose("L", lift.hands.L);
    dre.setHandPose("R", lift.hands.R);
    applyBreath(dre.rig, clock, 0.6, { phase: 0.4 });
    barbell.group.position.set(platform.x, platform.y + lift.bar.y, platform.z + lift.bar.z);
    barbell.setBend(lift.barBend);

    // Camera: orbit round the platform with the look, a touch closer when you lean in.
    orbit.copy(shot.position).sub(shot.target);
    orbit.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -eased.x * ORBIT.yaw);
    orbit.multiplyScalar(1 - ORBIT.push * Math.max(0, eased.y) * 0.5);
    state.position.copy(shot.target).add(orbit).add(platform);
    state.position.y += eased.y * ORBIT.rise;
    state.target.copy(shot.target).add(platform);
    state.target.y += eased.y * 0.08;
    state.focal = shot.focal * (aspect < 0.8 ? 0.86 : 1);
    state.roll = -eased.x * 0.012;
    applyCameraState(camera, state, aspect);

    // Between reps he looks at you (the camera), a little ahead of where you are moving.
    dre.group.updateMatrixWorld(true);
    lookTarget.copy(state.position);
    lookTarget.x += eased.x * 0.4;
    applyHeadLook(dre.rig, lookTarget, lookWeightAt(t), { maxYaw: 0.9, maxPitch: 0.45 });
    dre.face.setBlink(blinkAmount(clock, 23));
    dre.face.setGaze(lookWeightAt(t) > 0.3 ? lookTarget : null);

    gym.update(clock);
    post.setFocus(camera.position.distanceTo(dre.rig.bones.chest.getWorldPosition(orbit)), quality?.dof ? 3.2 : 0);
    post.render(dt, clock);
  };

  const guard = (dt: number) => {
    // Stalled or throttled frames (a background tab, a hidden pane, the dt cap) say nothing about the GPU.
    if (!quality || liveSeconds < 1.2 || dt <= 0 || dt >= 0.095 || document.visibilityState !== "visible") return;
    samples.push(dt);
    if (samples.length > 45) samples.shift();
    if (samples.length < 30) return;
    const median = medianFrame(samples);
    if (!downgraded && median > SLOW_FRAME.downgrade) {
      const next = downgradeQuality(quality);
      downgraded = true;
      samples = [];
      if (!next || !post) return fail("frame rate");
      quality = next;
      post.applyQuality(next);
      const { width, height } = size();
      post.setSize(width, height, next.dpr);
    } else if (downgraded && median > SLOW_FRAME.stop) {
      fail("frame rate");
    }
  };

  const tick = (now: number) => {
    raf = 0;
    if (!running || disposed || failed) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    clock += dt;
    liveSeconds += dt;
    try {
      frame(dt);
    } catch (error) {
      fail(error instanceof Error ? error.message : "frame error");
      return;
    }
    guard(dt);
    if (!failed) raf = requestAnimationFrame(tick);
  };

  const applyTheme = () => {
    if (!gym || !lights || !renderer || !post) return;
    gym.applyTheme(theme);
    scene.environment = gym.environment;
    applyLightingPreset(lights, gym.lighting("hero"), scene, renderer);
    post.setGrade(theme === "light" ? GRADES.gymDay : GRADES.gymNight);
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    fail("WebGL context lost");
  };

  const start = async () => {
    // The athlete is generated in a worker while the gym builds here.
    const dreData = loadCharacter("dre");
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
    } catch {
      return fail("no WebGL");
    }
    canvas.addEventListener("webglcontextlost", onContextLost);
    const viewport = size();
    quality = detectQuality(renderer, viewport);
    if (!quality) return fail("device below the scene's requirements");
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    lights = createLightRig({ shadowMapSize: quality.shadowMapSize });
    scene.add(lights.group);

    // Yield between the heavy steps so typing in the form stays responsive.
    await idle();
    if (disposed) return;
    const t0 = performance.now();
    gym = createGymSet(renderer, theme, { quality: quality.tier });
    const tGym = performance.now();
    scene.add(gym.group);
    const anchor = gym.anchors.platform;
    anchor.updateWorldMatrix(true, false);
    anchor.getWorldPosition(platform);
    barbell = createBarbell();
    gym.group.add(barbell.group);
    await idle();
    if (disposed) return;
    const tPost0 = performance.now();
    post = createPost(renderer, scene, camera, quality);
    post.setSize(viewport.width, viewport.height, quality.dpr);
    materials = createCharacterMaterials();
    applyTheme();
    const tPost = performance.now();

    let data: Awaited<typeof dreData>;
    try {
      data = await dreData;
    } catch (error) {
      return fail(error instanceof Error ? error.message : "the athlete could not be generated");
    }
    if (disposed) return;
    const tAssemble0 = performance.now();
    dre = assembleCharacter(data, materials);
    dre.group.position.copy(platform);
    scene.add(dre.group);
    releaseCharacterWorkers();
    const tAssemble = performance.now();
    await idle();
    if (disposed) return;
    const tCompile0 = performance.now();
    try {
      await post.compile();
    } catch {
      // A failed warm-up only costs a stall on the first frame.
    }
    if (disposed || failed) return;
    try {
      frame(0);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "first frame");
    }
    if (DEV) {
      const ms = (a: number, b: number) => Math.round(b - a);
      console.info(`[FITX sign-in scene] gym ${ms(t0, tGym)} ms, post ${ms(tPost0, tPost)} ms, assemble ${ms(tAssemble0, tAssemble)} ms, compile ${ms(tCompile0, performance.now())} ms, ready at ${Math.round(performance.now())} ms, tier ${quality.tier}`);
    }
    canvas.style.transition = "opacity 900ms cubic-bezier(0.22, 1, 0.36, 1)";
    canvas.style.opacity = "1";
    ready = true;
    callbacks.onReady();
    if (running && !raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  if (DEV) {
    // Development only (stripped from production builds): render one exact frame, used to make the still frames
    // in public/media/login/ from this very scene.
    (window as Window & { __fitxLoginScene?: { freeze(seconds: number): boolean } }).__fitxLoginScene = {
      freeze(seconds) {
        if (!ready) return false;
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        clock = seconds;
        look = { x: 0, y: 0 };
        eased.x = 0;
        eased.y = 0;
        post?.setSize(size().width, size().height, quality?.dpr ?? 1);
        frame(0);
        return true;
      },
    };
  }

  host.appendChild(canvas);
  start().catch((error: unknown) => fail(error instanceof Error ? error.message : "start failed"));

  return {
    setLook(next) {
      look = next;
    },
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      try {
        applyTheme();
        if (ready && !running) frame(0);
      } catch (error) {
        fail(error instanceof Error ? error.message : "theme");
      }
    },
    setRunning(next) {
      running = next;
      if (!next) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      if (ready && !raf && !failed && !disposed) {
        last = 0;
        samples = [];
        raf = requestAnimationFrame(tick);
      }
    },
    resize() {
      if (!post || !quality) return;
      const { width, height } = size();
      post.setSize(width, height, quality.dpr);
      if (ready && !running) {
        try {
          frame(0);
        } catch {
          // The next running frame reports it.
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      dre?.dispose();
      barbell?.dispose();
      if (gym) {
        gym.group.removeFromParent();
        gym.dispose();
      }
      post?.dispose();
      lights?.sun.shadow.map?.dispose();
      scene.clear();
      if (materials) disposeCharacterMaterials();
      releaseCharacterWorkers();
      renderer?.dispose();
      renderer?.forceContextLoss();
      canvas.remove();
    },
  };
}

/** Resolves on an idle moment (or within 120 ms), so heavy set-up steps never sit between two keystrokes. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 120 });
    else window.setTimeout(resolve, 16);
  });
}
