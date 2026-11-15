"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import styles from "./FitxIntroScene.module.css";

type Theme = "light" | "dark";

type Props = {
  theme: Theme;
  onStage: (stage: number) => void;
  onReady: () => void;
  onComplete: () => void;
  onUnsupported: () => void;
};

type ThemePalette = {
  background: number;
  floor: number;
  shoe: number;
  panel: number;
  rubber: number;
  frame: number;
  metal: number;
  accent: number;
};

const palettes: Record<Theme, ThemePalette> = {
  light: {
    background: 0xf7f7f4,
    floor: 0xf2f2ee,
    // The light-theme upper needs enough tonal separation from the warm-white
    // studio to read as a shoe in the opening macro and the camera pass.
    shoe: 0x374039,
    panel: 0xc7cec8,
    rubber: 0x262b27,
    frame: 0x48524c,
    metal: 0x838d86,
    accent: 0xc44933,
  },
  dark: {
    background: 0x151715,
    floor: 0x050705,
    shoe: 0xe6e8e2,
    panel: 0xa6ada6,
    rubber: 0x171a18,
    frame: 0xc2c9c1,
    metal: 0xa5ada6,
    accent: 0xed725c,
  },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smooth = (value: number) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

function mat(color: number, role: keyof ThemePalette, roughness = 0.62, metalness = 0.04) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  material.userData.fitxRole = role;
  return material;
}

function knitRoughnessTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#c5c5c5";
  context.fillRect(0, 0, 128, 128);
  context.strokeStyle = "#777";
  context.lineWidth = 1;
  for (let i = -128; i < 256; i += 5) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i + 128, 128);
    context.stroke();
  }
  context.strokeStyle = "#eee";
  for (let i = -128; i < 256; i += 9) {
    context.beginPath();
    context.moveTo(i, 128);
    context.lineTo(i + 128, 0);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  texture.anisotropy = 4;
  return texture;
}

