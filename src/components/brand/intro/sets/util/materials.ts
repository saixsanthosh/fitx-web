/**
 * Material helpers and shader injections shared by the sets.
 *
 * Paint on the ground (lane lines, start lines, lane numerals, hurdle marks, bike-lane edges) is
 * computed analytically in the fragment shader from local XZ coordinates with an exact box filter,
 * so lines stay razor sharp in the 10 cm-high macro and alias-free at grazing angles, with ragged
 * edges that follow the granule height map. One program serves every painted surface; only uniforms
 * differ.
 */

import * as THREE from "three";

export const MAX_LINES = 12;

export interface LineZ {
  /** Centre x of a line that runs along Z. */
  x: number;
  halfWidth: number;
  z0: number;
  z1: number;
  color: number;
}

export interface LineX {
  /** Centre z of a line that runs along X. */
  z: number;
  halfWidth: number;
  x0: number;
  x1: number;
  color: number;
}

export interface PaintSpec {
  linesZ: LineZ[];
  linesX: LineX[];
  /** Small marks crossing every Z line: [z0, spacing, count, size] + colour. */
  marks?: Array<{ z0: number; spacing: number; count: number; size: number; color: number; lineIndices?: [number, number] }>;
  /** Lane numerals painted between z0..z1 for `lanes` lanes starting at `edgeX` with `laneWidth`. */
  numerals?: { texture: THREE.Texture; edgeX: number; laneWidth: number; lanes: number; z0: number; z1: number; halfWidth: number; color: number };
  macro: THREE.Texture;
  /** Macro variation: [scale A (1/m), scale B (1/m), albedo variation, roughness variation]. */
  macroParams: [number, number, number, number];
  paintRoughness: number;
  /** 0..1: how much paint fills the granule relief. */
  paintRelief: number;
  /** Raggedness of paint edges in meters. */
  edgeNoise: number;
}

function vec4s(count: number) {
  return Array.from({ length: count }, () => new THREE.Vector4());
}
function colors(count: number) {
  return Array.from({ length: count }, () => new THREE.Color());
}

