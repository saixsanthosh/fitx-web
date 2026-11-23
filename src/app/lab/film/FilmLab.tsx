"use client";

/**
 * The film lab's page body: one canvas and `window.__fitxLab`, which `scripts/brand/films/render.mjs` drives. No DOM
 * overlay (titles, callouts and the end card are the runtime's, not the film's). Films come only through
 * `FILM_DEFS`, so this file never imports a film's own modules.
 *
 *   load({ film, comp, theme, width?, height?, ss?, sink? })  builds the director at the exact render size
 *   seek(t)      renders film time t; resolves after the frame rendered, rejects when it could not (no cast)
 *   grab()       POSTs the last frame's raw RGBA (bottom-up rows, read in the same task as the render) to the sink
 *   frame(t)     seek(t) then grab(), in one call
 *   status()     the GPU renderer string, the quality, the cast and the size
 *   project(t)   seek(t), then the frame's subject boxes projected to normalised device coordinates
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { COMPOSITIONS, pickComposition, type FilmComposition, type FilmId } from "@/components/brand/films/compositions";
import { createFilmDirector, type FilmFrameInfo, type IntroDirector } from "@/components/brand/intro/director/film-def";
import { FILM_DEFS, describeFilm, type FilmDescription } from "@/components/brand/intro/director/film-defs";
import { LAB_QUALITY } from "@/components/brand/intro/fx/quality";

type LoadArgs = {
  film: FilmId;
  comp: FilmComposition;
  theme: "dark" | "light";
  /** Output size; the composition's render size when left out. */
  width?: number;
  height?: number;
  /** Supersampling: the frame renders at the output size times this (the driver scales it down with lanczos). */
  ss?: number;
  /** The driver's 127.0.0.1 sink (`http://127.0.0.1:<port>`); without one, the driver takes screenshots instead. */
  sink?: string | null;
};

type Loaded = {
  film: FilmDescription;
  comp: FilmComposition;
  theme: "dark" | "light";
  width: number;
  height: number;
  renderer: string;
  vendor: string;
  quality: IntroDirector["quality"];
};

type ProjectedSubject = { id: string; must: boolean; ndc: [number, number, number][] };

export type FitxLab = {
  load(args: LoadArgs): Promise<Loaded>;
  seek(time: number): Promise<{ time: number; shot: string; ms: number }>;
  grab(): Promise<{ time: number; bytes: number; ms: number }>;
  frame(time: number): Promise<{ time: number; shot: string; renderMs: number; grabMs: number }>;
  status(): Record<string, unknown>;
  project(time: number): Promise<{ time: number; shot: string; subjects: ProjectedSubject[] | null }>;
};

declare global {
  interface Window {
    __fitxLab?: FitxLab;
  }
}

function rendererInfo(gl: WebGL2RenderingContext | null) {
  if (!gl) return { renderer: "", vendor: "" };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const vendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  return { renderer: String(renderer ?? ""), vendor: String(vendor ?? "") };
}

