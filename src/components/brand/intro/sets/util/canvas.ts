/**
 * Canvas helpers (main thread): text and simple drawn masks that are easier in 2D than in GLSL —
 * lane numerals, plate lettering, labels. System fonts only (no downloads).
 */

import * as THREE from "three";

/** Main-thread build profiling (ms per step), exposed as `IntroSet.timings`. */
export class Stopwatch {
  readonly timings: Record<string, number> = {};
  private last = performance.now();
  private readonly start = this.last;
  lap(name: string) {
    const now = performance.now();
    this.timings[name] = Math.round((now - this.last) * 10) / 10;
    this.last = now;
  }
  total() {
    this.timings.total = Math.round((performance.now() - this.start) * 10) / 10;
    return this.timings;
  }
}

export class Disposer {
  private readonly items = new Set<{ dispose(): void }>();
  track<T extends { dispose(): void }>(item: T): T {
    this.items.add(item);
    return item;
  }
  /** Tracks every geometry and material (and their textures) under `root`. */
  trackObject(root: THREE.Object3D) {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) this.track(mesh.geometry);
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) this.track(m);
    });
  }
  dispose() {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }
}

export function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
}

export function canvasTexture(canvas: HTMLCanvasElement, options: { srgb?: boolean; repeat?: boolean; anisotropy?: number } = {}): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const wrap = options.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.anisotropy = options.anisotropy ?? 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export const SANS = `"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif`;
export const CONDENSED = `"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif`;

/**
 * Lane numerals 1..lanes side by side, white on black (coverage in R), stretched tall like track
 * stencils. Linear colour space: it is a mask.
 */
export function numeralAtlas(lanes: number, cell = 256): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(cell * lanes, cell * 2);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let lane = 1; lane <= lanes; lane += 1) {
    ctx.save();
    ctx.translate(cell * (lane - 0.5), cell);
    ctx.scale(0.78, 1.55);
    ctx.font = `700 ${Math.round(cell * 0.98)}px ${SANS}`;
    ctx.fillText(String(lane), 0, cell * 0.04);
    ctx.restore();
  }
  return canvasTexture(canvas, { srgb: false, anisotropy: 8 });
}

/**
 * Bumper plate face artwork: base colour, "20 KG" style lettering at 12 and 6 o'clock, a thin ring
 * near the rim. Returns colour and height (raised lettering/rims) canvases.
 */
export function plateArtwork(size: number, options: { base: string; ink: string; text: string; small: string; ringInk: string }) {
  const colour = canvas2d(size, size);
  const height = canvas2d(size, size);
  const c = colour.ctx;
  const h = height.ctx;
  const mid = size / 2;
  c.fillStyle = options.base;
  c.fillRect(0, 0, size, size);
  h.fillStyle = "#000";
  h.fillRect(0, 0, size, size);

  // Raised outer rim and inner hub ring (height only; geometry carries the big lip).
  h.strokeStyle = "#fff";
  h.lineWidth = size * 0.012;
  h.beginPath();
  h.arc(mid, mid, size * 0.455, 0, Math.PI * 2);
  h.stroke();
  c.strokeStyle = options.ringInk;
  c.lineWidth = size * 0.006;
  c.beginPath();
  c.arc(mid, mid, size * 0.43, 0, Math.PI * 2);
  c.stroke();

  for (const flip of [0, 1]) {
    for (const ctx of [c, h]) {
      ctx.save();
      ctx.translate(mid, mid);
      ctx.rotate(flip * Math.PI);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = ctx === c ? options.ink : "#fff";
      ctx.font = `800 ${Math.round(size * 0.14)}px ${SANS}`;
      ctx.fillText(options.text, 0, -size * 0.31);
      ctx.font = `700 ${Math.round(size * 0.045)}px ${SANS}`;
      ctx.fillText(options.small, 0, -size * 0.225);
      ctx.restore();
    }
  }
  return { colour: colour.canvas, height: height.canvas };
}

/** Small printed label (jars, bottle) — text centred on a coloured band. */
export function labelCanvas(width: number, height: number, background: string, ink: string, text: string, sub?: string) {
  const { canvas, ctx } = canvas2d(width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(height * 0.32)}px ${SANS}`;
  ctx.fillText(text, width / 2, height * (sub ? 0.42 : 0.52));
  if (sub) {
    ctx.font = `500 ${Math.round(height * 0.16)}px ${SANS}`;
    ctx.fillText(sub, width / 2, height * 0.72);
  }
  return canvas;
}

/**
 * Blurred-spoke disc: a translucent veil (denser towards the hub, where spokes converge) with faint
 * radial streaks. White RGB; coverage in alpha. Disc fills the canvas (radius = size / 2).
 */
export function spokeBlurCanvas(size: number, innerFrac: number, seed: number) {
  const { canvas, ctx } = canvas2d(size, size);
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const outer = size / 2 - 1;
  const inner = outer * innerFrac;
  const grad = ctx.createRadialGradient(c, c, inner, c, c, outer);
  grad.addColorStop(0, "rgba(255,255,255,0.62)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.34)");
  grad.addColorStop(1, "rgba(255,255,255,0.2)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, outer, 0, Math.PI * 2);
  ctx.arc(c, c, inner, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  ctx.lineCap = "round";
  for (let i = 0; i < 160; i += 1) {
    const a = rnd() * Math.PI * 2;
    ctx.strokeStyle = `rgba(255,255,255,${(0.04 + rnd() * 0.08).toFixed(3)})`;
    ctx.lineWidth = 1 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
    ctx.lineTo(c + Math.cos(a) * outer, c + Math.sin(a) * outer);
    ctx.stroke();
  }
  return canvas;
}