function rod(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material, radialSegments = 12) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeShoe() {
  const group = new THREE.Group();
  const upperMat = mat(palettes.light.shoe, "shoe", 0.55);
  upperMat.roughnessMap = knitRoughnessTexture();
  const soleMat = mat(palettes.light.rubber, "rubber", 0.84);
  const accentMat = mat(palettes.light.accent, "accent", 0.46, 0.1);
  const laceMat = mat(0x69716c, "metal", 0.7);
  const panelMat = mat(palettes.light.panel, "panel", 0.6);

  const addProfile = (shape: THREE.Shape, depth: number, material: THREE.Material, bevelSize: number) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 5,
      bevelSize,
      bevelThickness: bevelSize,
      curveSegments: 32,
    });
    geometry.translate(0, 0, -depth / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Side-profile extrusions create a readable heel, curved toe, midsole, and upper.
  const outsole = new THREE.Shape();
  outsole.moveTo(-1.12, 0.065);
  outsole.quadraticCurveTo(-0.66, 0.015, -0.16, 0.075);
  outsole.quadraticCurveTo(0.55, 0.045, 1.08, 0.16);
  outsole.quadraticCurveTo(1.27, 0.205, 1.21, 0.29);
  outsole.lineTo(-0.94, 0.29);
  outsole.quadraticCurveTo(-1.22, 0.245, -1.12, 0.065);
  outsole.closePath();
  addProfile(outsole, 0.68, soleMat, 0.035);

  const cushioning = new THREE.Shape();
  cushioning.moveTo(-1.02, 0.22);
  cushioning.quadraticCurveTo(-0.28, 0.17, 0.42, 0.2);
  cushioning.quadraticCurveTo(0.95, 0.21, 1.17, 0.27);
  cushioning.lineTo(1.17, 0.315);
  cushioning.quadraticCurveTo(0.38, 0.265, -0.96, 0.31);
  cushioning.closePath();
  // The slightly proud midsole edge catches the coral key light as a narrow
  // signature stripe instead of disappearing inside the graphite outsole.
  addProfile(cushioning, 0.76, accentMat, 0.01);

  const upper = new THREE.Shape();
  upper.moveTo(-1.02, 0.245);
  upper.quadraticCurveTo(-1.0, 0.42, -0.81, 0.55);
  upper.lineTo(-0.66, 0.68);
  upper.quadraticCurveTo(-0.47, 0.74, -0.34, 0.61);
  upper.lineTo(-0.17, 0.435);
  upper.quadraticCurveTo(0.15, 0.51, 0.48, 0.49);
  upper.quadraticCurveTo(0.92, 0.47, 1.13, 0.36);
  upper.quadraticCurveTo(1.24, 0.31, 1.2, 0.245);
  upper.closePath();
  addProfile(upper, 0.57, upperMat, 0.027);

  const heelPanel = new THREE.Shape();
  heelPanel.moveTo(-0.99, 0.29);
  heelPanel.quadraticCurveTo(-0.96, 0.46, -0.79, 0.54);
  heelPanel.lineTo(-0.62, 0.65);
  heelPanel.lineTo(-0.54, 0.52);
  heelPanel.lineTo(-0.66, 0.32);
  heelPanel.closePath();
  const heelPanelMesh = new THREE.Mesh(new THREE.ShapeGeometry(heelPanel, 18), accentMat);
  heelPanelMesh.position.z = 0.295;
  heelPanelMesh.castShadow = true;
  group.add(heelPanelMesh);

  const sideMark = new THREE.Shape();
  sideMark.moveTo(-0.39, 0.32);
  sideMark.quadraticCurveTo(0.16, 0.4, 0.82, 0.36);
  sideMark.lineTo(0.61, 0.305);
  sideMark.quadraticCurveTo(0.05, 0.345, -0.39, 0.32);
  sideMark.closePath();
  const sideMarkMesh = new THREE.Mesh(new THREE.ShapeGeometry(sideMark, 20), panelMat);
  sideMarkMesh.position.z = 0.298;
  group.add(sideMarkMesh);

  // Fine stitched piping and an inset toe overlay give the upper a layered,
  // tactile construction without adding a downloaded or branded shoe model.
  const seamMat = mat(0xa7ada6, "metal", 0.72);
  const seamPoints = [
    [-0.84, 0.56, 0.304], [-0.63, 0.65, 0.304], [-0.39, 0.58, 0.304],
    [-0.13, 0.44, 0.304], [0.27, 0.48, 0.304], [0.69, 0.45, 0.304], [1.01, 0.38, 0.304],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const seam = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPoints), 36, 0.007, 5, false), seamMat);
  group.add(seam);
  const toeGuard = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), panelMat);
  toeGuard.scale.set(0.38, 0.11, 0.29);
  toeGuard.position.set(0.86, 0.31, 0);
  toeGuard.rotation.z = -0.1;
  toeGuard.castShadow = true;
  group.add(toeGuard);

  for (let i = 0; i < 7; i += 1) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.012), laceMat);
    groove.position.set(-0.77 + i * 0.29, 0.115, 0.35);
    groove.rotation.z = i > 4 ? -0.15 : 0;
    group.add(groove);
  }

  const eyeletPositions = [-0.2, -0.04, 0.12, 0.28, 0.44];
  eyeletPositions.forEach((x, index) => {
    const y = 0.48 + (index < 2 ? (index * 0.035) : (4 - index) * 0.035);
    const eyelet = new THREE.Mesh(new THREE.CircleGeometry(0.024, 14), laceMat);
    eyelet.position.set(x, y, 0.307);
    group.add(eyelet);
    if (index < eyeletPositions.length - 1) {
      const nextX = eyeletPositions[index + 1];
      const nextY = 0.48 + (index < 1 ? ((index + 1) * 0.035) : (4 - (index + 1)) * 0.035);
      rod(group, new THREE.Vector3(x, y, 0.312), new THREE.Vector3(nextX, nextY, 0.312), 0.014, laceMat, 8);
    }
  });

  return group;
}

