/**
 * Render-quality tiers for the intro film (main thread).
 *
 * The tier is chosen once at start-up from the GPU, the device class and the viewport, and the
 * director's frame-time guard may step it down once with `downgradeQuality`. Every tier keeps
 * the same material/shader variants (only buffer sizes, sample counts and optional passes
 * change), so a downgrade never recompiles scene shaders.
 */

import type * as THREE from "three";
import type { QualityTier } from "../types";

export interface QualitySettings {
  tier: QualityTier;
  /** Drawing-buffer pixels per CSS pixel, already clamped to the tier's pixel budget (may be < 1 on huge viewports). */
  dpr: number;
  /** MSAA samples on the HDR scene target (0 = off). Clamped to the GPU's MAX_SAMPLES. */
  msaa: number;
  /** Sun shadow-map resolution (square). */
  shadowMapSize: number;
  bloom: boolean;
  /** Depth of field (half-resolution bokeh gather). High tier only. */
  dof: boolean;
  /** Multiplier on particle counts, 0..1. */
  particleScale: number;
}

export interface QualityViewport {
  /** CSS pixels. */
  width: number;
  height: number;
  devicePixelRatio: number;
}

/** GPU classes from the (unmasked) renderer string. */
type GpuClass = "workstation" | "discrete" | "integrated" | "weak" | "mobile" | "unknown";

interface TierProfile {
  tier: QualityTier;
  maxDpr: number;
  /** Max drawing-buffer pixels; DPR is lowered on big viewports to stay inside it. */
  pixelBudget: number;
  msaa: number;
  shadowMapSize: number;
  dof: boolean;
  particleScale: number;
}

const PROFILES: Record<"highPro" | "high" | "highIntegrated" | "medium" | "mediumPhone", TierProfile> = {
  // Pro/Max-class GPUs, ~3.1 MP: 1440x900 @1.5, 1920x1080 @1.22, 2560x1440 @0.85.
  highPro: { tier: "high", maxDpr: 1.5, pixelBudget: 3.1e6, msaa: 4, shadowMapSize: 2048, dof: true, particleScale: 1 },
  // Base Apple silicon and unknown desktop GPUs, ~2.4 MP: 1440x900 @1.29, 1920x1080 @1.08.
  high: { tier: "high", maxDpr: 1.5, pixelBudget: 2.4e6, msaa: 4, shadowMapSize: 2048, dof: true, particleScale: 1 },
  // Laptop iGPUs that are fine for the film but not at Retina density (Iris Xe, Radeon APUs).
  highIntegrated: { tier: "high", maxDpr: 1.25, pixelBudget: 2.1e6, msaa: 4, shadowMapSize: 2048, dof: true, particleScale: 0.85 },
  medium: { tier: "medium", maxDpr: 1, pixelBudget: 1.15e6, msaa: 2, shadowMapSize: 1024, dof: false, particleScale: 0.6 },
  mediumPhone: { tier: "medium", maxDpr: 1, pixelBudget: 1.0e6, msaa: 2, shadowMapSize: 1024, dof: false, particleScale: 0.6 },
};

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer|microsoft basic render|mesa offscreen|gdi generic|virgl/i;
const MOBILE_GPU = /mali|adreno|powervr|immortalis|xclipse|videocore|apple a\d|sgx/i;
const STRONG_INTEL = /iris\(r\) xe|iris xe|\barc\b|arc\(tm\)/i;
const APU_GPU = /radeon\(tm\) graphics|radeon graphics|radeon vega|vega \d+ graphics|radeon\(tm\) \d{3}m/i;
const WORKSTATION_GPU = /apple m\d+ (pro|max|ultra)|geforce rtx|nvidia rtx|quadro|radeon rx [5-9]\d{3}|radeon pro w/i;
const DISCRETE_GPU = /nvidia|geforce|rtx|quadro|radeon rx|radeon pro|radeon\(tm\) rx|apple m\d|apple gpu/i;
const WEAK_DESKTOP = /intel|geforce (gt|mx)\s?\d|geforce \d{3}m|radeon r[2-7]\b|radeon hd/i;

interface NavigatorHints {
  userAgentData?: { mobile?: boolean };
  deviceMemory?: number;
  connection?: { effectiveType?: string; saveData?: boolean };
}

function rendererString(gl: WebGL2RenderingContext): string {
  try {
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      const unmasked = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
      if (typeof unmasked === "string" && unmasked.length > 0) return unmasked;
    }
    // Firefox (and privacy modes) expose a sanitised name through RENDERER instead.
    const masked = gl.getParameter(gl.RENDERER);
    return typeof masked === "string" ? masked : "";
  } catch {
    return "";
  }
}

function classifyGpu(name: string, mobileDevice: boolean): GpuClass {
  if (!name) return "unknown";
  if (MOBILE_GPU.test(name) || (mobileDevice && /apple gpu/i.test(name))) return "mobile";
  if (/intel/i.test(name)) return STRONG_INTEL.test(name) ? "integrated" : "weak";
  if (APU_GPU.test(name)) return "integrated";
  if (WEAK_DESKTOP.test(name)) return "weak";
  if (WORKSTATION_GPU.test(name)) return "workstation";
  if (DISCRETE_GPU.test(name)) return "discrete";
  return "unknown";
}

