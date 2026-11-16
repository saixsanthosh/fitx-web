/**
 * GLSL for the procedural texture baker (`bake.ts`). One shader holds every surface so the baker
 * compiles a single program per renderer. All patterns tile: noise periods are integers per tile.
 *
 * A surface function writes albedo (linear RGB), height (0..1) and ORM (AO, roughness, metalness);
 * "data" surfaces write an arbitrary RGBA instead. `uOut` selects what the bake stores.
 */

export const BAKE_MODE = {
  tartan: 1,
  asphalt: 2,
  grass: 3,
  concrete: 4,
  brick: 5,
  wood: 6,
  rubberTile: 7,
  knurl: 8,
  plaster: 9,
  speckle: 10,
  salmon: 11,
  leaf: 12,
  tomatoCut: 13,
  quinoa: 14,
  noise: 15,
  spokeBlur: 16,
  haze: 17,
  heightTex: 18,
  rubber: 19,
  greens: 20,
  steel: 21,
  treeline: 22,
} as const;

export type BakeMode = keyof typeof BAKE_MODE;

export const BAKE_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform int uMode;
uniform int uOut;
uniform float uSeed;
uniform float uStrength;
uniform vec4 uA;
uniform vec4 uB;
uniform vec3 uCol0;
uniform vec3 uCol1;
uniform vec3 uCol2;
uniform vec3 uCol3;
uniform sampler2D uTex;

uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}
ivec2 wrapi(ivec2 c, ivec2 p) { return ((c % p) + p) % p; }
float h21(ivec2 p) { uvec2 h = pcg2d(uvec2(p) + uvec2(uint(uSeed) * 7919u, uint(uSeed) * 104729u + 17u)); return float(h.x) * (1.0 / 4294967296.0); }
vec2 h22(ivec2 p) { uvec2 h = pcg2d(uvec2(p) + uvec2(uint(uSeed) * 7919u, uint(uSeed) * 104729u + 17u)); return vec2(h) * (1.0 / 4294967296.0); }

float vnoise(vec2 p, ivec2 period) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = h21(wrapi(i, period));
  float b = h21(wrapi(i + ivec2(1, 0), period));
  float c = h21(wrapi(i + ivec2(0, 1), period));
  float d = h21(wrapi(i + ivec2(1, 1), period));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, ivec2 period, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    sum += amp * vnoise(p, period);
    norm += amp;
    p *= 2.0;
    period *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

// Tileable cellular noise. Returns (F1, F2, id of nearest, id2 of nearest); d1 = vector to nearest feature.
vec4 worley(vec2 p, ivec2 period, float jitter, out vec2 d1) {
  ivec2 ip = ivec2(floor(p));
  vec2 fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0, id2 = 0.0;
  d1 = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 cell = wrapi(ip + ivec2(i, j), period);
      vec2 o = h22(cell) * jitter + 0.5 * (1.0 - jitter);
      vec2 d = vec2(float(i), float(j)) + o - fp;
      float dist = length(d);
      if (dist < f1) {
        f2 = f1; f1 = dist; d1 = d;
        id = h21(cell + ivec2(37, 91));
        id2 = h21(cell + ivec2(113, 7));
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }
  return vec4(f1, f2, id, id2);
}

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// ---------------------------------------------------------------- surfaces
// EPDM granules in a polyurethane binder. uA = (cells per tile, fine cells, dark fraction, warp)
void sTartan(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  int n = int(uA.x);
  vec2 warp = vec2(fbm(uv * 19.0, ivec2(19), 3), fbm(uv * 19.0 + 11.7, ivec2(19), 3)) - 0.5;
  vec2 d1;
  vec4 w = worley(uv * uA.x + warp * uA.w, ivec2(n), 0.92, d1);
  float edge = w.y - w.x;
  float chip = smoothstep(0.03, 0.26, edge);
  float tilt = dot(d1, vec2(cos(w.w * 6.2831), sin(w.w * 6.2831))) * 0.35;
  vec2 d2;
  vec4 w2 = worley(uv * uA.y + 3.3, ivec2(int(uA.y)), 0.9, d2);
  float chip2 = smoothstep(0.03, 0.3, w2.y - w2.x);
  float fine = fbm(uv * 211.0, ivec2(211), 2);
  float top = 0.62 + 0.38 * w.z;
  h = chip * (top + tilt) * 0.8 + chip2 * 0.14 + fine * 0.08;
  h = clamp(h, 0.0, 1.0);
  float tint = 0.8 + 0.4 * w.z;
  vec3 granule = uCol0 * tint;
  granule = mix(granule, uCol0 * vec3(1.08, 0.92, 0.86), step(0.82, w.w) * 0.6);
  granule = mix(granule, uCol1, step(w.z, uA.z));
  vec3 binder = uCol2 * (0.85 + 0.3 * fine);
  alb = mix(binder, granule, chip);
  alb *= 0.92 + 0.16 * chip * smoothstep(0.55, 1.0, h);
  float ao = mix(0.62, 1.0, smoothstep(0.0, 0.55, h));
  orm = vec3(ao, mix(0.97, 0.86 - 0.08 * w.z, chip), 0.0);
}

