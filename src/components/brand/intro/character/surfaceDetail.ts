/**
 * Procedural micro-detail tiles for the character materials (main thread). OWNER: surfaces.
 *
 * One small periodic RGBA8 tile per pattern, built once (deterministic, a few ms in all) and
 * sampled triplanar in the materials' detail patch (`materials.ts`):
 *   R, G  height slope along u / v (0.5 = flat), scaled by the tile's own max slope;
 *   B     roughness offset (0.5 = none);
 *   A     albedo multiplier (cavity: yarn gaps, pores, mesh holes), 1 = untouched.
 * Slopes rather than heights, so mipmaps average them correctly (a far tile flattens to the
 * plain surface instead of shimmering) and triplanar blending works on surface gradients.
 */

import * as THREE from "three";
import { createRng } from "../math";

export type DetailKind = "skin" | "knit" | "lycra" | "mesh" | "grain" | "leather" | "microfiber";

export interface DetailTile {
  texture: THREE.DataTexture;
  /** Tile edge length in meters (triplanar repeat). */
  size: number;
  /** Max |slope| stored in R/G (decode: (c * 2 − 1) * slope). */
  slope: number;
  /** Characteristic feature size (m): the normal detail fades once a pixel covers it. */
  feature: number;
  /** Feature size of the roughness breakup (m); it survives further away. */
  roughFeature: number;
}

/** Height/roughness/cavity fields of one tile before encoding (N×N, row-major, periodic). */
interface Fields {
  n: number;
  size: number;
  height: Float32Array;
  rough: Float32Array;
  cavity: Float32Array;
}

const TAU = Math.PI * 2;

function fields(n: number, size: number): Fields {
  const cavity = new Float32Array(n * n);
  cavity.fill(1);
  return { n, size, height: new Float32Array(n * n), rough: new Float32Array(n * n), cavity };
}

/** Periodic value noise in [-1, 1] with `cells` lattice cells across the tile (quintic fade). */
function periodicNoise(n: number, cells: number, seed: number): Float32Array {
  const rng = createRng(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng() * 2 - 1;
  const out = new Float32Array(n * n);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < n; y += 1) {
    const fy = (y / n) * cells;
    const y0 = Math.floor(fy), ty = fade(fy - y0);
    const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < n; x += 1) {
      const fx = (x / n) * cells;
      const x0 = Math.floor(fx), tx = fade(fx - x0);
      const c0 = x0 % cells, c1 = (x0 + 1) % cells;
      const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * tx;
      const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * tx;
      out[y * n + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/**
 * Adds a radial feature at tile coordinates (cx, cy) in texels with periodic wrap:
 * `fn(d2)` gets the squared distance in texels (only inside `radius` texels).
 */
function splat(f: Fields, cx: number, cy: number, radius: number, fn: (d2: number, i: number) => void) {
  const { n } = f;
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  for (let dy = -r; dy <= r + 1; dy += 1) {
    const y = y0 + dy;
    const wy = ((y % n) + n) % n;
    const ddy = y - cy;
    for (let dx = -r; dx <= r + 1; dx += 1) {
      const x = x0 + dx;
      const ddx = x - cx;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 > r2) continue;
      fn(d2, wy * n + (((x % n) + n) % n));
    }
  }
}

// ---------------------------------------------------------------- patterns (heights in meters)

/** Skin: pores (~0.2–0.3 mm), a faint diamond of fine lines, micro-bumps; slow roughness blotches. */
function skinFields(): Fields {
  const n = 256, size = 0.016;
  const f = fields(n, size);
  const px = size / n;
  const bumps = periodicNoise(n, 64, 11);
  const bumps2 = periodicNoise(n, 32, 12);
  const warp = periodicNoise(n, 8, 13);
  const blotch = periodicNoise(n, 12, 14);
  const blotch2 = periodicNoise(n, 24, 15);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      const u = x / n, v = y / n;
      // Two families of shallow grooves (periodic: integer wave numbers), warped so they wander.
      const w = warp[i] * 2.2;
      const l1 = Math.cos(TAU * (16 * u + 12 * v) + w);
      const l2 = Math.cos(TAU * (16 * u - 12 * v) - w * 0.8);
      const groove = Math.exp(9 * (l1 - 1)) + 0.8 * Math.exp(9 * (l2 - 1));
      f.height[i] = 3.5e-6 * bumps[i] + 2.5e-6 * bumps2[i] - 7e-6 * groove;
      f.cavity[i] = 1 - 0.05 * groove;
      f.rough[i] = 0.65 * blotch[i] + 0.35 * blotch2[i];
    }
  }
  // Pores on a jittered 0.4 mm grid, ~60 % occupied, a little rougher and darker inside.
  const rng = createRng(17);
  const cells = 40;
  const cell = n / cells;
  for (let gy = 0; gy < cells; gy += 1) {
    for (let gx = 0; gx < cells; gx += 1) {
      if (rng() > 0.6) continue;
      const cx = (gx + 0.15 + 0.7 * rng()) * cell, cy = (gy + 0.15 + 0.7 * rng()) * cell;
      const r = (0.07e-3 + 0.07e-3 * rng()) / px;
      const depth = 14e-6 + 14e-6 * rng();
      splat(f, cx, cy, r * 1.6, (d2, i) => {
        const t = Math.exp(-d2 / (r * r));
        f.height[i] -= depth * t;
        f.cavity[i] *= 1 - 0.22 * t;
        f.rough[i] += 0.5 * t;
      });
    }
  }
  return f;
}