const PAINT_HEADER = /* glsl */ `
uniform vec4 uLinesZ[${MAX_LINES}];
uniform vec3 uLinesZCol[${MAX_LINES}];
uniform int uLinesZCount;
uniform vec4 uLinesX[4];
uniform vec3 uLinesXCol[4];
uniform int uLinesXCount;
uniform vec4 uMarks[2];
uniform vec4 uMarkLines[2];
uniform vec3 uMarkCol[2];
uniform vec4 uNumRect;
uniform vec4 uNumGrid;
uniform vec3 uNumCol;
uniform sampler2D uNumerals;
uniform sampler2D uMacro;
uniform vec4 uMacroParams;
uniform float uPaintRough;
uniform float uPaintRelief;
uniform float uEdgeNoise;
varying vec2 vFitxLocal;

float fitxBox(float d, float hw, float fw) {
  fw = max(fw, 1e-6);
  float lo = max(d - 0.5 * fw, -hw);
  float hi = min(d + 0.5 * fw, hw);
  return clamp((hi - lo) / fw, 0.0, 1.0);
}

float fitxPaintAt(vec2 p, out vec3 paintCol) {
  float edge = 0.0;
  #ifdef USE_NORMALMAP
    edge = (texture2D(normalMap, vNormalMapUv).a - 0.5) * uEdgeNoise;
  #endif
  vec2 fw = fwidth(p);
  vec2 dpx = dFdx(p);
  vec2 dpy = dFdy(p);
  float paint = 0.0;
  paintCol = vec3(1.0);
  for (int i = 0; i < ${MAX_LINES}; i++) {
    if (i >= uLinesZCount) break;
    vec4 l = uLinesZ[i];
    float c = fitxBox(p.x - l.x, l.y + edge, fw.x) * fitxBox(p.y - 0.5 * (l.z + l.w), 0.5 * (l.w - l.z), fw.y);
    if (c > paint) { paint = c; paintCol = uLinesZCol[i]; }
  }
  for (int i = 0; i < 4; i++) {
    if (i >= uLinesXCount) break;
    vec4 l = uLinesX[i];
    float c = fitxBox(p.y - l.x, l.y + edge, fw.y) * fitxBox(p.x - 0.5 * (l.z + l.w), 0.5 * (l.w - l.z), fw.x);
    if (c > paint) { paint = c; paintCol = uLinesXCol[i]; }
  }
  for (int m = 0; m < 2; m++) {
    vec4 mk = uMarks[m];
    if (mk.z < 0.5) continue;
    float k = clamp(floor((p.y - mk.x) / mk.y + 0.5), 0.0, mk.z - 1.0);
    float zc = mk.x + k * mk.y;
    float cz = fitxBox(p.y - zc, mk.w * 0.5 + edge * 0.5, fw.y);
    if (cz <= 0.0) continue;
    vec4 ml = uMarkLines[m];
    for (int i = 0; i < ${MAX_LINES}; i++) {
      if (i >= uLinesZCount) break;
      if (float(i) < ml.x || float(i) > ml.y) continue;
      float c = cz * fitxBox(p.x - uLinesZ[i].x, mk.w + edge, fw.x);
      if (c > paint) { paint = c; paintCol = uMarkCol[m]; }
    }
  }
  if (uNumGrid.z > 0.5 && p.y > uNumRect.x && p.y < uNumRect.y) {
    float k = floor((p.x - uNumGrid.x) / uNumGrid.y);
    if (k >= 0.0 && k < uNumGrid.z) {
      float centre = uNumGrid.x + (k + 0.5) * uNumGrid.y;
      float hw = uNumRect.z;
      float u = (centre - p.x) / (2.0 * hw) + 0.5;
      float v = (p.y - uNumRect.x) / (uNumRect.y - uNumRect.x);
      if (u > 0.0 && u < 1.0) {
        vec2 auv = vec2((k + u) / uNumGrid.z, v);
        vec2 sx = vec2(-1.0 / (2.0 * hw * uNumGrid.z), 1.0 / (uNumRect.y - uNumRect.x));
        float a = textureGrad(uNumerals, auv, dpx * sx, dpy * sx).r;
        a = clamp(a + edge * 100.0 * a * (1.0 - a), 0.0, 1.0);
        if (a > paint) { paint = a; paintCol = uNumCol; }
      }
    }
  }
  return paint;
}
`;

const NORMAL_MAPS_PAINTED = THREE.ShaderChunk.normal_fragment_maps.replace(
  "mapN.xy *= normalScale;",
  "mapN.xy *= normalScale * (1.0 - uPaintRelief * fitxPaint);",
);

export interface PaintedGround {
  material: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
}

/**
 * MeshStandardMaterial with analytic paint. Geometry UVs must be local meters (see `groundQuad`);
 * set map/normalMap/roughnessMap repeat to 1/tile.
 */