// Aggregate in bitumen. uA = (stone cells, stone fraction, fine cells, -)
void sAsphalt(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  vec2 warp = vec2(fbm(uv * 13.0, ivec2(13), 3), fbm(uv * 13.0 + 5.1, ivec2(13), 3)) - 0.5;
  vec2 d1;
  vec4 w = worley(uv * uA.x + warp * 1.2, ivec2(int(uA.x)), 0.95, d1);
  float isStone = step(1.0 - uA.y, w.z);
  float stone = smoothstep(0.04, 0.32, w.y - w.x) * isStone;
  vec2 d2;
  vec4 w2 = worley(uv * uA.z + 1.7, ivec2(int(uA.z)), 0.9, d2);
  float grit = smoothstep(0.05, 0.25, w2.y - w2.x) * step(0.55, w2.z);
  float fine = fbm(uv * 173.0, ivec2(173), 3);
  h = clamp(stone * (0.55 + 0.45 * w.w) + grit * 0.25 + fine * 0.15, 0.0, 1.0);
  vec3 bitumen = uCol0 * (0.75 + 0.5 * fine);
  vec3 rock = mix(uCol1, uCol2, w.w) * (0.85 + 0.3 * fine);
  alb = mix(bitumen, rock, max(stone, grit * 0.6));
  orm = vec3(mix(0.7, 1.0, h), mix(0.93, 0.72, stone), 0.0);
}

// Mown turf. uA = (blade streak cells u, v, clump cells, dryness)
void sGrass(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float s1 = fbm(vec2(uv.x * uA.x, uv.y * uA.y), ivec2(int(uA.x), int(uA.y)), 4);
  float s2 = fbm(vec2(uv.x * uA.x * 1.7 + 3.1, uv.y * uA.y * 0.6), ivec2(int(uA.x * 1.7), int(uA.y * 0.6)), 3);
  vec2 d1;
  vec4 w = worley(uv * uA.z, ivec2(int(uA.z)), 1.0, d1);
  float clump = smoothstep(0.9, 0.1, w.x);
  float blades = smoothstep(0.35, 0.75, s1) * 0.7 + smoothstep(0.45, 0.8, s2) * 0.5;
  h = clamp(blades * 0.75 + clump * 0.25, 0.0, 1.0);
  vec3 base = mix(uCol0, uCol1, smoothstep(0.2, 0.9, h));
  base = mix(base, uCol2, uA.w * smoothstep(0.62, 0.9, fbm(uv * 9.0 + 4.0, ivec2(9), 3)));
  alb = base * (0.85 + 0.3 * w.z);
  orm = vec3(mix(0.55, 1.0, h), 0.9, 0.0);
}

// Concrete. uA = (stain scale cells, polish 0..1, pore density, aggregate)
void sConcrete(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  int sc = int(uA.x);
  float stain = fbm(uv * uA.x, ivec2(sc), 5);
  float stain2 = fbm(uv * uA.x * 3.0 + 7.0, ivec2(sc * 3), 4);
  float fine = fbm(uv * 256.0, ivec2(256), 2);
  vec2 d1;
  vec4 w = worley(uv * 140.0, ivec2(140), 1.0, d1);
  float pore = (1.0 - smoothstep(0.05, 0.16, w.x)) * step(1.0 - uA.z, w.z);
  vec2 d2;
  vec4 w2 = worley(uv * 70.0 + 2.0, ivec2(70), 1.0, d2);
  float agg = smoothstep(0.1, 0.3, w2.y - w2.x) * step(0.7, w2.z) * uA.w;
  vec3 base = mix(uCol0, uCol1, smoothstep(0.35, 0.75, stain) * 0.75);
  base = mix(base, uCol2, smoothstep(0.55, 0.85, stain2) * 0.45);
  base *= 0.9 + 0.2 * fine;
  base = mix(base, base * 1.12, agg);
  alb = base * (1.0 - pore * 0.55);
  h = clamp(0.5 + (fine - 0.5) * 0.35 - pore * 0.45 + agg * 0.1, 0.0, 1.0);
  float rough = mix(0.86, 0.38, uA.y) + (stain - 0.5) * 0.18 + pore * 0.1;
  orm = vec3(1.0 - pore * 0.4, clamp(rough, 0.05, 1.0), 0.0);
}

