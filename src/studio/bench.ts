// In-browser benchmark: open the studio with ?bench (or ?bench=eiffel,synthetic-100k).
// Measures with YOUR browser and GPU: build, mesh, first frame, FPS while orbiting, edit latency.
import * as THREE from "three";
import type { Engine } from "../engine/engine";
import type { Viewport } from "./viewport";
import { SCENES } from "../../bench/scenes";
import { downloadText } from "./storage";

export interface BenchResult {
  scene: string;
  blocks: number;
  visible: number;
  buildMs: number;
  meshMs: number;
  firstFrameMs: number;
  fpsAvg: number;
  fpsLow1: number; // 1% low (99th percentile frame time)
  frameMsMax: number;
  drawCalls: number;
  triangles: number;
  meshes: number;
  edit1000Ms: number; // command + re-mesh + one rendered frame
  heapMB?: number;
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** forces the GPU to finish the frame so timings include rendering */
function syncGpu(v: Viewport) {
  const gl = v.renderer.getContext();
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}

export async function runBench(engine: Engine, v: Viewport, ids: string[] | null, seconds = 10, onProgress: (s: string) => void = () => {}) {
  const results: BenchResult[] = [];
  const scenes = SCENES.filter((s) => !ids || ids.includes(s.id));
  for (const scene of scenes) {
    onProgress(`${scene.label}: 짓는 중…`);
    await nextFrame();
    let t = performance.now();
    scene.build(engine);
    const buildMs = performance.now() - t;
    v.chunks.reset();
    t = performance.now();
    v.chunks.flush();
    const meshMs = performance.now() - t;
    v.fitShadow();
    v.view("all", false);
    t = performance.now();
    v.renderer.render(v.scene, v.camera);
    syncGpu(v);
    const firstFrameMs = performance.now() - t;

    onProgress(`${scene.label}: ${seconds}초 동안 회전하며 FPS 측정…`);
    const target = v.controls.target.clone();
    const radius = v.camera.position.distanceTo(target);
    const height = v.camera.position.y - target.y;
    const frames: number[] = [];
    let last = await nextFrame();
    const start = last;
    let calls = 0, tris = 0;
    while (last - start < seconds * 1000) {
      const now = await nextFrame();
      frames.push(now - last);
      last = now;
      const a = ((now - start) / (seconds * 1000)) * Math.PI * 2;
      v.camera.position.set(target.x + Math.cos(a) * Math.sqrt(Math.max(1, radius * radius - height * height)), target.y + height, target.z + Math.sin(a) * Math.sqrt(Math.max(1, radius * radius - height * height)));
      v.camera.lookAt(target);
      calls = Math.max(calls, v.renderer.info.render.calls);
      tris = Math.max(tris, v.renderer.info.render.triangles);
    }
    const sorted = [...frames].sort((a, b) => a - b);
    const avg = frames.reduce((n, f) => n + f, 0) / frames.length;
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];

    onProgress(`${scene.label}: 블록 1000개 편집 측정…`);
    const ops = Array.from({ length: 1000 }, (_, i) => ({ op: "set", at: [(i % 40) - 20, 330 + Math.floor(i / 400), Math.floor(i / 40) % 10], material: "brick" }));
    t = performance.now();
    engine.execute({ cmd: "editBlocks", args: { ops } });
    v.chunks.flush();
    v.renderer.render(v.scene, v.camera);
    syncGpu(v);
    const editMs = performance.now() - t;
    engine.execute({ cmd: "undo" });
    v.chunks.flush();

    const st = v.chunks.stats();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    results.push({
      scene: scene.id, blocks: engine.project.world.blockCount, visible: st.visible,
      buildMs: Math.round(buildMs), meshMs: Math.round(meshMs), firstFrameMs: Math.round(firstFrameMs),
      fpsAvg: +(1000 / avg).toFixed(1), fpsLow1: +(1000 / p99).toFixed(1), frameMsMax: +sorted[sorted.length - 1].toFixed(1),
      drawCalls: calls, triangles: tris, meshes: st.meshes, edit1000Ms: Math.round(editMs),
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
    });
  }
  return { env: environment(v), seconds, results };
}

export function environment(v: Viewport) {
  const gl = v.renderer.getContext();
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    userAgent: navigator.userAgent,
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    screen: `${v.renderer.domElement.width}x${v.renderer.domElement.height} @${v.renderer.getPixelRatio()}x`,
    shadows: v.renderer.shadowMap.enabled,
    three: THREE.REVISION,
    date: new Date().toISOString(),
  };
}

export function showBenchPanel(host: HTMLElement, data: Awaited<ReturnType<typeof runBench>>) {
  const div = document.createElement("div");
  div.className = "benchpanel";
  const rows = data.results.map((r) => `<tr><td>${r.scene}</td><td>${r.blocks.toLocaleString()}</td><td>${r.meshMs}</td><td>${r.firstFrameMs}</td><td><b>${r.fpsAvg}</b></td><td>${r.fpsLow1}</td><td>${r.drawCalls}</td><td>${(r.triangles / 1e6).toFixed(2)}M</td><td>${r.edit1000Ms}</td></tr>`).join("");
  div.innerHTML = `<h3>벤치마크 결과 (실측)</h3>
    <p>${data.env.gpu}<br>${data.env.screen} · 그림자 ${data.env.shadows ? "켬" : "끔"} · ${data.seconds}초 회전</p>
    <table><tr><th>장면</th><th>블록</th><th>메시ms</th><th>첫 프레임ms</th><th>평균 FPS</th><th>1% low</th><th>draw</th><th>삼각형</th><th>편집1000ms</th></tr>${rows}</table>
    <button id="bench-dl">결과 JSON 저장</button> <button id="bench-close">닫기</button>`;
  host.appendChild(div);
  div.querySelector("#bench-dl")!.addEventListener("click", () => downloadText(`bench-${data.env.date.slice(0, 10)}.json`, JSON.stringify(data, null, 2)));
  div.querySelector("#bench-close")!.addEventListener("click", () => div.remove());
}
