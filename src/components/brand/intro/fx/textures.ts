/**
 * Procedural textures for the FX (main thread, canvas-generated; no downloads).
 * Cached module-level so "Replay intro" reuses them. Disposing a cached texture only frees
 * its GPU copy — three re-uploads it from the canvas if it is used again.
 */

import * as THREE from "three";
import { createRng } from "../math";

/** Atlas layout shared by the sprite shaders: 2 × 2 cells. */
export const ATLAS_CELLS = 2;

export const PUFF_CELL = { puffA: 0, puffB: 1, puffC: 2, speck: 3 } as const;
export const FLARE_CELL = { glow: 0, ghost: 1, ring: 2, streak: 3 } as const;

let puffAtlas: THREE.CanvasTexture | null = null;
let flareAtlas: THREE.CanvasTexture | null = null;

function makeCanvas(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("FITX intro: 2D canvas unavailable");
  return { canvas, context };
}

function finishTexture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Soft billowing puffs (three lumpy variants) and a round speck. White RGB, density in alpha.
 * Each puff is a cluster of overlapping radial blobs masked to a round soft edge, so a few
 * hundred of them read as a volume rather than as discs.
 */
export function getPuffAtlas(): THREE.CanvasTexture {
  if (puffAtlas) return puffAtlas;
  const cell = 128;
  const { canvas, context } = makeCanvas(cell * ATLAS_CELLS);
  const rng = createRng(7031);
  for (let index = 0; index < 4; index += 1) {
    const ox = (index % ATLAS_CELLS) * cell;
    const oy = Math.floor(index / ATLAS_CELLS) * cell;
    const cx = ox + cell / 2;
    const cy = oy + cell / 2;
    context.save();
    context.beginPath();
    context.rect(ox, oy, cell, cell);
    context.clip();
    if (index === PUFF_CELL.speck) {
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.5);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.25, "rgba(255,255,255,0.75)");
      gradient.addColorStop(0.55, "rgba(255,255,255,0.22)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(ox, oy, cell, cell);
    } else {
      // Many small, faint, irregular blobs (some stretched into wisps) read as a volume of
      // powder rather than a ball; a soft mask that starts falling early hides the outline.
      const blobs = 34 + index * 8;
      for (let b = 0; b < blobs; b += 1) {
        const angle = rng() * Math.PI * 2;
        const distance = Math.sqrt(-2 * Math.log(1 - rng() * 0.97)) * cell * 0.12;
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;
        const radius = Math.max(2, cell * (0.05 + 0.15 * rng()) * (1.1 - distance / (cell * 0.5)));
        const stretch = rng() < 0.3 ? 1.6 + rng() * 1.4 : 1;
        const alpha = 0.08 + 0.2 * rng();
        context.save();
        context.translate(x, y);
        context.rotate(rng() * Math.PI);
        context.scale(stretch, 1 / Math.sqrt(stretch));
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
        gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
        gradient.addColorStop(0.45, `rgba(255,255,255,${(alpha * 0.6).toFixed(3)})`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(-radius, -radius, radius * 2, radius * 2);
        context.restore();
      }
      // Round soft mask so no puff ever shows a square edge.
      context.globalCompositeOperation = "destination-in";
      const mask = context.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.5);
      mask.addColorStop(0, "rgba(255,255,255,1)");
      mask.addColorStop(0.35, "rgba(255,255,255,0.9)");
      mask.addColorStop(0.7, "rgba(255,255,255,0.4)");
      mask.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = mask;
      context.fillRect(ox, oy, cell, cell);
      context.globalCompositeOperation = "source-over";
    }
    context.restore();
  }
  puffAtlas = finishTexture(canvas, THREE.NoColorSpace);
  puffAtlas.name = "fx.puffAtlas";
  return puffAtlas;
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a regular hexagon of circumradius r (pointy sides left/right). */
function hexagonDistance(x: number, y: number, r: number) {
  const kx = -0.8660254;
  const ky = 0.5;
  const kz = 0.57735027;
  let px = Math.abs(x);
  let py = Math.abs(y);
  const dot = Math.min(kx * px + ky * py, 0);
  px -= 2 * dot * kx;
  py -= 2 * dot * ky;
  const inradius = r * 0.8660254;
  px -= Math.min(Math.max(px, -kz * inradius), kz * inradius);
  py -= inradius;
  return Math.hypot(px, py) * Math.sign(py);
}