function makeWheel(radius: number, rubber: THREE.Material, metal: THREE.Material) {
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.052, 12, 64), rubber);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.085, 0.017, 8, 64), metal);
  tire.castShadow = true;
  wheel.add(tire, rim);
  const spokePositions: number[] = [];
  for (let i = 0; i < 28; i += 1) {
    const angle = (i / 28) * Math.PI * 2;
    const crossing = angle + (i % 2 === 0 ? 0.18 : -0.18);
    const z = i % 2 === 0 ? 0.025 : -0.025;
    spokePositions.push(
      Math.cos(angle) * 0.075, Math.sin(angle) * 0.075, z,
      Math.cos(crossing) * (radius - 0.07), Math.sin(crossing) * (radius - 0.07), z,
    );
  }
  const spokesGeometry = new THREE.BufferGeometry();
  spokesGeometry.setAttribute("position", new THREE.Float32BufferAttribute(spokePositions, 3));
  wheel.add(new THREE.LineSegments(spokesGeometry, new THREE.LineBasicMaterial({ color: 0xb9c0bb, transparent: true, opacity: 0.78 })));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 16), metal);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.018;
  wheel.add(hub);

  const treadGeometry = new THREE.BoxGeometry(0.035, 0.068, 0.038);
  const tread = new THREE.InstancedMesh(treadGeometry, rubber, 32);
  const treadPose = new THREE.Object3D();
  for (let i = 0; i < tread.count; i += 1) {
    const angle = (i / tread.count) * Math.PI * 2;
    treadPose.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    treadPose.rotation.set(0, 0, angle + Math.PI / 2);
    treadPose.updateMatrix();
    tread.setMatrixAt(i, treadPose.matrix);
  }
  tread.instanceMatrix.needsUpdate = true;
  tread.castShadow = true;
  wheel.add(tread);
  return wheel;
}

function makeBike() {
  const group = new THREE.Group();
  const frameMat = mat(palettes.light.frame, "frame", 0.34, 0.42);
  const metalMat = mat(palettes.light.metal, "metal", 0.3, 0.72);
  const rubberMat = mat(palettes.light.rubber, "rubber", 0.88);
  const accentMat = mat(palettes.light.accent, "accent", 0.34, 0.3);
  const rear = new THREE.Vector3(-1.02, 0.88, 0);
  const front = new THREE.Vector3(1.02, 0.88, 0);
  const crank = new THREE.Vector3(-0.12, 0.88, 0.02);
  const seat = new THREE.Vector3(-0.48, 1.58, 0);
  const head = new THREE.Vector3(0.66, 1.53, 0);

  const rearWheel = makeWheel(0.78, rubberMat, metalMat);
  rearWheel.position.copy(rear);
  const frontWheel = makeWheel(0.78, rubberMat, metalMat);
  frontWheel.position.copy(front);
  group.add(rearWheel, frontWheel);

  // A triangulated road frame with fork, stays, headset, and visible contact points.
  rod(group, rear, seat, 0.045, frameMat);
  rod(group, seat, crank, 0.049, frameMat);
  rod(group, crank, rear, 0.037, frameMat);
  rod(group, seat, head, 0.043, accentMat);
  rod(group, head, crank, 0.052, frameMat);
  rod(group, head, front, 0.034, metalMat);
  rod(group, rear, crank, 0.018, metalMat);

  const seatPost = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.62, 12), metalMat);
  seatPost.position.set(seat.x + 0.03, seat.y + 0.27, 0);
  seatPost.rotation.z = -0.14;
  group.add(seatPost);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.2), rubberMat);
  saddle.position.set(seat.x - 0.03, 1.96, 0);
  saddle.rotation.z = -0.06;
  saddle.castShadow = true;
  group.add(saddle);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.38, 12), metalMat);
  stem.position.set(0.72, 1.72, 0);
  stem.rotation.z = -0.12;
  group.add(stem);
  rod(group, new THREE.Vector3(0.42, 1.92, 0.01), new THREE.Vector3(0.98, 1.92, 0.01), 0.035, rubberMat);
  rod(group, new THREE.Vector3(0.43, 1.92, 0.01), new THREE.Vector3(0.36, 1.78, 0.01), 0.03, rubberMat);
  rod(group, new THREE.Vector3(0.97, 1.92, 0.01), new THREE.Vector3(1.04, 1.78, 0.01), 0.03, rubberMat);

  const chainRing = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 8, 40), metalMat);
  chainRing.position.copy(crank);
  chainRing.position.z = 0.09;
  group.add(chainRing);
  const sprocket = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 32), metalMat);
  sprocket.position.set(rear.x, rear.y, 0.08);
  group.add(sprocket);
  const chainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(rear.x, rear.y + 0.12, 0.1),
    new THREE.Vector3(-0.54, 1.12, 0.1),
    new THREE.Vector3(crank.x, crank.y + 0.25, 0.1),
    new THREE.Vector3(crank.x, crank.y - 0.25, 0.1),
    new THREE.Vector3(-0.62, 0.67, 0.1),
    new THREE.Vector3(rear.x, rear.y - 0.12, 0.1),
  ], true);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(chainCurve, 64, 0.014, 5, true), metalMat));

  const crankset = new THREE.Group();
  crankset.position.copy(crank);
  crankset.position.z = 0.13;
  for (const direction of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.045), metalMat);
    arm.position.y = direction * 0.2;
    crankset.add(arm);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.09), rubberMat);
    pedal.position.set(0, direction * 0.41, 0);
    crankset.add(pedal);
  }
  group.add(crankset);

  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.42, 12), accentMat);
  bottle.position.set(0.1, 1.27, 0.08);
  bottle.rotation.z = 0.3;
  group.add(bottle);

  return { group, rearWheel, frontWheel, crankset };
}