// Running-bond brick. uA = (cols, rows, mortar u fraction, mortar v fraction); uB.x = soot amount
void sBrick(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float rows = uA.y, cols = uA.x;
  float row = floor(uv.y * rows);
  float offset = mod(row, 2.0) * 0.5;
  vec2 b = vec2(uv.x * cols + offset, uv.y * rows);
  vec2 cell = floor(b);
  vec2 f = fract(b);
  ivec2 ci = wrapi(ivec2(cell), ivec2(int(cols), int(rows)));
  float rnd = h21(ci + ivec2(5, 3));
  float rnd2 = h21(ci + ivec2(11, 29));
  float chipN = fbm(uv * vec2(cols, rows) * 6.0, ivec2(int(cols) * 6, int(rows) * 6), 3);
  vec2 m = vec2(uA.z, uA.w) * (0.75 + 0.6 * chipN);
  float ex = smoothstep(m.x * 0.5, m.x, f.x) * smoothstep(m.x * 0.5, m.x, 1.0 - f.x);
  float ey = smoothstep(m.y * 0.5, m.y, f.y) * smoothstep(m.y * 0.5, m.y, 1.0 - f.y);
  float brick = ex * ey;
  float fine = fbm(uv * 220.0, ivec2(220), 3);
  vec2 pd;
  float pits = 1.0 - smoothstep(0.0, 0.08, worley(uv * 90.0, ivec2(90), 1.0, pd).x);
  vec3 tone = mix(uCol0, uCol1, rnd);
  tone = mix(tone, uCol2, step(0.9, rnd2) * 0.8);
  tone *= 0.85 + 0.3 * fine;
  float soot = fbm(vec2(uv.x * 6.0, uv.y * 2.0), ivec2(6, 2), 4);
  vec3 mortar = uCol3 * (0.8 + 0.35 * fine);
  alb = mix(mortar, tone, brick);
  alb *= 1.0 - uB.x * smoothstep(0.45, 0.85, soot);
  h = clamp(brick * (0.7 + 0.2 * fine - pits * 0.25 + (rnd - 0.5) * 0.1) + (1.0 - brick) * 0.15 * fine, 0.0, 1.0);
  orm = vec3(mix(0.55, 1.0, brick), mix(0.97, 0.85, brick), 0.0);
}

// Wood grain along U. uA = (ring frequency across V, planks across V (0 = one board), figure warp, pore scale)
void sWood(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float planks = max(uA.y, 1.0);
  float pv = uv.y * planks;
  float plank = floor(pv);
  float lv = fract(pv);
  int pi = int(mod(plank, planks));
  float prnd = h21(ivec2(pi, 3));
  float shift = prnd * 7.0;
  float warp = fbm(vec2(uv.x * 3.0 + shift, lv * 2.0 + prnd * 4.0), ivec2(3, 2), 4) * uA.z;
  // Uneven growth: ring spacing drifts across the board, and each ring has its own contrast.
  float drift = fbm(vec2(lv * 3.0 + prnd * 5.0, uv.x * 1.0 + 0.3), ivec2(3, 1), 3);
  float rings = lv * uA.x / planks + warp * 6.0 + drift * uA.x * 0.18 / planks + shift;
  float ring = fract(rings);
  float ringId = floor(rings);
  float ringK = 0.35 + 0.65 * h21(ivec2(int(mod(ringId, 4096.0)), pi + 7));
  float late = smoothstep(0.62, 0.92, ring) * (1.0 - smoothstep(0.92, 1.0, ring)) * ringK;
  float pores = fbm(vec2(uv.x * uA.w, uv.y * uA.w * 9.0 * planks), ivec2(int(uA.w), int(uA.w * 9.0 * planks)), 2);
  float streak = fbm(vec2(uv.x * 2.0, uv.y * 64.0 * planks), ivec2(2, int(64.0 * planks)), 3);
  float broad = fbm(vec2(uv.x * 1.0, lv * 3.0 + prnd * 9.0), ivec2(1, 3), 3);
  vec3 c = mix(uCol0, uCol1, late * 0.5 + streak * 0.22 + (broad - 0.5) * 0.35);
  c = mix(c, uCol2, prnd * 0.35);
  c *= 0.92 + 0.16 * pores;
  float seam = (uA.y > 0.5) ? smoothstep(0.0, 0.012, lv) * smoothstep(0.0, 0.012, 1.0 - lv) : 1.0;
  alb = c * mix(0.35, 1.0, seam);
  h = clamp(0.6 - late * 0.12 - (1.0 - pores) * 0.12, 0.0, 1.0) * seam;
  orm = vec3(mix(0.5, 1.0, seam), 0.48 + late * 0.12 + (1.0 - pores) * 0.1, 0.0);
}