function isAppleMobile(nav: Navigator) {
  const ua = nav.userAgent ?? "";
  // iPadOS reports a desktop Safari UA; touch points give it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

function isMobileDevice(nav: Navigator & NavigatorHints) {
  const ua = nav.userAgent ?? "";
  return nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || isAppleMobile(nav);
}

/**
 * A second, throwaway context created with `failIfMajorPerformanceCaveat` fails on software
 * fallbacks even when the renderer string is masked. Only used when the name is unknown.
 */
function hasPerformanceCaveat(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const probe = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!probe) return true;
    probe.getExtension("WEBGL_lose_context")?.loseContext();
    return false;
  } catch {
    return false;
  }
}

function settingsFor(profile: TierProfile, viewport: QualityViewport, maxSamples: number, maxTexture: number): QualitySettings {
  const cssPixels = Math.max(1, viewport.width * viewport.height);
  const budgetDpr = Math.sqrt(profile.pixelBudget / cssPixels);
  const dpr = Math.max(0.5, Math.min(viewport.devicePixelRatio || 1, profile.maxDpr, budgetDpr));
  return {
    tier: profile.tier,
    dpr: Math.round(dpr * 100) / 100,
    msaa: Math.max(0, Math.min(profile.msaa, maxSamples)),
    shadowMapSize: Math.min(profile.shadowMapSize, maxTexture),
    bloom: true,
    dof: profile.dof,
    particleScale: profile.particleScale,
  };
}

/**
 * Picks the quality tier, or returns `null` when the film should not run at all (the overlay
 * then shows the static brand): no WebGL2 / float render targets, software rasterisers
 * (SwiftShader, llvmpipe, ...), ≤ 2 GB device memory, ≤ 2 CPU cores (not on iOS, which always
 * reports 2), Save-Data or 2G networks.
 */
export function detectQuality(renderer: THREE.WebGLRenderer, viewport: QualityViewport): QualitySettings | null {
  const gl = renderer.getContext();
  if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) return null;
  if (gl.isContextLost()) return null;
  // HDR targets (HalfFloat, MSAA) need float colour buffers.
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return null;

  const nav = (typeof navigator !== "undefined" ? navigator : undefined) as (Navigator & NavigatorHints) | undefined;
  if (nav) {
    if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) return null;
    // WebKit on iOS/iPadOS caps the reported core count at 2 (fingerprinting), so it is no signal there.
    if (!isAppleMobile(nav) && typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) return null;
    const connection = nav.connection;
    if (connection?.saveData === true) return null;
    if (connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return null;
  }

  const name = rendererString(gl);
  if (SOFTWARE_RENDERER.test(name)) return null;
  const mobile = nav ? isMobileDevice(nav) : false;
  let gpu = classifyGpu(name, mobile);
  if (gpu === "unknown" && hasPerformanceCaveat()) return null;

  const maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0;
  const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048;
  if (maxTexture < 2048) return null;

  if (mobile) return settingsFor(PROFILES.mediumPhone, viewport, maxSamples, maxTexture);

  const memory = nav?.deviceMemory;
  const cores = nav?.hardwareConcurrency ?? 8;
  if (gpu === "unknown") gpu = cores >= 8 && (memory === undefined || memory >= 8) ? "discrete" : "integrated";
  // Few cores or little memory usually means a thin-and-light laptop whatever the GPU says.
  if ((gpu === "discrete" || gpu === "workstation") && (cores <= 4 || (memory !== undefined && memory <= 4))) gpu = "integrated";

  switch (gpu) {
    case "workstation":
      return settingsFor(PROFILES.highPro, viewport, maxSamples, maxTexture);
    case "discrete":
      return settingsFor(PROFILES.high, viewport, maxSamples, maxTexture);
    case "integrated":
      return settingsFor(cores <= 4 ? PROFILES.medium : PROFILES.highIntegrated, viewport, maxSamples, maxTexture);
    default:
      return settingsFor(PROFILES.medium, viewport, maxSamples, maxTexture);
  }
}

/** Settings for a forced tier (lab pages, `?tier=` overrides, tests). */
export function qualityForTier(tier: QualityTier, viewport: QualityViewport, maxSamples = 4): QualitySettings {
  return settingsFor(tier === "high" ? PROFILES.high : PROFILES.medium, viewport, maxSamples, 8192);
}

/**
 * One step cheaper, for the director's frame-time guard: high → medium (no DOF, ≤ 2× MSAA,
 * 1024 shadows, DPR ≤ 1), then medium → reduced medium (¾ DPR, no MSAA, fewer particles).
 * Returns `null` when already at the floor.
 */
export function downgradeQuality(settings: QualitySettings): QualitySettings | null {
  const round = (value: number) => Math.round(value * 100) / 100;
  if (settings.tier === "high") {
    return {
      tier: "medium",
      dpr: round(Math.max(0.5, Math.min(1, settings.dpr * 0.8))),
      msaa: Math.min(settings.msaa, 2),
      shadowMapSize: Math.min(settings.shadowMapSize, 1024),
      bloom: settings.bloom,
      dof: false,
      particleScale: Math.min(settings.particleScale, 0.6),
    };
  }
  if (settings.dpr > 0.55 || settings.msaa > 0) {
    return {
      ...settings,
      dpr: round(Math.max(0.5, settings.dpr * 0.75)),
      msaa: 0,
      shadowMapSize: Math.min(settings.shadowMapSize, 1024),
      dof: false,
      particleScale: Math.min(settings.particleScale, 0.4),
    };
  }
  return null;
}