function makePlate(material: THREE.Material, radius: number, depth: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.105, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.018, bevelThickness: 0.018, curveSegments: 48 });
  geometry.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function makeRack() {
  const group = new THREE.Group();
  const rackMat = mat(palettes.light.frame, "frame", 0.36, 0.56);
  const barMat = mat(palettes.light.metal, "metal", 0.25, 0.78);
  const plateMat = mat(palettes.light.accent, "accent", 0.48, 0.16);
  const rubberMat = mat(palettes.light.rubber, "rubber", 0.82);
  const barbell = new THREE.Group();

  for (const x of [-1.25, 1.25]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.55, 0.15), rackMat);
    post.position.set(x, 1.28, 0);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.62), rackMat);
    foot.position.set(x, 0.07, 0);
    group.add(foot);
    for (let i = 0; i < 7; i += 1) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.24, 10), barMat);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(x, 0.44 + i * 0.27, 0.14);
      group.add(peg);
    }
  }

  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.12, 0.16), rackMat);
  crossbar.position.set(0, 2.48, 0);
  group.add(crossbar);
  const rearBrace = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.09, 0.09), barMat);
  rearBrace.position.set(0, 0.12, -0.26);
  group.add(rearBrace);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.5, 24), barMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(0, 0.84, 0.16);
  barbell.add(shaft);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i += 1) {
      const plate = makePlate(plateMat, i === 0 ? 0.35 : 0.29, 0.11);
      plate.rotation.y = Math.PI / 2;
      plate.position.set(side * (1.18 + i * 0.16), 0.84, 0.16);
      barbell.add(plate);
    }
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 16), rubberMat);
    collar.rotation.z = Math.PI / 2;
    collar.position.set(side * 1.53, 0.84, 0.16);
    barbell.add(collar);
  }
  group.add(barbell);

  return { group, barbell };
}

type CameraStop = { time: number; position: THREE.Vector3; target: THREE.Vector3 };

function cameraAt(time: number, stops: CameraStop[]) {
  let index = 0;
  while (index < stops.length - 2 && time > stops[index + 1].time) index += 1;
  const from = stops[index];
  const to = stops[index + 1];
  const t = smooth((time - from.time) / (to.time - from.time));
  return {
    position: from.position.clone().lerp(to.position, t),
    target: from.target.clone().lerp(to.target, t),
  };
}