// Gym rubber flooring tile (one tile per texture). uA = (fleck cells, fleck density, seam width, -)
void sRubberTile(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  vec2 d1;
  vec4 w = worley(uv * uA.x, ivec2(int(uA.x)), 1.0, d1);
  float fleck = (1.0 - smoothstep(0.18, 0.32, w.x)) * step(1.0 - uA.y, w.z);
  vec3 fc = w.w < 0.55 ? uCol1 : (w.w < 0.85 ? uCol2 : uCol3);
  float fine = fbm(uv * 300.0, ivec2(300), 2);
  vec2 e = min(uv, 1.0 - uv);
  float seam = smoothstep(0.0, uA.z, min(e.x, e.y));
  alb = mix(uCol0 * (0.85 + 0.3 * fine), fc, fleck) * mix(0.3, 1.0, seam);
  h = (0.6 + 0.25 * fine + fleck * 0.1) * seam;
  orm = vec3(mix(0.4, 1.0, seam), 0.88 - fleck * 0.1, 0.0);
}

// Diamond knurl. uA = (diamonds per tile, flat top width, chalk in grooves, -)
void sKnurl(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  vec2 p = uv * uA.x;
  float a = fract(p.x + p.y);
  float b = fract(p.x - p.y);
  float pyr = min(1.0 - abs(2.0 * a - 1.0), 1.0 - abs(2.0 * b - 1.0));
  h = min(pyr / max(1.0 - uA.y, 0.01), 1.0);
  float chalk = (1.0 - smoothstep(0.0, 0.35, h)) * uA.z;
  alb = mix(uCol0, uCol1, chalk);
  orm = vec3(mix(0.6, 1.0, h), mix(0.55, 0.3, h) + chalk * 0.3, 1.0 - chalk);
}

// Plaster / painted wall. uA = (blotch cells, sand cells, -, -)
void sPlaster(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float blot = fbm(uv * uA.x, ivec2(int(uA.x)), 5);
  float sand = fbm(uv * uA.y, ivec2(int(uA.y)), 2);
  alb = mix(uCol0, uCol1, smoothstep(0.3, 0.8, blot) * 0.6) * (0.96 + 0.08 * sand);
  h = 0.5 + (blot - 0.5) * 0.3 + (sand - 0.5) * 0.4;
  orm = vec3(1.0, 0.88, 0.0);
}

// Speckled stoneware glaze. uA = (speck cells, density, glaze pooling, roughness)
void sSpeckle(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  vec2 d1;
  vec4 w = worley(uv * uA.x, ivec2(int(uA.x)), 1.0, d1);
  float sp = (1.0 - smoothstep(0.06, 0.16 + 0.1 * w.w, w.x)) * step(1.0 - uA.y, w.z);
  float pool = fbm(uv * 6.0, ivec2(6), 4);
  alb = mix(uCol0, uCol2, smoothstep(0.4, 0.8, pool) * uA.z) ;
  alb = mix(alb, uCol1, sp);
  h = 0.5 + (pool - 0.5) * 0.15 - sp * 0.1;
  orm = vec3(1.0, uA.w + sp * 0.2, 0.0);
}

