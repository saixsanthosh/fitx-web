/**
 * The film's post-processing chain (main thread), driven by three's EffectComposer:
 *
 *   ScenePass   scene → MSAA HDR target (R11G11B10F, resolved depth texture)
 *   Bloom       UnrealBloomPass mips: soft-knee prefilter, resolution-normalised, warm halation
 *   DOF         thin-lens CoC bokeh gather (high tier; skipped when aperture ≤ 0)
 *   Flare       sun flares from `createSunFlare` into a half-res HDR lens buffer, depth-occluded
 *   Output      source + bloom × strength + lens → grade exposure → AgX → sRGB
 *   Film        display-space grade, CA, whip blur, vignette, grain, flash, fade → canvas
 *
 * Passes hand the current HDR image along by reference (`PostFrame.source`) instead of
 * copying it, and bloom/flares are added inside the output transform, so the only
 * full-resolution passes are DOF (when on), output and film. Shader variants never change
 * between shots: optional passes are toggled with `enabled`, quality changes only resize or
 * re-sample buffers.
 */

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { Pass } from "three/addons/postprocessing/Pass.js";
import { compileSunFlares, hasSunFlares, renderSunFlares } from "./flare";
import { GRADES, mixGrades, NEUTRAL_GRADE, type GradeName, type GradeParams, type GradeRGB } from "./grades";
import { FilmBloomPass } from "./passes/bloomPass";
import { DofPass } from "./passes/dofPass";
import { FilmPass } from "./passes/filmPass";
import { FilmOutputPass } from "./passes/outputPass";
import { ScenePass, type PostFrame } from "./passes/scenePass";
import type { QualitySettings } from "./quality";

export { GRADES, mixGrades, NEUTRAL_GRADE };
export type { GradeName, GradeParams, GradeRGB };

/**
 * Tone mapping for the whole film. AgX: highlights (sun, coral light bar, floodlights)
 * roll off toward white like film instead of skewing yellow and clipping as ACES does, and
 * skin stays natural. The grades add back the contrast and saturation AgX's neutral base
 * leaves out (S-curve ≈ 1.2–1.4, saturation ≈ 1.1–1.2).
 */
export const FILM_TONE_MAPPING: THREE.ToneMapping = THREE.AgXToneMapping;

export interface IntroPost {
  /** Renders a frame. `time` (seconds, film clock) makes grain a pure function of time — pass it for seekable output; otherwise the clock advances by `dt`. */
  render(dt: number, time?: number): void;
  /** CSS size and render pixel ratio. Sets the renderer's pixel ratio and drawing-buffer size (not the canvas CSS size) and resizes every target. */
  setSize(width: number, height: number, dpr: number): void;
  setGrade(grade: GradeParams): void;
  /** Focus distance (m along the view axis), aperture as an f-number (f/N; ≤ 0 disables DOF), max blur radius in frame heights (default 0.02, max 0.05). No-op on tiers without DOF. */
  setFocus(distance: number, aperture: number, maxBlur?: number): void;
  /** Directional blur: `direction` (frame heights, x right / y up) × `amount`. Feed `whipBlurVector(...)` with amount 1. */
  setWhip(direction: [number, number], amount: number): void;
  /** Additive display-space flash, sRGB hex, amount 0..∞ (1 adds the full colour). */
  setFlash(color: number, amount: number): void;
  /** Cross to a flat sRGB colour (exact at 1, no grain/dither): use the theme background for the brand hold. */
  setFade(color: number, amount: number): void;
  readonly settings: QualitySettings;
  /** Applies a different quality (e.g. from `downgradeQuality`) in place, without recompiling shaders. */
  applyQuality(settings: QualitySettings): void;
  /** Compiles scene materials against the HDR target state and warms every post shader. Await before the first frame. */
  compile(): Promise<void>;
  /** Compiles one late-arriving object (e.g. a character generated after `compile`) against the HDR target state. */
  compileObject(object: THREE.Object3D): Promise<unknown>;
  /** The current grade (copy). */
  readonly grade: GradeParams;
  /** Resolved scene depth (for effects that need it). */
  readonly depthTexture: THREE.DepthTexture;
  readonly composer: EffectComposer;
  dispose(): void;
}

export interface PostOptions {
  /** Override the tone mapping operator (lab comparisons). */
  toneMapping?: THREE.ToneMapping;
  /** Scene HDR format. Default "r11g11b10f": half the MSAA bandwidth of "rgba16f", no visible banding after grain/dither. */
  sceneFormat?: "rgba16f" | "r11g11b10f";
}

/** Draws registered sun flares into a half-resolution HDR lens buffer read by the output pass. */
class FlarePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  aspect = 1;
  drawn = false;
  private readonly savedClear = new THREE.Color();

  private readonly scene: THREE.Object3D;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly depth: () => THREE.DepthTexture;

  constructor(scene: THREE.Object3D, camera: THREE.PerspectiveCamera, depth: () => THREE.DepthTexture) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.depth = depth;
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    this.target.texture.name = "IntroPost.lens";
  }

  override setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
    this.aspect = width / Math.max(1, height);
  }

  override render(renderer: THREE.WebGLRenderer) {
    renderer.getClearColor(this.savedClear);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setClearColor(this.savedClear, clearAlpha);
    this.drawn = renderSunFlares(renderer, this.scene, this.camera, this.depth(), this.target, this.aspect) > 0;
  }

  override dispose() {
    this.target.dispose();
  }
}