/** Cotton jersey: columns of V-shaped knit loops, 1 mm wales × 0.75 mm courses, plied yarn. */
function knitFields(): Fields {
  const n = 128, size = 0.006;
  const f = fields(n, size);
  const px = size / n;
  const wales = 6, courses = 8;
  const w = n / wales, c = n / courses;
  const rYarn = 0.26 * w;
  const fuzz = periodicNoise(n, 32, 21);
  const slub = periodicNoise(n, 8, 22);
  // Each stitch: two slanted legs meeting at the bottom; height = rounded yarn profile.
  const legs: Array<[number, number, number, number]> = [];
  for (let j = 0; j < courses; j += 1) {
    for (let i = 0; i < wales; i += 1) {
      const cx = (i + 0.5) * w, cy = (j + 0.5) * c;
      legs.push([cx - 0.3 * w, cy - 0.62 * c, cx - 0.04 * w, cy + 0.62 * c]);
      legs.push([cx + 0.3 * w, cy - 0.62 * c, cx + 0.04 * w, cy + 0.62 * c]);
    }
  }
  const h = new Float32Array(n * n);
  for (const [ax, ay, bx, by] of legs) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const minX = Math.floor(Math.min(ax, bx) - rYarn), maxX = Math.ceil(Math.max(ax, bx) + rYarn);
    const minY = Math.floor(Math.min(ay, by) - rYarn), maxY = Math.ceil(Math.max(ay, by) + rYarn);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const qx = ax + dx * t - x, qy = ay + dy * t - y;
        const d = Math.sqrt(qx * qx + qy * qy) / rYarn;
        if (d >= 1) continue;
        // Ply twist: a fine diagonal ripple along the yarn.
        const twist = 1 + 0.1 * Math.sin(TAU * (t * len / (0.35 * w)) + d * 2.5);
        const prof = Math.sqrt(1 - d * d) * twist * (0.88 + 0.12 * Math.sin(Math.PI * t));
        const wi = (((y % n) + n) % n) * n + (((x % n) + n) % n);
        if (prof > h[wi]) h[wi] = prof;
      }
    }
  }
  for (let i = 0; i < n * n; i += 1) {
    const yarn = h[i];
    f.height[i] = (0.12e-3 * yarn + 0.006e-3 * fuzz[i]) * (1 + 0.08 * slub[i]);
    f.cavity[i] = 0.72 + 0.28 * Math.min(1, yarn * 1.6);
    f.rough[i] = 0.6 * (1 - Math.min(1, yarn * 1.4)) + 0.25 * fuzz[i];
  }
  void px;
  return f;
}

/** Lycra / tricot: very fine ribs (0.3 mm) with a faint course ripple; mostly a sheen breakup. */
function lycraFields(): Fields {
  const n = 128, size = 0.0024;
  const f = fields(n, size);
  const noise = periodicNoise(n, 16, 31);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      const u = x / n, v = y / n;
      const rib = Math.pow(0.5 + 0.5 * Math.cos(TAU * 8 * u + 0.6 * Math.sin(TAU * 10 * v)), 1.6);
      const course = 0.5 + 0.5 * Math.cos(TAU * 10 * v + Math.PI * Math.floor(u * 8));
      f.height[i] = 0.018e-3 * rib + 0.006e-3 * course + 0.002e-3 * noise[i];
      f.cavity[i] = 0.93 + 0.07 * rib;
      f.rough[i] = 0.5 * (0.5 - rib) + 0.3 * noise[i];
    }
  }
  return f;
}