/** Thin-film-like spectral tint for the halo ring, t in [-1, 1] across the ring width. */
function spectral(t: number): [number, number, number] {
  const r = smooth(-0.2, 0.7, t) * (1 - smooth(0.85, 1.05, t)) + 0.25;
  const g = Math.exp(-((t - 0.0) ** 2) / 0.22) + 0.15;
  const b = (1 - smooth(-0.7, 0.2, t)) * (1 - smooth(-1.05, -0.85, -t)) + 0.25;
  const max = Math.max(r, g, b);
  return [r / max, g / max, b / max];
}

/**
 * Lens-flare elements, computed per pixel (smooth, no aliasing): a hot core with a long
 * soft glow, a hexagonal aperture ghost with a slightly brighter rim, a faint spectral halo
 * ring and an anamorphic streak profile (stretched by its quad).
 */
export function getFlareAtlas(): THREE.CanvasTexture {
  if (flareAtlas) return flareAtlas;
  const cell = 128;
  const size = cell * ATLAS_CELLS;
  const { canvas, context } = makeCanvas(size);
  const image = context.createImageData(size, size);
  const data = image.data;
  for (let index = 0; index < 4; index += 1) {
    const ox = (index % ATLAS_CELLS) * cell;
    const oy = Math.floor(index / ATLAS_CELLS) * cell;
    for (let j = 0; j < cell; j += 1) {
      for (let i = 0; i < cell; i += 1) {
        const x = ((i + 0.5) / cell) * 2 - 1;
        const y = ((j + 0.5) / cell) * 2 - 1;
        const r = Math.hypot(x, y);
        let red = 1;
        let green = 1;
        let blue = 1;
        let alpha = 0;
        if (index === FLARE_CELL.glow) {
          alpha = (0.75 * Math.exp(-r * 16) + 0.22 * Math.exp(-r * 6) + 0.07 * Math.exp(-r * 2.6)) * (1 - smooth(0.82, 1, r));
        } else if (index === FLARE_CELL.ghost) {
          const d = hexagonDistance(x, y, 0.86);
          const body = smooth(0.06, -0.06, d);
          const rim = smooth(-0.3, -0.02, d);
          alpha = body * (0.42 + 0.58 * rim * rim) * (0.85 + 0.15 * (1 - r));
        } else if (index === FLARE_CELL.ring) {
          const t = (r - 0.78) / 0.11;
          alpha = Math.exp(-t * t * 2.2) * 0.9;
          [red, green, blue] = spectral(Math.max(-1, Math.min(1, t)));
        } else {
          const along = Math.abs(x);
          alpha = (0.7 * Math.exp(-along * 5.5) + 0.3 * Math.exp(-along * 1.8)) * Math.exp(-(y * y) / 0.045) * (1 - smooth(0.9, 1, along));
        }
        const offset = ((oy + j) * size + ox + i) * 4;
        data[offset] = Math.round(red * 255);
        data[offset + 1] = Math.round(green * 255);
        data[offset + 2] = Math.round(blue * 255);
        data[offset + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
      }
    }
  }
  context.putImageData(image, 0, 0);
  flareAtlas = finishTexture(canvas, THREE.SRGBColorSpace);
  flareAtlas.name = "fx.flareAtlas";
  return flareAtlas;
}

/** Frees the GPU copies of the cached FX textures (they re-upload on next use). */
export function disposeFxTextures() {
  puffAtlas?.dispose();
  flareAtlas?.dispose();
}