// Raw salmon: coral flesh with white fat lines. uA = (lines per tile, waviness, fat width, -)
void sSalmon(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float wav = fbm(uv * vec2(2.0, 3.0), ivec2(2, 3), 3) * uA.y;
  float l = fract(uv.x * uA.x + sin(uv.y * 6.2831) * 0.35 + wav);
  float fat = smoothstep(0.5 - uA.z, 0.5 - uA.z * 0.35, abs(l - 0.5));
  float grain = fbm(uv * vec2(40.0, 160.0), ivec2(40, 160), 3);
  vec3 flesh = mix(uCol0, uCol1, grain * 0.6);
  alb = mix(flesh, uCol2, fat * 0.85);
  h = 0.5 + fat * 0.08 + (grain - 0.5) * 0.12;
  orm = vec3(1.0, 0.32 + fat * 0.15, 0.0);
}

// Leaf in leaf space: u across (0..1, midrib at 0.5), v base → tip. uA = (vein count, vein width, -, -)
void sLeaf(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float x = uv.x - 0.5;
  float midrib = 1.0 - smoothstep(0.004, 0.016, abs(x));
  float vv = fract((uv.y - abs(x) * 1.1) * uA.x);
  float vein = (1.0 - smoothstep(0.0, uA.y, abs(vv - 0.5) - 0.5 + uA.y)) * smoothstep(0.02, 0.06, abs(x));
  float mott = fbm(uv * 24.0, ivec2(24), 4);
  vec3 c = mix(uCol0, uCol1, mott * 0.55 + uv.y * 0.15);
  c = mix(c, uCol2, max(midrib, vein * 0.6));
  c *= 0.8 + 0.4 * smoothstep(0.5, 0.0, abs(x));
  alb = c;
  h = 0.5 - vein * 0.25 - midrib * 0.15 + (mott - 0.5) * 0.15;
  orm = vec3(1.0, 0.55 - mott * 0.15, 0.0);
}

// Cherry tomato cross-section (disc centred in the tile).
void sTomatoCut(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float sector = abs(fract(a / 6.2831 * 3.0 + 0.08) - 0.5) * 2.0;
  float septum = smoothstep(0.82, 0.95, sector);
  float wall = smoothstep(0.74, 0.8, r);
  float core = 1.0 - smoothstep(0.18, 0.26, r);
  float locule = (1.0 - wall) * (1.0 - core) * (1.0 - septum);
  vec2 d1;
  vec4 w = worley(uv * 18.0, ivec2(18), 1.0, d1);
  float seed = (1.0 - smoothstep(0.14, 0.22, w.x)) * locule * step(0.35, r) * step(r, 0.68);
  vec3 c = mix(uCol1, uCol0, max(max(wall, septum * 0.85), core * 0.6));
  c = mix(c, uCol2, seed);
  c = mix(c, uCol0 * 0.75, smoothstep(0.94, 1.0, r));
  alb = c;
  h = 0.5 + wall * 0.1 - locule * 0.15 + seed * 0.1;
  orm = vec3(1.0, mix(0.22, 0.4, wall), 0.0);
}

// Tri-colour quinoa grains. uA = (grains per tile, red fraction, black fraction, -)
void sQuinoa(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  vec2 d1;
  vec4 w = worley(uv * uA.x, ivec2(int(uA.x)), 0.85, d1);
  float grain = smoothstep(0.42, 0.18, w.x);
  float ring = smoothstep(0.05, 0.0, abs(w.x - 0.3)) * 0.5;
  vec3 gc = w.z < uA.z ? uCol2 : (w.z < uA.z + uA.y ? uCol1 : uCol0);
  gc *= 0.85 + 0.3 * w.w;
  vec3 gap = uCol0 * 0.35;
  alb = mix(gap, gc + ring * 0.12, grain);
  h = grain * (0.7 + 0.3 * w.w) * sqrt(max(0.0, 1.0 - (w.x / 0.45) * (w.x / 0.45)));
  orm = vec3(mix(0.45, 1.0, grain), 0.55, 0.0);
}

// Mixed salad greens (spinach/kale texture for leaf clusters). uA = (cells, -, -, -)
void sGreens(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  vec2 d1;
  vec4 w = worley(uv * uA.x, ivec2(int(uA.x)), 1.0, d1);
  float n = fbm(uv * 40.0, ivec2(40), 4);
  float vein = 1.0 - smoothstep(0.0, 0.05, abs(w.y - w.x - 0.08));
  vec3 c = mix(uCol0, uCol1, w.z * 0.7 + n * 0.3);
  c = mix(c, uCol2, vein * 0.5);
  alb = c;
  h = 0.4 + 0.4 * smoothstep(0.0, 0.5, w.y - w.x) + (n - 0.5) * 0.2;
  orm = vec3(mix(0.6, 1.0, h), 0.5, 0.0);
}