/**
 * Engineered running-shoe mesh: a staggered lattice of oval openings (2.4 mm × 1.8 mm pitch)
 * between rounded yarn bars that carry a knit chevron; the openings show a darker, finer inner
 * layer. (Rows must stay even for the stagger to tile.)
 */
function meshFields(): Fields {
  const n = 256, size = 0.0144;
  const f = fields(n, size);
  const px = size / n;
  const cols = 6, rows = 8;
  const cw = n / cols, ch = n / rows;
  const rx = 0.27 * cw, ry = 0.25 * ch;
  const fine = periodicNoise(n, 96, 41);
  const slub = periodicNoise(n, 12, 42);
  // Knit chevrons on the bars: 24 wales × 32 courses per tile (0.6 mm × 0.45 mm).
  const wales = 24, courses = 32;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      // Nearest opening on the staggered lattice (odd rows offset by half a column).
      const row = Math.floor(y / ch);
      let best = 1e9;
      for (let rr = row - 1; rr <= row + 1; rr += 1) {
        const off = (((rr % 2) + 2) % 2) * 0.5;
        const cy = (rr + 0.5) * ch;
        const col = Math.floor(x / cw - off);
        for (let cc = col - 1; cc <= col + 1; cc += 1) {
          const ex = (x - (cc + 0.5 + off) * cw) / rx, ey = (y - cy) / ry;
          const d = ex * ex + ey * ey;
          if (d < best) best = d;
        }
      }
      const r = Math.sqrt(best);
      // Distance outside the opening's edge (texels, approximately) → rounded bar profile.
      const edge = (r - 1) * Math.min(rx, ry);
      const open = 1 - smooth(-0.6, 0.9, edge);
      const bar = Math.sqrt(smooth(0, 9, edge));
      const u = (x / n) * wales, v = (y / n) * courses;
      const chevron = 0.5 + 0.5 * Math.cos(TAU * (u + 1.1 * Math.abs((v % 1) - 0.5)));
      const inner = 0.5 + 0.5 * Math.cos(TAU * 64 * (x / n)) * Math.cos(TAU * 80 * (y / n));
      f.height[i] = (0.12e-3 * bar + 0.04e-3 * chevron * bar) * (1 + 0.1 * slub[i]) - 0.18e-3 * open + 0.012e-3 * inner * open + 0.004e-3 * fine[i];
      f.cavity[i] = 1 - 0.55 * open - 0.12 * (1 - chevron) * bar;
      f.rough[i] = 0.6 * open - 0.25 * bar * chevron + 0.15 * fine[i];
    }
  }
  void px;
  return f;
}

/** Rubber: fine moulded stipple and micro-pits. */
function grainFields(): Fields {
  const n = 128, size = 0.004;
  const f = fields(n, size);
  const a = periodicNoise(n, 40, 51);
  const b = periodicNoise(n, 20, 52);
  const c = periodicNoise(n, 6, 53);
  for (let i = 0; i < n * n; i += 1) {
    const s = 0.7 * a[i] + 0.3 * b[i];
    f.height[i] = 0.012e-3 * s;
    f.cavity[i] = 0.94 + 0.06 * Math.max(-1, Math.min(1, s * 1.5));
    f.rough[i] = 0.5 * c[i] - 0.3 * s;
  }
  return f;
}

/** Pebbled leather: Voronoi pebbles (~0.8 mm) with darker creases between them. */
function leatherFields(): Fields {
  const n = 128, size = 0.008;
  const f = fields(n, size);
  const cells = 10;
  const rng = createRng(61);
  const pts: Array<[number, number]> = [];
  for (let gy = 0; gy < cells; gy += 1) for (let gx = 0; gx < cells; gx += 1) pts.push([(gx + 0.2 + 0.6 * rng()) * (n / cells), (gy + 0.2 + 0.6 * rng()) * (n / cells)]);
  const noise = periodicNoise(n, 24, 62);
  const cell = n / cells;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      let d1 = 1e9, d2 = 1e9;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = (gx + ox + cells) % cells, cy = (gy + oy + cells) % cells;
          const p = pts[cy * cells + cx];
          const px = p[0] + (gx + ox - cx) * cell, py = p[1] + (gy + oy - cy) * cell;
          const d = Math.hypot(x - px, y - py);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      }
      const edge = (d2 - d1) / cell;
      const crease = Math.exp(-((edge / 0.09) ** 2));
      const i = y * n + x;
      f.height[i] = 0.03e-3 * (1 - crease) * Math.min(1, edge * 3) + 0.003e-3 * noise[i];
      f.cavity[i] = 1 - 0.18 * crease;
      f.rough[i] = 0.6 * crease + 0.2 * noise[i];
    }
  }
  return f;
}