export default function FilmLab() {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    let director: IntroDirector | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let loaded: Loaded | null = null;
    let sink: string | null = null;
    let pixels: Uint8Array<ArrayBuffer> | null = null;
    let captured: { time: number; shot: string } | null = null;
    let last: FilmFrameInfo | null = null;
    let unsupported: string | null = null;

    const teardown = () => {
      director?.dispose();
      director = null;
      canvas?.remove();
      canvas = null;
      gl = null;
      loaded = null;
      pixels = null;
      captured = null;
      last = null;
    };

    /** Same task as the render: the drawing buffer still holds the frame (no preserveDrawingBuffer needed). */
    const onFrame = (info: FilmFrameInfo) => {
      last = info;
      if (!info.rendered || !gl || !pixels || !loaded) return;
      const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.readPixels(0, 0, loaded.width, loaded.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
      captured = { time: info.time, shot: info.shot };
    };

    const fit = () => {
      if (!canvas || !loaded) return;
      const scale = Math.min(window.innerWidth / loaded.width, window.innerHeight / loaded.height);
      canvas.style.width = `${Math.floor(loaded.width * scale)}px`;
      canvas.style.height = `${Math.floor(loaded.height * scale)}px`;
    };

    const seek = async (time: number) => {
      if (!director || !loaded) throw new Error("load a film first");
      const started = performance.now();
      captured = null;
      await director.seek(time);
      if (!last || !last.rendered) throw new Error(`frame at ${time} did not render`);
      return { time: last.time, shot: last.shot, ms: performance.now() - started };
    };

    const grab = async () => {
      if (!captured || !pixels) throw new Error("nothing rendered since the last seek");
      if (!sink) throw new Error("no sink: the driver takes a screenshot instead");
      const started = performance.now();
      const response = await fetch(`${sink}/frame?t=${captured.time.toFixed(6)}`, { method: "POST", body: pixels, mode: "cors" });
      if (!response.ok) throw new Error(`sink answered ${response.status}`);
      return { time: captured.time, bytes: pixels.byteLength, ms: performance.now() - started };
    };

    const corner = new THREE.Vector3();
    const lab: FitxLab = {
      async load(args) {
        teardown();
        unsupported = null;
        const band = COMPOSITIONS.find((entry) => entry.id === args.comp);
        if (!band) throw new Error(`unknown composition ${args.comp}`);
        const ss = Math.max(1, Math.round(args.ss ?? 1));
        const width = (args.width ?? band.width) * ss;
        const height = (args.height ?? band.height) * ss;
        if (pickComposition(width, height) !== args.comp) throw new Error(`${width}x${height} is not inside the ${args.comp} band`);
        const film = await FILM_DEFS[args.film]();
        sink = args.sink ?? null;
        canvas = document.createElement("canvas");
        canvas.style.display = "block";
        root.appendChild(canvas);
        director = createFilmDirector(film, {
          canvas,
          theme: args.theme,
          autoplay: false,
          lab: true,
          quality: LAB_QUALITY,
          size: { width, height },
          onFrame,
          callbacks: {
            onStage() {},
            onReady() {},
            onComplete() {},
            onUnsupported() {
              unsupported ??= "the director fell back to the static brand";
            },
          },
        });
        await director.ready;
        gl = canvas.getContext("webgl2");
        pixels = new Uint8Array(width * height * 4);
        loaded = { film: describeFilm(film), comp: args.comp, theme: args.theme, width, height, ...rendererInfo(gl), quality: director.quality };
        fit();
        return loaded;
      },
      seek,
      grab,
      async frame(time) {
        const rendered = await seek(time);
        const grabbed = await grab();
        return { time: rendered.time, shot: rendered.shot, renderMs: rendered.ms, grabMs: grabbed.ms };
      },
      status() {
        const probe = gl ?? (document.createElement("canvas").getContext("webgl2") as WebGL2RenderingContext | null);
        return {
          ...rendererInfo(probe),
          loaded: loaded ? { film: loaded.film.id, comp: loaded.comp, theme: loaded.theme, width: loaded.width, height: loaded.height } : null,
          quality: director?.quality ?? null,
          cast: loaded?.film.cast ?? [],
          castReady: last ? last.castReady : null,
          lastFrame: last,
          unsupported,
          devicePixelRatio: window.devicePixelRatio,
        };
      },
      async project(time) {
        const rendered = await seek(time);
        const frame = director?.labSubjects();
        if (!frame) return { time: rendered.time, shot: rendered.shot, subjects: null };
        frame.camera.updateMatrixWorld();
        const subjects = frame.boxes
          ? frame.boxes.map((box) => {
              const ndc: [number, number, number][] = [];
              for (const x of [box.min[0], box.max[0]]) {
                for (const y of [box.min[1], box.max[1]]) {
                  for (const z of [box.min[2], box.max[2]]) {
                    corner.set(x, y, z).project(frame.camera);
                    ndc.push([corner.x, corner.y, corner.z]);
                  }
                }
              }
              return { id: box.id, must: box.must, ndc };
            })
          : null;
        return { time: frame.time, shot: frame.shot, subjects };
      },
    };

    window.__fitxLab = lab;
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      teardown();
      if (window.__fitxLab === lab) delete window.__fitxLab;
    };
  }, []);

  return (
    <div
      ref={host}
      data-fitx-lab
      style={{ position: "fixed", inset: 0, zIndex: 2147483647, display: "grid", placeItems: "center", background: "var(--fitx-stage, var(--background))" }}
    />
  );
}