export function createPaintedGround(parameters: THREE.MeshStandardMaterialParameters, spec: PaintSpec): PaintedGround {
  const material = new THREE.MeshStandardMaterial(parameters);
  const uniforms: Record<string, THREE.IUniform> = {
    uLinesZ: { value: vec4s(MAX_LINES) },
    uLinesZCol: { value: colors(MAX_LINES) },
    uLinesZCount: { value: 0 },
    uLinesX: { value: vec4s(4) },
    uLinesXCol: { value: colors(4) },
    uLinesXCount: { value: 0 },
    uMarks: { value: vec4s(2) },
    uMarkLines: { value: vec4s(2) },
    uMarkCol: { value: colors(2) },
    uNumRect: { value: new THREE.Vector4() },
    uNumGrid: { value: new THREE.Vector4() },
    uNumCol: { value: new THREE.Color(1, 1, 1) },
    uNumerals: { value: spec.numerals?.texture ?? spec.macro },
    uMacro: { value: spec.macro },
    uMacroParams: { value: new THREE.Vector4(...spec.macroParams) },
    uPaintRough: { value: spec.paintRoughness },
    uPaintRelief: { value: spec.paintRelief },
    uEdgeNoise: { value: spec.edgeNoise },
  };
  setPaint(uniforms, spec);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFitxLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFitxLocal = position.xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `${PAINT_HEADER}\nvoid main() {`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        vec3 fitxPaintCol;
        float fitxPaint = fitxPaintAt(vFitxLocal, fitxPaintCol);
        vec4 fitxMacro = texture2D(uMacro, vFitxLocal * uMacroParams.x);
        vec4 fitxMacro2 = texture2D(uMacro, vFitxLocal * uMacroParams.y + 0.37);
        float fitxVar = (fitxMacro.r - 0.5) + (fitxMacro2.g - 0.5) * 0.8;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        diffuseColor.rgb *= 1.0 + fitxVar * uMacroParams.z;
        diffuseColor.rgb = mix(diffuseColor.rgb, fitxPaintCol * (0.94 + 0.08 * fitxMacro.b), fitxPaint);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + fitxVar * uMacroParams.w, 0.04, 1.0);
        roughnessFactor = mix(roughnessFactor, uPaintRough, fitxPaint);`,
      )
      .replace("#include <normal_fragment_maps>", NORMAL_MAPS_PAINTED);
  };
  // Same source for every painted ground → one shared program.
  material.customProgramCacheKey = () => "fitx-painted-ground";
  return { material, uniforms };
}

export function setPaint(uniforms: Record<string, THREE.IUniform>, spec: PaintSpec) {
  const lz = uniforms.uLinesZ.value as THREE.Vector4[];
  const lzc = uniforms.uLinesZCol.value as THREE.Color[];
  spec.linesZ.slice(0, MAX_LINES).forEach((line, i) => {
    lz[i].set(line.x, line.halfWidth, line.z0, line.z1);
    lzc[i].setHex(line.color);
  });
  uniforms.uLinesZCount.value = Math.min(spec.linesZ.length, MAX_LINES);
  const lx = uniforms.uLinesX.value as THREE.Vector4[];
  const lxc = uniforms.uLinesXCol.value as THREE.Color[];
  spec.linesX.slice(0, 4).forEach((line, i) => {
    lx[i].set(line.z, line.halfWidth, line.x0, line.x1);
    lxc[i].setHex(line.color);
  });
  uniforms.uLinesXCount.value = Math.min(spec.linesX.length, 4);
  const marks = uniforms.uMarks.value as THREE.Vector4[];
  const markLines = uniforms.uMarkLines.value as THREE.Vector4[];
  const markCol = uniforms.uMarkCol.value as THREE.Color[];
  for (let m = 0; m < 2; m += 1) {
    const mark = spec.marks?.[m];
    if (!mark) {
      marks[m].set(0, 1, 0, 0);
      continue;
    }
    marks[m].set(mark.z0, mark.spacing, mark.count, mark.size);
    const range = mark.lineIndices ?? [0, MAX_LINES - 1];
    markLines[m].set(range[0], range[1], 0, 0);
    markCol[m].setHex(mark.color);
  }
  const num = spec.numerals;
  if (num) {
    (uniforms.uNumRect.value as THREE.Vector4).set(num.z0, num.z1, num.halfWidth, 0);
    (uniforms.uNumGrid.value as THREE.Vector4).set(num.edgeX, num.laneWidth, num.lanes, 0);
    (uniforms.uNumCol.value as THREE.Color).setHex(num.color);
    uniforms.uNumerals.value = num.texture;
  } else {
    (uniforms.uNumGrid.value as THREE.Vector4).set(0, 1, 0, 0);
  }
}

/**
 * Mown turf: alternating stripes whose brightness flips with view direction (blade lean), plus
 * macro variation. Geometry UVs are local meters.
 */
export function createStripedGrass(parameters: THREE.MeshStandardMaterialParameters, macro: THREE.Texture, stripeWidth = 5.5): { material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform> } {
  const material = new THREE.MeshStandardMaterial(parameters);
  const uniforms: Record<string, THREE.IUniform> = {
    uMacro: { value: macro },
    uStripe: { value: stripeWidth },
    uStripeStrength: { value: 0.22 },
    uBladeDir: { value: new THREE.Vector3(1, 0, 0) },
    uBladeTilt: { value: 0.0 },
    uTranslucency: { value: 0.0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFitxLocal;\nvarying vec3 vFitxWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFitxLocal = position.xz;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvFitxWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform sampler2D uMacro;
        uniform float uStripe;
        uniform float uStripeStrength;
        uniform vec3 uBladeDir;
        uniform float uBladeTilt;
        uniform float uTranslucency;
        varying vec2 vFitxLocal;
        varying vec3 vFitxWorld;
        void main() {`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // Grass is a forest of near-vertical blades: a low sun lights it far more than a flat plane.
        normal = normalize(normal + uBladeTilt * normalize((viewMatrix * vec4(uBladeDir, 0.0)).xyz));`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#if NUM_DIR_LIGHTS > 0
        {
          vec3 V = normalize(vViewPosition);
          float back = pow(max(dot(-V, directionalLights[0].direction), 0.0), 3.0);
          outgoingLight += diffuseColor.rgb * directionalLights[0].color * back * uTranslucency;
        }
        #endif
        #include <opaque_fragment>`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          float s = vFitxLocal.y / (2.0 * uStripe);
          float fw = fwidth(s) * 2.0;
          float tri = abs(fract(s) - 0.5) * 2.0;
          float band = smoothstep(0.5 - fw, 0.5 + fw, tri) * 2.0 - 1.0;
          vec3 v = normalize(cameraPosition - vFitxWorld);
          float lean = clamp(v.z * 1.4, -1.0, 1.0);
          vec4 m = texture2D(uMacro, vFitxLocal * 0.031);
          vec4 m2 = texture2D(uMacro, vFitxLocal * 0.0073 + 0.5);
          diffuseColor.rgb *= 1.0 + band * lean * uStripeStrength + (m.r - 0.5) * 0.35 + (m2.g - 0.5) * 0.3;
        }`,
      );
  };
  material.customProgramCacheKey = () => "fitx-striped-grass";
  return { material, uniforms };
}

/**
 * Thin glass without a transmission pass: low base opacity rising with Fresnel at grazing angles,
 * so rims read dense and faces stay clear; reflections come from the environment.
 */
export function createGlass(parameters: THREE.MeshPhysicalMaterialParameters & { edgeOpacity?: number } = {}): THREE.MeshPhysicalMaterial {
  const { edgeOpacity = 0.55, ...rest } = parameters;
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    // ≥ 0.1: a mirror-sharp GGX peak under the 6–9 unit sun overflows half-float (Inf → black bloom).
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.2,
    specularIntensity: 1,
    ior: 1.5,
    ...rest,
  });
  const edge = { value: edgeOpacity };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEdgeOpacity = edge;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uEdgeOpacity;\nvoid main() {")
      .replace(
        "#include <opaque_fragment>",
        `{
          float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
          float fres = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.0);
          // Reflections stay visible (alpha follows reflected energy); faces stay clear.
          diffuseColor.a = clamp(mix(diffuseColor.a, uEdgeOpacity, fres) + max(max(totalSpecular.r, totalSpecular.g), totalSpecular.b) * 0.9, 0.0, 1.0);
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "fitx-glass";
  return material;
}

/** Unlit emissive surface (lamps, light bars, windows). HDR intensity > 1 blooms. */
export function createEmitter(color: number, intensity: number, parameters: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color, ...parameters });
  material.userData.baseColor = color;
  setEmitter(material, color, intensity);
  return material;
}

export function setEmitter(material: THREE.MeshBasicMaterial, color: number, intensity: number) {
  material.color.setHex(color).multiplyScalar(intensity);
}

/** Lit material shorthand with vertex colours on (batched geometry carries the tints). */
export function vcStandard(parameters: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, ...parameters });
}

export function vcPhysical(parameters: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ vertexColors: true, ...parameters });
}

/** Assigns one ORM texture to the AO/roughness/metalness slots. */
export function useOrm(material: THREE.MeshStandardMaterial, orm: THREE.Texture, slots: { ao?: boolean; roughness?: boolean; metalness?: boolean } = { roughness: true }) {
  if (slots.ao) material.aoMap = orm;
  if (slots.roughness) material.roughnessMap = orm;
  if (slots.metalness) material.metalnessMap = orm;
}