/** Synthetic microfibre (cycling shoes): faint fibre noise and a sparse perforation grid. */
function microfiberFields(): Fields {
  const n = 128, size = 0.006;
  const f = fields(n, size);
  const a = periodicNoise(n, 48, 71);
  const b = periodicNoise(n, 8, 72);
  for (let i = 0; i < n * n; i += 1) {
    f.height[i] = 0.004e-3 * a[i];
    f.rough[i] = 0.5 * b[i] + 0.2 * a[i];
  }
  // 1 mm perforations on a 3 mm grid (2 × 2 per tile).
  const step = n / 2;
  for (let gy = 0; gy < 2; gy += 1) {
    for (let gx = 0; gx < 2; gx += 1) {
      const cx = (gx + 0.5) * step + (gy % 2) * step * 0.5, cy = (gy + 0.5) * step;
      const r = (0.45e-3 / size) * n;
      splat(f, cx, cy, r * 1.3, (d2, i) => {
        const t = 1 - smooth(0.7, 1.0, Math.sqrt(d2) / r);
        f.height[i] -= 0.12e-3 * t;
        f.cavity[i] *= 1 - 0.5 * t;
      });
    }
  }
  return f;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const BUILDERS: Record<DetailKind, { build: () => Fields; feature: number; roughFeature: number }> = {
  skin: { build: skinFields, feature: 0.0004, roughFeature: 0.004 },
  knit: { build: knitFields, feature: 0.001, roughFeature: 0.002 },
  lycra: { build: lycraFields, feature: 0.0003, roughFeature: 0.0012 },
  mesh: { build: meshFields, feature: 0.002, roughFeature: 0.004 },
  grain: { build: grainFields, feature: 0.0002, roughFeature: 0.002 },
  leather: { build: leatherFields, feature: 0.0008, roughFeature: 0.002 },
  microfiber: { build: microfiberFields, feature: 0.0006, roughFeature: 0.003 },
};

/** Encodes slopes (periodic central differences), roughness and cavity into RGBA8. */
function encode(f: Fields): { data: Uint8Array; slope: number } {
  const { n, height, rough, cavity } = f;
  const px = f.size / n;
  const su = new Float32Array(n * n), sv = new Float32Array(n * n);
  let maxSlope = 1e-6;
  for (let y = 0; y < n; y += 1) {
    const yu = ((y + 1) % n) * n, yd = ((y - 1 + n) % n) * n;
    for (let x = 0; x < n; x += 1) {
      const xr = (x + 1) % n, xl = (x - 1 + n) % n;
      const i = y * n + x;
      su[i] = (height[y * n + xr] - height[y * n + xl]) / (2 * px);
      sv[i] = (height[yu + x] - height[yd + x]) / (2 * px);
      maxSlope = Math.max(maxSlope, Math.abs(su[i]), Math.abs(sv[i]));
    }
  }
  let maxRough = 1e-6;
  for (let i = 0; i < n * n; i += 1) maxRough = Math.max(maxRough, Math.abs(rough[i]));
  const data = new Uint8Array(n * n * 4);
  const q = (x: number) => Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * x)));
  for (let i = 0; i < n * n; i += 1) {
    data[i * 4] = q(su[i] / maxSlope);
    data[i * 4 + 1] = q(sv[i] / maxSlope);
    data[i * 4 + 2] = q(rough[i] / maxRough);
    data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(255 * cavity[i])));
  }
  return { data, slope: maxSlope };
}

const tiles = new Map<DetailKind, DetailTile>();

/** The tile for a pattern (built on first use, cached until `disposeDetailTiles`). */
export function detailTile(kind: DetailKind): DetailTile {
  let tile = tiles.get(kind);
  if (tile) return tile;
  const spec = BUILDERS[kind];
  const f = spec.build();
  const { data, slope } = encode(f);
  const texture = new THREE.DataTexture(data, f.n, f.n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = `fitx-detail-${kind}`;
  texture.needsUpdate = true;
  tile = { texture, size: f.size, slope, feature: spec.feature, roughFeature: spec.roughFeature };
  tiles.set(kind, tile);
  return tile;
}

export function disposeDetailTiles() {
  for (const tile of tiles.values()) tile.texture.dispose();
  tiles.clear();
}