/** Original, procedural studio subjects choreographed as one connected shot. */
export function FitxIntroScene({ theme, onStage, onReady, onComplete, onUnsupported }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onStage, onReady, onComplete, onUnsupported });
  const themeRef = useRef(theme);

  useEffect(() => {
    callbacks.current = { onStage, onReady, onComplete, onUnsupported };
    themeRef.current = theme;
  }, [onStage, onReady, onComplete, onUnsupported, theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let composer: EffectComposer | null = null;
    let bokeh: BokehPass | null = null;
    let animationFrame = 0;
    let stopped = false;
    let failed = false;
    let readySent = false;
    let elapsed = 0;
    let previousTime = 0;
    let currentStage = -1;
    const fpsSamples: number[] = [];
    let lastTheme: Theme | null = null;
    let scene: THREE.Scene | null = null;
    let environmentTexture: THREE.Texture | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeHandler: (() => void) | null = null;
    let visibilityHandler: (() => void) | null = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const fallback = (reason?: string) => {
      if (failed || stopped) return;
      failed = true;
      stopped = true;
      if (reason && process.env.NODE_ENV !== "production") console.warn("[FITX intro] Switching to the visible static brand fallback:", reason);
      callbacks.current.onUnsupported();
    };

    const contextLost = (event: Event) => {
      event.preventDefault();
      fallback("WebGL context lost");
    };

    const checkLowPower = () => {
      const navigatorWithHints = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
      const memoryTooLow = typeof navigatorWithHints.deviceMemory === "number" && navigatorWithHints.deviceMemory <= 2;
      const cpuTooLow = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2;
      const connectionTooSlow = navigatorWithHints.connection?.effectiveType === "slow-2g" || navigatorWithHints.connection?.effectiveType === "2g";
      return memoryTooLow || cpuTooLow || connectionTooSlow;
    };

    if (reducedMotion.matches || checkLowPower()) {
      fallback();
      return () => { stopped = true; };
    }

    const reducedMotionChanged = () => {
      if (reducedMotion.matches) fallback();
    };

    const initialize = () => {
      try {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 600 ? 1 : 1.4);
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;

        scene = new THREE.Scene();
        const mobile = window.innerWidth < 600;
        const camera = new THREE.PerspectiveCamera(mobile ? 42 : 35, window.innerWidth / window.innerHeight, 0.1, 80);
        camera.position.set(-2.6, 2.05, 8.8);
        camera.lookAt(0, 0.42, 0);

        const room = new RoomEnvironment();
        const pmrem = new THREE.PMREMGenerator(renderer);
        environmentTexture = pmrem.fromScene(room, 0.035).texture;
        scene.environment = environmentTexture;
        scene.environmentIntensity = 0.44;
        pmrem.dispose();

        const hemisphere = new THREE.HemisphereLight(0xfffbf4, 0x454945, 1.65);
        scene.add(hemisphere);
        const keyLight = new THREE.DirectionalLight(0xfff4e8, 3.1);
        keyLight.position.set(-4.3, 8.5, 4.5);
        keyLight.castShadow = true;
        keyLight.shadow.radius = 4;
        keyLight.shadow.intensity = 0.72;
        keyLight.shadow.mapSize.set(window.innerWidth < 600 ? 512 : 1024, window.innerWidth < 600 ? 512 : 1024);
        keyLight.shadow.camera.left = -8;
        keyLight.shadow.camera.right = 8;
        keyLight.shadow.camera.top = 7;
        keyLight.shadow.camera.bottom = -4;
        keyLight.shadow.bias = -0.0003;
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0xd8e0ff, 1.45);
        rimLight.position.set(3.5, 4.2, -4.8);
        scene.add(rimLight);
        const coralEdge = new THREE.PointLight(palettes.light.accent, 1.5, 9, 1.8);
        coralEdge.position.set(-0.1, 0.62, 2.8);
        scene.add(coralEdge);

        const backdropMaterial = new THREE.MeshBasicMaterial({ color: palettes.light.background, toneMapped: false });
        const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(220, 90), backdropMaterial);
        backdrop.position.set(0, 30, -30);
        scene.add(backdrop);

        const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mat(palettes.light.floor, "floor", 0.72, 0.06));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.04;
        ground.receiveShadow = true;
        scene.add(ground);
        scene.fog = new THREE.Fog(palettes.light.background, 12, 31);

        const studioArc = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-4.1, 0.035, 1.05),
          new THREE.Vector3(-2.2, 0.045, 0.84),
          new THREE.Vector3(-0.2, 0.035, 0.7),
          new THREE.Vector3(1.5, 0.045, 0.38),
          new THREE.Vector3(1.8, 0.035, -0.65),
          new THREE.Vector3(0, 0.045, -1.1),
          new THREE.Vector3(-2.4, 0.035, -0.8),
        ]);
        const arcMaterial = new THREE.MeshBasicMaterial({ color: palettes.light.accent, transparent: true, opacity: 0.46, toneMapped: false });
        const studioTrail = new THREE.Mesh(new THREE.TubeGeometry(studioArc, 160, 0.008, 5, false), arcMaterial);
        scene.add(studioTrail);

        const dustPositions = new Float32Array(18 * 3);
        for (let index = 0; index < 18; index += 1) {
          dustPositions[index * 3] = (Math.random() - 0.5) * 9;
          dustPositions[index * 3 + 1] = 0.55 + Math.random() * 2.4;
          dustPositions[index * 3 + 2] = (Math.random() - 0.5) * 4;
        }
        const dustGeometry = new THREE.BufferGeometry();
        dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
        const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xe8e4dc, size: 0.026, transparent: true, opacity: 0.24, depthWrite: false }));
        scene.add(dust);

        const shoe = makeShoe();
        shoe.position.set(0, 0.02, 0);
        shoe.rotation.set(-0.08, -0.14, -0.035);
        const bikeParts = makeBike();
        bikeParts.group.position.set(0, 0, 0);
        bikeParts.group.rotation.y = -0.06;
        const rackParts = makeRack();
        rackParts.group.position.set(0, 0, 0);
        scene.add(shoe, bikeParts.group, rackParts.group);

        shoe.visible = false;
        bikeParts.group.visible = false;
        rackParts.group.visible = false;

        const allMaterials: THREE.Material[] = [];
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!allMaterials.includes(material)) allMaterials.push(material);
          }
        });

        const updateTheme = (mode: Theme) => {
          const palette = palettes[mode];
          backdropMaterial.color.setHex(palette.background);
          arcMaterial.color.setHex(palette.accent);
          dust.material.color.setHex(mode === "dark" ? 0xf0ede5 : 0x747b74);
          for (const material of allMaterials) {
            const role = (material.userData.fitxRole || "metal") as keyof ThemePalette;
            if (material instanceof THREE.MeshStandardMaterial) {
              material.color.setHex(palette[role]);
              if (role === "accent") material.emissive.setHex(palette.accent).multiplyScalar(mode === "dark" ? 0.07 : 0.018);
              else material.emissive.setHex(0x000000);
            }
          }
          if (scene?.fog instanceof THREE.Fog) scene.fog.color.setHex(palette.background);
          keyLight.intensity = mode === "dark" ? 4.2 : 3.5;
          hemisphere.intensity = mode === "dark" ? 2.55 : 2.2;
          lastTheme = mode;
        };
        updateTheme(themeRef.current);

        const resize = () => {
          if (!renderer) return;
          const width = Math.max(1, window.innerWidth);
          const height = Math.max(1, window.innerHeight);
          camera.aspect = width / height;
          camera.fov = width < 600 ? 42 : 35;
          camera.updateProjectionMatrix();
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 600 ? 1 : 1.4));
          renderer.setSize(width, height, false);
          keyLight.shadow.mapSize.set(width < 600 ? 512 : 1024, width < 600 ? 512 : 1024);
          if (composer) composer.setSize(width, height);
        };
        resizeHandler = resize;

        const visibilityChanged = () => {
          if (document.hidden) {
            if (animationFrame) window.cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            previousTime = 0;
          } else if (!stopped && !animationFrame) {
            previousTime = 0;
            animationFrame = window.requestAnimationFrame(draw);
          }
        };
        visibilityHandler = visibilityChanged;

        const draw = (time: number) => {
          animationFrame = 0;
          if (stopped || document.hidden || !renderer || !scene) return;
          const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
          previousTime = time;
          elapsed += delta;

          if (themeRef.current !== lastTheme) updateTheme(themeRef.current);

          const nextStage = elapsed < 1.5 ? 0 : elapsed < 3.18 ? 1 : elapsed < 4.5 ? 2 : 3;
          if (nextStage !== currentStage) {
            currentStage = nextStage;
            callbacks.current.onStage(nextStage);
          }

          // Subjects enter and leave behind frame-filling macro passes. Their
          // silhouettes hide the match cuts, so scenes don't dissolve like slides.
          shoe.visible = elapsed < 1.49;
          bikeParts.group.visible = elapsed >= 1.48 && elapsed < 3.17;
          rackParts.group.visible = elapsed >= 3.16 && elapsed < 4.5;

          const impact = Math.max(0, 1 - smooth((elapsed - 0.66) / 0.26));
          const footfall = elapsed * 8.8;
          shoe.position.y = 0.055 + Math.abs(Math.sin(footfall)) * 0.075 * impact;
          shoe.rotation.z = -0.035 + Math.sin(footfall) * 0.026 * impact;
          shoe.rotation.y = -0.14 + Math.sin(elapsed * 1.45) * 0.035;

          bikeParts.rearWheel.rotation.z = -elapsed * 5.4;
          bikeParts.frontWheel.rotation.z = -elapsed * 5.4;
          bikeParts.crankset.rotation.z = -elapsed * 5.4;
          bikeParts.group.rotation.y = -0.05 + Math.sin(elapsed * 0.8) * 0.025;

          const lift = smooth((elapsed - 3.68) / 0.42) * (1 - smooth((elapsed - 4.48) / 0.38));
          rackParts.barbell.position.y = 0.84 + lift * 0.62;
          rackParts.group.rotation.y = Math.sin(elapsed * 0.38) * 0.01;

          const narrow = window.innerWidth < 600;
          const stops: CameraStop[] = [
            { time: 0, position: new THREE.Vector3(-2.6, 2.05, 8.8), target: new THREE.Vector3(0, 0.42, 0) },
            { time: 0.9, position: new THREE.Vector3(-0.8, 1.25, 5), target: new THREE.Vector3(0.05, 0.48, 0) },
            { time: 1.49, position: new THREE.Vector3(1.02, 0.9, 1.16), target: new THREE.Vector3(1.02, 0.88, 0) },
            { time: 1.76, position: new THREE.Vector3(0.15, 2.3, narrow ? 12.2 : 8.3), target: new THREE.Vector3(0, 1.02, 0) },
            { time: 2.56, position: new THREE.Vector3(narrow ? 0.15 : 0.65, narrow ? 2.05 : 1.62, narrow ? 11.8 : 6.8), target: new THREE.Vector3(0, 1, 0) },
            { time: 3.17, position: new THREE.Vector3(1.38, 0.84, 1.18), target: new THREE.Vector3(1.38, 0.84, 0.12) },
            { time: 3.47, position: new THREE.Vector3(0, 2.55, narrow ? 12 : 10.3), target: new THREE.Vector3(0, 1.18, 0) },
            { time: 4.24, position: new THREE.Vector3(-1.05, 2.05, narrow ? 10.8 : 7.8), target: new THREE.Vector3(0, 1.05, 0) },
            { time: 4.84, position: new THREE.Vector3(0, 2.35, narrow ? 11 : 8.2), target: new THREE.Vector3(0, 1.2, 0) },
          ];
          const framing = cameraAt(elapsed, stops);
          camera.position.copy(framing.position);
          camera.lookAt(framing.target);
          if (bokeh) {
            const focusUniform = (bokeh as unknown as { uniforms: Record<string, { value: number }> }).uniforms.focus;
            focusUniform.value = camera.position.distanceTo(framing.target);
          }
          arcMaterial.opacity = elapsed < 4.72 ? 0.36 : 0.36 * (1 - smooth((elapsed - 4.72) / 0.2));
          coralEdge.intensity = elapsed > 4.15 ? 1.5 * (1 - smooth((elapsed - 4.65) / 0.23)) : 1.5;

          if (composer) composer.render(delta);
          else renderer.render(scene, camera);

          if (!readySent) {
            scene.updateMatrixWorld(true);
            camera.updateMatrixWorld(true);
            const subject = elapsed < 1.49 ? shoe : elapsed < 3.17 ? bikeParts.group : rackParts.group;
            const subjectBounds = new THREE.Box3().setFromObject(subject);
            const frustum = new THREE.Frustum().setFromProjectionMatrix(
              new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
            );
            if (subject.visible && !subjectBounds.isEmpty() && frustum.intersectsBox(subjectBounds)) {
              readySent = true;
              callbacks.current.onReady();
            }
          }

          if (elapsed > 1.35) {
            fpsSamples.push(delta);
            if (fpsSamples.length > 30) fpsSamples.shift();
            if (fpsSamples.length === 30) {
              const averageFrame = fpsSamples.reduce((sum, frame) => sum + frame, 0) / fpsSamples.length;
              if (averageFrame > 0.048) {
                fallback("render rate fell below the intro target");
                return;
              }
            }
          }

          if (elapsed >= 6.12) {
            if (process.env.NODE_ENV !== "production" && fpsSamples.length > 0) {
              const averageFrame = fpsSamples.reduce((sum, frame) => sum + frame, 0) / fpsSamples.length;
              console.info(
                "[FITX intro] average ", Math.round(1000 / averageFrame), " fps at DPR ",
                renderer.getPixelRatio(), " on ", window.innerWidth + "x" + window.innerHeight,
              );
            }
            callbacks.current.onComplete();
            return;
          }
          animationFrame = window.requestAnimationFrame(draw);
        };

        canvas.addEventListener("webglcontextlost", contextLost);
        reducedMotion.addEventListener("change", reducedMotionChanged);
        document.addEventListener("visibilitychange", visibilityChanged);
        window.addEventListener("resize", resize);
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(canvas);
        }
        if (!mobile && !checkLowPower()) {
          composer = new EffectComposer(renderer);
          composer.addPass(new RenderPass(scene, camera));
          bokeh = new BokehPass(scene, camera, { focus: 6, aperture: 0.00011, maxblur: 0.0018 });
          composer.addPass(bokeh);
          composer.addPass(new OutputPass());
          composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.2));
          composer.setSize(window.innerWidth, window.innerHeight);
        }
        animationFrame = window.requestAnimationFrame(draw);
      } catch (error) {
        fallback(error instanceof Error ? error.message : "renderer initialization failed");
      }
    };

    initialize();

    return () => {
      stopped = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      canvas.removeEventListener("webglcontextlost", contextLost);
      reducedMotion.removeEventListener("change", reducedMotionChanged);
      resizeObserver?.disconnect();
      if (scene) {
        const textures = new Set<THREE.Texture>();
        scene.traverse((object) => {
          const withGeometry = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
          withGeometry.geometry?.dispose();
          const materials = Array.isArray(withGeometry.material) ? withGeometry.material : withGeometry.material ? [withGeometry.material] : [];
          materials.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial && material.roughnessMap) textures.add(material.roughnessMap);
            material.dispose();
          });
        });
        textures.forEach((texture) => texture.dispose());
      }
      environmentTexture?.dispose();
      bokeh?.dispose();
      composer?.dispose();
      renderer?.dispose();
      renderer = null;
      scene = null;
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