// Plain rubber (plates, tyres): fine orange-peel texture. uA = (cells, roughness, -, -)
void sRubber(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float n = fbm(uv * uA.x, ivec2(int(uA.x)), 3);
  float m = fbm(uv * 7.0, ivec2(7), 4);
  alb = uCol0 * (0.94 + 0.12 * m);
  h = n;
  orm = vec3(1.0, uA.y + (m - 0.5) * 0.08, 0.0);
}

// Brushed/powder-coated steel. uA = (brush streak cells u, v, roughness, metal)
void sSteel(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  float s = fbm(vec2(uv.x * uA.x, uv.y * uA.y), ivec2(int(uA.x), int(uA.y)), 3);
  float m = fbm(uv * 5.0, ivec2(5), 4);
  alb = uCol0 * (0.92 + 0.16 * m);
  h = s;
  orm = vec3(1.0, uA.z + (s - 0.5) * 0.1 + (m - 0.5) * 0.08, uA.w);
}

// ---------------------------------------------------------------- data
// Four independent tileable fbm channels at increasing scale. uA = (base cells, -, -, -)
vec4 dNoise(vec2 uv) {
  int b = int(uA.x);
  return vec4(
    fbm(uv * uA.x, ivec2(b), 5),
    fbm(uv * uA.x * 2.0 + 17.0, ivec2(b * 2), 5),
    fbm(uv * uA.x * 4.0 + 41.0, ivec2(b * 4), 4),
    fbm(uv * uA.x * 8.0 + 73.0, ivec2(b * 8), 3)
  );
}

// Blurred spokes on a disc centred in the tile. uA = (spokes, inner radius, outer radius, -)
vec4 dSpokeBlur(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x) / 6.2831 + 0.5;
  float n = fbm(vec2(a * 96.0, r * 2.0), ivec2(96, 2), 3);
  float streak = 0.6 + 0.4 * (0.5 + 0.5 * cos(a * 6.2831 * uA.x)) * 0.5 + (n - 0.5) * 0.35;
  float inside = smoothstep(uA.y - 0.02, uA.y + 0.02, r) * (1.0 - smoothstep(uA.z - 0.015, uA.z, r));
  float density = clamp(0.1 / max(r, 0.05), 0.0, 1.0) * 0.55 + 0.12;
  return vec4(1.0, 1.0, 1.0, clamp(inside * density * streak, 0.0, 1.0));
}

// Soft tileable haze billow (cards apply their own feathered border). uA = (cells, contrast, -, -)
vec4 dHaze(vec2 uv) {
  float n = fbm(uv * uA.x, ivec2(int(uA.x)), 6);
  float n2 = fbm(uv * uA.x * 0.5 + 9.0, ivec2(max(int(uA.x * 0.5), 1)), 4);
  float a = clamp((mix(n, n2, 0.5) - 0.5) * uA.y + 0.5, 0.0, 1.0);
  return vec4(1.0, 1.0, 1.0, a);
}