const cloneGrade = (grade: GradeParams): GradeParams => ({
  ...grade,
  lift: [...grade.lift] as GradeRGB,
  gamma: [...grade.gamma] as GradeRGB,
  gain: [...grade.gain] as GradeRGB,
  shadowTint: [...grade.shadowTint] as GradeRGB,
  highlightTint: [...grade.highlightTint] as GradeRGB,
});

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, settings: QualitySettings, options: PostOptions = {}): IntroPost {
  renderer.toneMapping = options.toneMapping ?? FILM_TONE_MAPPING;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let quality: QualitySettings = { ...settings };
  const size = renderer.getSize(new THREE.Vector2());
  let width = Math.max(1, size.x);
  let height = Math.max(1, size.y);

  // Ping-pong buffers only carry the DOF composite and the display-referred image.
  const buffer = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  buffer.texture.name = "IntroPost.buffer";
  const composer = new EffectComposer(renderer, buffer);

  const frame: PostFrame = { source: null };
  const scenePass = new ScenePass(scene, camera, quality.msaa, frame, (options.sceneFormat ?? "r11g11b10f") === "r11g11b10f");
  const bloomPass = new FilmBloomPass(frame);
  const dofPass = new DofPass(camera, scenePass.depthTexture, frame);
  const flarePass = new FlarePass(scene, camera, () => scenePass.depthTexture);
  const outputPass = new FilmOutputPass(frame);
  const filmPass = new FilmPass();
  composer.addPass(scenePass);
  composer.addPass(bloomPass);
  composer.addPass(dofPass);
  composer.addPass(flarePass);
  composer.addPass(outputPass);
  composer.addPass(filmPass);
  outputPass.bloomTexture = bloomPass.texture;
  outputPass.lensTexture = flarePass.target.texture;
  outputPass.lensActive = () => flarePass.enabled && flarePass.drawn;

  let grade = cloneGrade(GRADES.trackSunrise);
  let focusEnabled = false;
  let filmTime = 0;
  let fadeHex = 0x000000;
  let fadeAmount = 0;
  const fadeClear = new THREE.Color();
  const savedClear = new THREE.Color();

  const applyGrade = (next: GradeParams) => {
    grade = cloneGrade(next);
    filmPass.setGrade(grade);
    bloomPass.radius = Math.max(0, Math.min(1, grade.bloomRadius));
    bloomPass.threshold = Math.max(0, grade.bloomThreshold);
    outputPass.exposureScale = 2 ** grade.exposure;
  };

  const resize = (cssWidth: number, cssHeight: number, dpr: number) => {
    width = Math.max(1, Math.round(cssWidth));
    height = Math.max(1, Math.round(cssHeight));
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    filmPass.setPixelRatio(dpr);
    // The bloom pass re-creates its mip targets on resize; re-link its output.
    outputPass.bloomTexture = bloomPass.texture;
  };

  applyGrade(grade);
  resize(width, height, quality.dpr);

  const updateEnabled = () => {
    bloomPass.enabled = quality.bloom && grade.bloomStrength > 0;
    outputPass.bloomStrength = bloomPass.enabled ? grade.bloomStrength : 0;
    dofPass.enabled = quality.dof && focusEnabled;
    flarePass.enabled = hasSunFlares(scene);
    flarePass.drawn = false;
  };

  return {
    render(dt, time) {
      filmTime = time ?? filmTime + dt;
      if (fadeAmount >= 1) {
        // Fully faded (the brand hold): the film pass would output exactly the fade colour with no
        // grain or dither, so skip the whole chain and clear the canvas to that colour instead. The
        // clear colour is set while the canvas is bound, so three converts it to the output space.
        renderer.getClearColor(savedClear);
        const savedAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(null);
        renderer.setClearColor(fadeClear.setHex(fadeHex), 1);
        renderer.clear(true, false, false);
        renderer.setClearColor(savedClear, savedAlpha);
        return;
      }
      filmPass.time = filmTime;
      updateEnabled();
      composer.render(dt);
    },
    setSize(cssWidth, cssHeight, dpr) {
      resize(cssWidth, cssHeight, dpr);
    },
    setGrade(next) {
      applyGrade(next);
    },
    setFocus(distance, aperture, maxBlur = 0.02) {
      focusEnabled = aperture > 0 && distance > 0;
      dofPass.focusDistance = Math.max(0.01, distance);
      dofPass.fStop = Math.max(0.5, aperture);
      dofPass.maxBlur = Math.max(0, Math.min(0.05, maxBlur));
    },
    setWhip(direction, amount) {
      filmPass.setWhip(direction[0] * amount, direction[1] * amount);
    },
    setFlash(color, amount) {
      filmPass.setFlash(color, amount);
    },
    setFade(color, amount) {
      fadeHex = color;
      fadeAmount = amount;
      filmPass.setFade(color, amount);
    },
    get settings() {
      return quality;
    },
    applyQuality(next) {
      quality = { ...next };
      scenePass.setSamples(quality.msaa);
      resize(width, height, quality.dpr);
    },
    async compile() {
      const previous = renderer.getRenderTarget();
      // Scene programs depend on the bound target (linear output, no tone mapping in RTs).
      renderer.setRenderTarget(scenePass.target);
      await renderer.compileAsync(scene, camera);
      compileSunFlares(renderer, camera);
      renderer.setRenderTarget(previous);
      // One frame through every optional pass compiles the post shaders.
      bloomPass.enabled = true;
      outputPass.bloomStrength = Math.max(grade.bloomStrength, 1e-3);
      dofPass.enabled = quality.dof;
      flarePass.enabled = true;
      composer.render(0);
      updateEnabled();
    },
    compileObject(object) {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(scenePass.target);
      // compileAsync builds every program synchronously before it starts waiting, so the
      // target only needs to be bound for the duration of this call.
      const pending = renderer.compileAsync(object, camera, scene);
      renderer.setRenderTarget(previous);
      return pending;
    },
    get grade() {
      return cloneGrade(grade);
    },
    get depthTexture() {
      return scenePass.depthTexture;
    },
    composer,
    dispose() {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}