// Tree-line silhouette strip (periodic in u). uA = (crowns per tile, base height, crown variance, leafiness)
// R = interior shade, G = edge light (translucent rim), A = coverage.
float crownProfile(float u) {
  float n1 = fbm(vec2(u * uA.x, 0.5), ivec2(int(uA.x), 1), 4);
  float n2 = fbm(vec2(u * uA.x * 4.0, 3.5), ivec2(int(uA.x) * 4, 1), 3);
  vec2 d;
  vec4 w = worley(vec2(u * uA.x * 1.5, 0.5), ivec2(int(uA.x * 1.5), 1), 1.0, d);
  float crown = sqrt(max(0.0, 1.0 - w.x * w.x * 1.6)) * (0.6 + 0.4 * w.z);
  float tall = step(0.93, w.z) * sqrt(max(0.0, 1.0 - w.x * w.x * 9.0)) * 0.3;
  return uA.y + uA.z * (crown * 0.55 + n1 * 0.35 + n2 * 0.1) + tall;
}
vec4 dTreeline(vec2 uv) {
  // The tile is ~9x wider than tall in meters, so vertical cell counts are scaled to keep noise isotropic.
  float aspect = uRes.y / uRes.x * 9.2;
  float prof = crownProfile(uv.x);
  float lc = uA.x * 26.0;
  float leaf = fbm(uv * vec2(lc, floor(lc * aspect)), ivec2(int(lc), int(floor(lc * aspect))), 4);
  float lc2 = uA.x * 70.0;
  float leaf2 = fbm(uv * vec2(lc2, floor(lc2 * aspect)) + 3.0, ivec2(int(lc2), int(floor(lc2 * aspect))), 2);
  float edge = prof + (leaf - 0.5) * uA.w + (leaf2 - 0.5) * uA.w * 0.4;
  float aa = 1.5 / uRes.y;
  float a = 1.0 - smoothstep(edge - aa, edge + aa, uv.y);
  float holes = smoothstep(0.64, 0.74, leaf2) * smoothstep(edge - 0.12, edge - 0.01, uv.y);
  a *= 1.0 - holes * 0.9;
  vec2 d;
  float cc = uA.x * 5.0;
  vec4 w = worley(uv * vec2(cc, floor(cc * aspect)), ivec2(int(cc), int(floor(cc * aspect))), 1.0, d);
  float clump = smoothstep(0.95, 0.15, w.x) * (0.6 + 0.4 * w.z);
  float height = smoothstep(0.0, max(edge, 0.05), uv.y);
  float shade = clamp(0.18 + 0.42 * clump * (0.55 + 0.45 * leaf) + 0.4 * height * height, 0.0, 1.0);
  float rim = smoothstep(edge - 0.07, edge, uv.y) * (0.6 + 0.4 * leaf2);
  return vec4(shade, rim, 0.0, a);
}

void surface(vec2 uv, out vec3 alb, out float h, out vec3 orm) {
  alb = vec3(0.5); h = 0.5; orm = vec3(1.0, 0.8, 0.0);
  if (uMode == 1) sTartan(uv, alb, h, orm);
  else if (uMode == 2) sAsphalt(uv, alb, h, orm);
  else if (uMode == 3) sGrass(uv, alb, h, orm);
  else if (uMode == 4) sConcrete(uv, alb, h, orm);
  else if (uMode == 5) sBrick(uv, alb, h, orm);
  else if (uMode == 6) sWood(uv, alb, h, orm);
  else if (uMode == 7) sRubberTile(uv, alb, h, orm);
  else if (uMode == 8) sKnurl(uv, alb, h, orm);
  else if (uMode == 9) sPlaster(uv, alb, h, orm);
  else if (uMode == 10) sSpeckle(uv, alb, h, orm);
  else if (uMode == 11) sSalmon(uv, alb, h, orm);
  else if (uMode == 12) sLeaf(uv, alb, h, orm);
  else if (uMode == 13) sTomatoCut(uv, alb, h, orm);
  else if (uMode == 14) sQuinoa(uv, alb, h, orm);
  else if (uMode == 18) { h = texture2D(uTex, uv).r; alb = vec3(h); }
  else if (uMode == 19) sRubber(uv, alb, h, orm);
  else if (uMode == 20) sGreens(uv, alb, h, orm);
  else if (uMode == 21) sSteel(uv, alb, h, orm);
}

float heightAt(vec2 uv) {
  vec3 a; float h; vec3 o;
  surface(uv, a, h, o);
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uMode == 15) { gl_FragColor = dNoise(uv); return; }
  if (uMode == 16) { gl_FragColor = dSpokeBlur(uv); return; }
  if (uMode == 17) { gl_FragColor = dHaze(uv); return; }
  if (uMode == 22) { gl_FragColor = dTreeline(uv); return; }
  vec3 alb; float h; vec3 orm;
  surface(uv, alb, h, orm);
  if (uOut == 0) {
    gl_FragColor = vec4(alb, 1.0);
  } else if (uOut == 1) {
    vec2 e = 1.0 / uRes;
    float hl = heightAt(uv - vec2(e.x, 0.0));
    float hr = heightAt(uv + vec2(e.x, 0.0));
    float hd = heightAt(uv - vec2(0.0, e.y));
    float hu = heightAt(uv + vec2(0.0, e.y));
    vec3 n = normalize(vec3((hl - hr) * uStrength, (hd - hu) * uStrength, 1.0));
    gl_FragColor = vec4(n * 0.5 + 0.5, h);
  } else {
    gl_FragColor = vec4(orm, 1.0);
  }
}
`;
